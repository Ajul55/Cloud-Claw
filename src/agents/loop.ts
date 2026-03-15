import { createHash } from 'crypto';
/**
 * Agentic Reasoning Loop
 *
 * Inspired by the OpenClaw Pi agent RPC runtime.
 * Drives the LLM ↔ Tool ↔ HITL cycle for each incoming message.
 *
 * Flow:
 *   User message → LLM → tool call → result → LLM → ...
 *   If fix proposed (Tier-3) → emit approval request → wait
 *   max_iterations = 15 (loop guard)
 *
 * ─── BUGS FIXED IN THIS VERSION ─────────────────────────────────────────────
 *
 * BUG 1 (CRITICAL — "says done, nothing happened"):
 *   OLD: tool_choice: (requiresTool && !hasExecutedTool) ? 'required' : 'auto'
 *   After the FIRST tool ran (hasExecutedTool=true), every subsequent LLM call
 *   used tool_choice:'auto'. The LLM then narrated "I will now fix this..." 
 *   instead of calling the next tool in the chain. Nothing got executed.
 *   FIX: tool_choice:'required' whenever the last message in history is a tool
 *   result — meaning we are mid-chain and the LLM MUST continue calling tools.
 *   Only switch to 'auto' when the LLM is wrapping up with a text reply.
 *
 * BUG 2 (Hallucination detector blind spot):
 *   OLD: isHallucination = !hasExecutedTool && patterns.test(text)
 *   After ANY tool ran, hasExecutedTool=true, so the hallucination guard was
 *   completely disabled. The LLM could claim "fix applied successfully" after
 *   only running diagnose_nginx (not fix_nginx_config), and the guard ignored it.
 *   FIX: Track WHICH tools actually ran (receipts Map). Check per-tool:
 *   don't let the LLM claim fix success unless fix_nginx_config actually ran
 *   and succeeded.
 *
 * BUG 3 (tool_choice:'required' with no tools defined crashes some providers):
 *   Added guard: only set tool_choice:'required' if tools array is non-empty.
 *
 * BUG 4 (Session lost on unexpected throw inside tool loop):
 *   Wrapped tool execution in try/catch so session is always persisted even if
 *   a single tool throws unexpectedly.
 */

import OpenAI from 'openai';
import { env } from '../config/env.js';
import { getLLMClient } from '../llm/provider.js';
import { getSession, upsertSession, createApproval, getLatestPendingApproval } from '../database/db.js';
import { getLLMToolDefinitions, getToolByName } from '../tools/tool_registry.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';
import { checkCommand, requiresApproval, isWriteCommand } from '../security/command_filter.js';
import { classifyIntent } from './intent_classifier.js';
import { checkForHallucination } from './hallucination_guard.js';
import { sanitizeToolOutput } from './tool_guard.js';
import { SYSTEM_PROMPT } from '../config/system_prompt.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { touchSession } from '../jobs/timeout_sessions.js';
import type { StatusIndicator } from '../utils/status_indicator.js';
import { trackUsage } from '../telemetry/usage_tracker.js';
import { saveFix, getRecentFixes, searchFixes, formatFixesForPrompt } from '../memory/fix_memory.js';
import {
    getAllServers,
    getServerByIp,
    getServerByLabel,
    resolveAllServers,
    resolveServerFromMessage,
} from '../utils/server_registry.js';
import type {
    IncomingMessage,
    ReplyFn,
    ApprovalFn,
} from '../tools/types.js';

const MAX_ITERATIONS = 15;
// Receipts older than this are considered stale and should not bypass guards
const RECEIPT_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes

function containsInternalToolSyntax(text: string): boolean {
    return /\bfunctions\.[a-z_]+\s*\(/i.test(text)
        || /```(?:typescript|json)?[\s\S]*functions\.[a-z_]+\s*\(/i.test(text)
        || /<minimax:tool_call>/i.test(text)
        || /<\/minimax:tool_call>/i.test(text)
        || /<invoke\s+name=/i.test(text)
        || /<parameter\s+name=/i.test(text);
}

function getMessageText(content: OpenAI.ChatCompletionMessageParam['content'] | null | undefined): string {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .map((part: any) => {
            if (typeof part === 'string') return part;
            if (part?.type === 'text' && typeof part.text === 'string') return part.text;
            return '';
        })
        .filter(Boolean)
        .join(' ');
}

function summarizeText(text: string, maxLength = 220): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
        return '';
    }

    return collapsed.length > maxLength
        ? `${collapsed.slice(0, maxLength - 3).trimEnd()}...`
        : collapsed;
}

function buildProgressSummary(messages: OpenAI.ChatCompletionMessageParam[]): string {
    const summaryLines: string[] = [];

    for (let index = messages.length - 1; index >= 0 && summaryLines.length < 5; index--) {
        const msg = messages[index] as any;

        if (msg.role === 'tool') {
            const text = summarizeText(getMessageText(msg.content), 220);
            if (text) summaryLines.push(`- Tool result: ${text}`);
            continue;
        }

        if (msg.role === 'assistant' && typeof msg.content === 'string' && !containsInternalToolSyntax(msg.content)) {
            const text = summarizeText(msg.content, 160);
            if (text) summaryLines.push(`- Assistant: ${text}`);
            continue;
        }

        if (msg.role === 'user') {
            const text = summarizeText(getMessageText(msg.content), 160);
            if (text) summaryLines.push(`- Pilot: ${text}`);
        }
    }

    return summaryLines.length > 0
        ? summaryLines.reverse().join('\n')
        : '- No concrete findings captured yet.';
}

// ─── Tool Receipts (Layer 4) ────────────────────────────────────────────────
export interface ToolReceipt {
    toolName: string;
    success: boolean;
    host: string;
    timestamp: number;
    outputHash: string;
}

function hashOutput(output: string): string {
    return createHash('sha256').update(output.slice(0, 200)).digest('hex');
}

function loadReceiptsFromSession(raw: unknown): Map<string, ToolReceipt> {
    const map = new Map<string, ToolReceipt>();
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, any>;
        for (const [key, value] of Object.entries(obj)) {
            if (value && typeof value === 'object' && typeof (value as any).toolName === 'string') {
                map.set(key, {
                    toolName: (value as any).toolName,
                    success: (value as any).success === true,
                    host: String((value as any).host ?? ''),
                    timestamp: Number((value as any).timestamp ?? Date.now()),
                    outputHash: String((value as any).outputHash ?? ''),
                });
            }
        }
    }
    return map;
}

function serializeReceipts(map: Map<string, ToolReceipt>): Record<string, ToolReceipt> {
    return Object.fromEntries(map.entries());
}

function recordReceipt(
    receipts: Map<string, ToolReceipt>,
    key: string,
    success: boolean,
    host: string,
    output: string
): void {
    receipts.set(key, {
        toolName: key.includes(':') ? key.split(':')[0] : key,
        success,
        host,
        timestamp: Date.now(),
        outputHash: hashOutput(output ?? ''),
    });
}

export function hasReceipt(
    receipts: Map<string, ToolReceipt>,
    toolNames: string | string[],
    requireSuccess = false,
    maxAgeMs?: number,
    expectedHost?: string
): boolean {
    const list = Array.isArray(toolNames) ? toolNames : [toolNames];
    const now = Date.now();
    const expected = expectedHost?.toLowerCase().trim();

    return list.some((name) => {
        const rec = receipts.get(name);
        if (!rec) return false;
        if (requireSuccess && !rec.success) return false;
        if (maxAgeMs && now - rec.timestamp > maxAgeMs) return false;
        if (expected && rec.host?.toLowerCase().trim() !== expected) return false;
        return true;
    });
}

// ─── Output Sanitization (Layer 3) ───────────────────────────────────────────


// ─── Audit Guard ───────────────────────────────────────────────────────────────
const WRITE_TOOLS = new Set([
    'fix_nginx_config',
    'execute_ssh_write',
    'cloudflare_cache_purge',
    'fix_wordpress',
    'renew_ssl',
    'manage_php',
    'repair_mysql',
    'cleanup_disk',
    'create_nginx_vhost',
]);

function encodeApprovalArgs(toolArgs: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(toolArgs).map(([key, value]) => {
            if (Array.isArray(value) || (value && typeof value === 'object')) {
                return [key, JSON.stringify(value)];
            }
            return [key, String(value ?? '')];
        })
    );
}

function getTargetHostDisplay(toolArgs: Record<string, unknown>): string {
    const label = String(toolArgs.server_label ?? '').trim();
    const host = String(toolArgs.host ?? '').trim();

    if (label && host) return `${label} (${host})`;
    if (host) return host;
    if (label) return label;
    return 'unknown';
}

function toolSupportsServerRouting(tool: { parameters: { properties: Record<string, unknown> } }): boolean {
    return Object.prototype.hasOwnProperty.call(tool.parameters.properties, 'server_label')
        || Object.prototype.hasOwnProperty.call(tool.parameters.properties, 'host');
}

function getToolApprovalRequest(
    toolName: string,
    toolArgs: Record<string, unknown>
): { command: string; targetHost: string; rationale: string } | null {
    if (toolName === 'fix_nginx_config') {
        const host = String(toolArgs.host ?? 'unknown');
        const filePath = String(toolArgs.file_path ?? 'unknown');
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs({ ...toolArgs, host, file_path: filePath })),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: 'This action will edit Nginx config and restart Nginx.',
        };
    }

    if (toolName === 'fix_wordpress') {
        const host = String(toolArgs.host ?? 'unknown');
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs({ ...toolArgs, host, site_root: String(toolArgs.site_root ?? '') })),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: 'This action will modify wp-config.php to enable WP_DEBUG.',
        };
    }

    if (toolName === 'renew_ssl') {
        const host = String(toolArgs.host ?? 'unknown');
        const domain = String(toolArgs.domain ?? 'all');
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs({ ...toolArgs, host, domain })),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: `This action will renew SSL certificate${domain !== 'all' ? ` for ${domain}` : 's'} using Certbot.`,
        };
    }

    if (toolName === 'manage_php' && String(toolArgs.action ?? '') === 'switch') {
        const host = String(toolArgs.host ?? 'unknown');
        const ver = String(toolArgs.target_version ?? 'unknown');
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs({ ...toolArgs, host, action: 'switch', target_version: ver })),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: `This action will switch PHP-FPM to version ${ver} (stop old, start new).`,
        };
    }

    if (toolName === 'repair_mysql' && String(toolArgs.action ?? '') === 'repair') {
        const host = String(toolArgs.host ?? 'unknown');
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs({ ...toolArgs, host, action: 'repair' })),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: 'This action will run mysqlcheck --auto-repair on all databases.',
        };
    }

    if (toolName === 'cleanup_disk' && String(toolArgs.action ?? '') === 'cleanup') {
        const host = String(toolArgs.host ?? 'unknown');
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs({ ...toolArgs, host, action: 'cleanup' })),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: 'This action will truncate old logs, remove old tmp files, and vacuum journal.',
        };
    }

    if (toolName === 'cloudflare_cache_purge') {
        const mode = String(toolArgs.mode ?? 'url');
        let targetHost = `Cloudflare (${env.CLOUDFLARE_DOMAIN ?? 'configured zone'})`;
        if (mode === 'url') {
            const urlsRaw = toolArgs.urls;
            const urls = Array.isArray(urlsRaw)
                ? urlsRaw.map((value) => String(value))
                : String(urlsRaw ?? '').split(',').map((value) => value.trim()).filter(Boolean);
            targetHost = urls.join(', ') || targetHost;
        }

        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs(toolArgs)),
            targetHost,
            rationale: mode === 'everything'
                ? `This action will purge the entire Cloudflare cache for ${env.CLOUDFLARE_DOMAIN ?? 'the configured zone'}.`
                : `This action will purge Cloudflare cache for ${targetHost}.`,
        };
    }

    if (toolName === 'create_nginx_vhost') {
        const host = String(toolArgs.host ?? 'unknown');
        const domain = String(toolArgs.domain ?? 'unknown');
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs({ ...toolArgs, host, domain })),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: `Create new nginx vhost for ${domain} on ${host} and reload nginx.`,
        };
    }

    const tool = getToolByName(toolName);
    if (tool?.approvalTier === 3) {
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs(toolArgs)),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: tool.getRationale?.(toolArgs)
                ?? `This action will run ${toolName} on ${getTargetHostDisplay(toolArgs)}.`,
        };
    }

    return null;
}

// ─── System prompt ─────────────────────────────────────────────────────────────
// SYSTEM_PROMPT moved to ../config/system_prompt.ts

// ─── Main loop ─────────────────────────────────────────────────────────────────

export async function runAgentLoop(
    message: IncomingMessage,
    onReply: ReplyFn,
    onApproval: ApprovalFn,
    indicator?: StatusIndicator
): Promise<void> {
    // 1. Load or create session
    const session = await getSession(message.sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: OpenAI.ChatCompletionMessageParam[] = (session?.messages ?? []) as any;

    messages = messages
        .filter((msg: any, idx: number) => {
            // Drop stray system messages in history (providers reject mid-stream system role)
            if (msg.role === 'system') {
                console.warn(`[loop] Dropping historical system message at index ${idx} to satisfy provider role constraints`);
                return false;
            }
            return true;
        })
        .map(msg => {
            const clean: any = { ...msg };
            // Claude rejects "name" on assistant messages
            if (clean.role === 'assistant' && ('name' in clean)) {
                delete clean.name;
            }
            // Claude rejects "audio_content"
            if ('audio_content' in clean) {
                delete clean.audio_content;
            }
            // Claude rejects "index" field inside tool_calls (which MiniMax adds)
            if (clean.tool_calls && Array.isArray(clean.tool_calls)) {
                // Check for malformed tool_calls that are missing an ID (MiniMax hallucination)
                const isBroken = clean.tool_calls.some((tc: any) => !tc.id);
                if (isBroken) {
                    console.warn('[loop] Found broken tool_calls without an ID in history, removing them.');
                    delete clean.tool_calls;
                } else {
                    clean.tool_calls = clean.tool_calls.map((tc: any) => {
                        const cleanTc = { ...tc };
                        if ('index' in cleanTc) delete cleanTc.index;
                        return cleanTc;
                    });
                }
            }
            // Ensure content is string unless it's an array of content blocks (or undefined/null)
            if (clean.role === 'tool' && clean.content !== undefined && clean.content !== null && typeof clean.content !== 'string') {
                clean.content = String(clean.content);
            }
            return clean as OpenAI.ChatCompletionMessageParam;
        });

    const priorConversationCount = messages.filter(
        (m: any) => m.role === 'user' || m.role === 'assistant'
    ).length;
    const priorToolLines = messages
        .filter((m: any) => m.role === 'tool')
        .map((m: any) => summarizeText(getMessageText(m.content).split('\n')[0] ?? '', 160))
        .filter(Boolean)
        .slice(-5)
        .join('\n');

    // 2. Append user message if present
    if (message.text) {
        messages.push({ role: 'user', content: message.text });
    }
    touchSession(message.sessionId);

    let iteration = 0;
    let internalSyntaxRetryUsed = false;
    let pendingAutoChain: { name: string; args: Record<string, unknown> } | null = null;

    // Layer 4 receipts: track tools that actually ran (and whether they succeeded)
    const executionReceipts = loadReceiptsFromSession(session?.receipts);
    if (message.resumedTools) {
        for (const t of message.resumedTools) {
            if (!executionReceipts.has(t)) {
                executionReceipts.set(t, {
                    toolName: t,
                    success: true,
                    host: 'resume',
                    timestamp: Date.now(),
                    outputHash: 'resume-seed',
                });
            }
            console.log(`[loop] Seeded receipt from resume: ${t}`);
        }
    }
    // Track tools executed in this loop leg only (for tool_choice logic)
    const currentLegTools = new Set<string>();

    await indicator?.start('🔍 Analysing your request...');

    // Fast-path: user explicitly typed proceed/approve/reject while an approval is pending
    const normalized = (message.text ?? '').trim().toLowerCase();
    if (normalized) {
        const pending = await getLatestPendingApproval(message.sessionId);
        if (pending && ['proceed', 'approve', 'yes', 'apply', 'fix', 'do it'].some(k => normalized === k)) {
            await resumeApprovedSession(
                pending.id,
                true,
                message.userId,
                onReply,
                onApproval
            );
            await indicator?.stop(true);
            return;
        }
        if (pending && ['reject', 'no', 'stop', 'cancel'].some(k => normalized === k)) {
            await resumeApprovedSession(
                pending.id,
                false,
                message.userId,
                onReply,
                onApproval
            );
            await indicator?.stop(true);
            return;
        }
    }

    const intent = await classifyIntent(message.text ?? '');
    const requiresTool = intent.requiresTool;
    const requiresCloudflarePurge = intent.toolHint === 'cloudflare_cache_purge';
    const requiresDomainDiagnosis = intent.toolHint === 'diagnose_domain';
    const requiresNginx = intent.toolHint === 'diagnose_nginx';

    // ─── Session trimming & Sanitation ─────────────────────────────────────────
    // Sanitize any existing corrupted history (e.g., from previous bad trims)
    // where a tool response was left orphaned without its assistant tool_call.
    while (messages.length > 0 && messages[0].role === 'tool') {
        messages.shift();
        console.log('[loop] Shifted orphaned tool message from beginning of history');
    }

    // If the user is sending a new message (not a resume) and the session has many
    // old messages, trim to prevent context pollution from previous conversations.
    // Keep: system prompt (injected separately) + last few messages + the new user msg.
    if (message.text && !message.resumedTools && messages.length > 20) {
        let startIndex = messages.length - 6;
        // Move backwards to find a clean boundary (user message) so we don't sever
        // an assistant tool_call from its tool responses.
        while (startIndex > 0 && messages[startIndex].role !== 'user') {
            startIndex--;
        }
        const trimmed = messages.slice(startIndex);
        messages.length = 0;
        messages.push(...trimmed);
        console.log(`[loop] Trimmed session safely to ${messages.length} messages`);
    }

    const toolDefinitions = getLLMToolDefinitions();

    // ─── Fix Memory: fetch past fixes ────────────────────────────────────────
    let pastFixesStr = '';
    if (message.text) {
        try {
            const [recent, similar] = await Promise.all([
                getRecentFixes(3),
                searchFixes(message.text),
            ]);
            const seen = new Set<number>();
            const combined = [...similar, ...recent].filter(f => {
                if (seen.has(f.id)) return false;
                seen.add(f.id);
                return true;
            }).slice(0, 5);

            if (combined.length > 0) {
                pastFixesStr = formatFixesForPrompt(combined);
                console.log(`[loop] Found ${combined.length} past fix(es) for system prompt`);
            }
        } catch (err) {
            console.warn('[loop] Fix memory fetch failed (non-fatal):', err);
        }
    }

    let dynamicPrompt = SYSTEM_PROMPT({
        sshHost: '139.84.130.63',
        sshUser: 'root',
        pastFixes: pastFixesStr || undefined
    });

    const recentToolFailures = messages
        .filter((m: any) => m.role === 'tool')
        .slice(-6)
        .filter((m: any) => {
            const content = String(m.content ?? '');
            return content.includes('BLOCKED') || /threw an unexpected error/i.test(content);
        }).length;

    const shouldPauseForClarification = recentToolFailures >= 3
        && !message.resumedTools
        && !intent.isApprovalResponse;

    if (shouldPauseForClarification) {
        dynamicPrompt = `Before acting, summarize: (1) what the desired state is, (2) what has already been tried,
(3) your root cause hypothesis. Ask Pilot to confirm before making any changes.

Recent tool attempts:
${priorToolLines || 'No prior tool outputs recorded.'}

` + dynamicPrompt;
    }

    while (iteration < MAX_ITERATIONS) {
        iteration++;
        console.log(`[loop] Iteration ${iteration}/${MAX_ITERATIONS} — session: ${message.sessionId}`);

        // ─── FIX BUG 1: tool_choice logic ─────────────────────────────────────
        // OLD (broken): (requiresTool && !hasExecutedTool) ? 'required' : 'auto'
        //   → After first tool ran, always used 'auto' → LLM narrated instead of chaining
        //
        // NEW (correct): Use 'required' when we are mid-chain (last message is a
        // tool result). This forces the LLM to keep calling tools until it has
        // consumed all pending tool results and is ready to give a final answer.
        // Use 'required' also on the first call if this request needs tools.
        // Use 'auto' only when the LLM has seen all results and needs to wrap up.
        //
        // NGINX OVERRIDE: On the first call, if the query is nginx-related,
        // force the LLM to call diagnose_nginx specifically (not just any tool).
        //
        // Guard: only set 'required' if tools are actually defined (crashes some providers otherwise).
        const lastMsg = messages[messages.length - 1];
        const isMidChain = lastMsg?.role === 'tool';
        const isFirstToolCall = requiresTool && currentLegTools.size === 0;

        // BUG FIX: On resume, the last message is a 'tool' result. If we force
        // 'required' here, the LLM is forced to call *another* tool even if it
        // has enough information to reply. We should only force 'required' mid-chain
        // if we are explicitly chaining (e.g. diagnose -> fix). If the LLM just ran
        // a fix, it should be allowed to summarize instead of being forced to call again.
        // We'll trust the LLM's own decision ('auto') if we are mid-chain and it's not
        // the very first interaction.
        const shouldRequireTool = toolDefinitions.length > 0 && (isMidChain || isFirstToolCall);

        let toolChoice: OpenAI.ChatCompletionToolChoiceOption;
        if (shouldPauseForClarification && iteration === 1) {
            toolChoice = 'none';
            console.log('[loop] Forcing tool_choice: none (long conversation clarification gate)');
        } else if (requiresCloudflarePurge && currentLegTools.size === 0 && !hasReceipt(executionReceipts, 'cloudflare_cache_purge', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = { type: 'function', function: { name: 'cloudflare_cache_purge' } };
            console.log('[loop] Forcing tool_choice: cloudflare_cache_purge (explicit cache purge request detected)');
        } else if (requiresDomainDiagnosis && currentLegTools.size === 0 && !hasReceipt(executionReceipts, 'diagnose_domain', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = { type: 'function', function: { name: 'diagnose_domain' } };
            console.log('[loop] Forcing tool_choice: diagnose_domain (domain routing query detected)');
        } else if (requiresNginx && currentLegTools.size === 0 && !hasReceipt(executionReceipts, 'diagnose_nginx', true, RECEIPT_FRESHNESS_MS)) {
            // Force diagnose_nginx on first call for nginx/website queries
            toolChoice = { type: 'function', function: { name: 'diagnose_nginx' } };
            console.log('[loop] Forcing tool_choice: diagnose_nginx (nginx/website query detected)');
        } else {
            // Revert back to 'required' for MiniMax compatibility
            toolChoice = shouldRequireTool ? 'required' : 'auto';
        }
        // ──────────────────────────────────────────────────────────────────────

        // 3. Call LLM OR trigger auto-chain
        let choice: OpenAI.ChatCompletion.Choice;
        let reqStart = Date.now();
        const { client: openai, model: activeModel } = getLLMClient();
        let reqLatency = 0;

        if (pendingAutoChain) {
            console.log('[loop] Bypassing LLM call for auto-chain:', pendingAutoChain.name);
            choice = {
                index: 0,
                message: {
                    role: 'assistant',
                    content: `[AUTO-CHAIN] Diagnosed issue requires ${pendingAutoChain.name}. Executing automatically.`,
                    refusal: null,
                    tool_calls: [{
                        id: `call_auto_${Date.now()}`,
                        type: 'function',
                        function: {
                            name: pendingAutoChain.name,
                            arguments: JSON.stringify(pendingAutoChain.args)
                        }
                    }]
                },
                logprobs: null,
                finish_reason: 'tool_calls'
            };
            pendingAutoChain = null;
        } else {
            // One final strict sanitization pass: ensure absolutely NO orphaned tool messages remain,
            // which guarantees we never hit the 2013 "tool id not found" provider error.
            const validToolIds = new Set<string>();
            messages = messages.filter((msg: any) => {
                if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    // Register valid IDs
                    msg.tool_calls.forEach((tc: any) => {
                        if (tc.id) validToolIds.add(tc.id);
                    });
                } else if (msg.role === 'tool') {
                    if (!msg.tool_call_id || !validToolIds.has(msg.tool_call_id)) {
                        console.warn(`[loop] Dropping orphaned tool message with ID ${msg.tool_call_id}`);
                        return false; // Safely strip this from the request
                    }
                }
                return true;
            });

            try {
                console.log('[loop] Outgoing messages to API:', JSON.stringify(messages, null, 2));
                const response = await openai.chat.completions.create({
                    model: activeModel,
                    messages: [{ role: 'system', content: dynamicPrompt }, ...messages],
                    tools: toolDefinitions,
                    tool_choice: toolChoice,
                    temperature: 0.2,
                });
                reqLatency = Date.now() - reqStart;
                choice = response.choices[0];

                // Handle usage tracking
                const usage = response.usage;
                if (usage) {
                    const calledTools = choice.message?.tool_calls?.map((t: any) => t.function.name).join(',') || undefined;
                    void trackUsage({
                        sessionId: message.sessionId,
                        model: activeModel,
                        tokensIn: usage.prompt_tokens,
                        tokensOut: usage.completion_tokens,
                        latencyMs: reqLatency,
                        toolName: calledTools
                    });
                }
            } catch (err: any) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error('[loop] LLM error:', msg);
                if (err.error?.failed_generation) {
                    console.error('[loop] Failed generation:', err.error.failed_generation);
                } else if (err.failed_generation) {
                    console.error('[loop] Failed generation:', err.failed_generation);
                }
                await indicator?.stop();
                await onReply(`❌ LLM error: ${msg}`);
                break;
            }
        }

        if (choice.message?.content) {
            // Strip out <think> reasoning blocks so they aren't shown to the user
            let content = choice.message.content;
            let startIdx = content.indexOf('<think>');
            while (startIdx !== -1) {
                let endIdx = content.indexOf('</think>', startIdx);
                if (endIdx !== -1) {
                    content = content.substring(0, startIdx) + content.substring(endIdx + 8);
                } else {
                    content = content.substring(0, startIdx);
                }
                startIdx = content.indexOf('<think>');
            }
            choice.message.content = content.trim();
        }

        // 4a. No tool calls — agent produced a final reply
        if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
            const text = choice.message.content ?? '(no response)';

            if (containsInternalToolSyntax(text) && !internalSyntaxRetryUsed) {
                internalSyntaxRetryUsed = true;
                messages.push({ role: 'assistant', content: text });
                messages.push({
                    role: 'system',
                    content:
                        '[SYSTEM] Tool syntax detected in your last response. '
                        + 'Do not output functions.* or <minimax:tool_call> syntax. '
                        + 'Call tools via the tool API only.',
                });
                continue;
            }

            // ─── FIX BUG 2: Hallucination detection per-tool ──────────────────
            // OLD (broken): !hasExecutedTool — guard was completely off once ANY tool ran.
            // NEW: Check per-claim. Don't allow fix/restart success claims unless
            //      the relevant tool is in executedTools.
            const hallucinationPatterns: Array<{ pattern: RegExp; requiresTool?: string }> = [
                // Fix/repair claims — only valid if fix_nginx_config actually ran
                { pattern: /configuration (has been|was) (successfully |)repaired/i, requiresTool: 'fix_nginx_config' },
                { pattern: /(service|nginx|mariadb|mysql) has been restarted/i, requiresTool: 'fix_nginx_config' },
                { pattern: /fix (was|has been) applied/i, requiresTool: 'fix_nginx_config' },
                { pattern: /issue (has been|is now|was) (resolved|fixed|solved)/i, requiresTool: 'fix_nginx_config' },
                { pattern: /successfully (restarted|repaired|resolved|fixed|applied)/i, requiresTool: 'fix_nginx_config' },
                // Service status claims — only valid if execute_ssh_command or diagnose_nginx ran
                { pattern: /(nginx|mariadb|mysql|apache|php|redis|postgres) is (now |currently )?(active|running|up|fixed|resolved)/i, requiresTool: 'execute_ssh_command' },
                // Planning language — always a hallucination signal (never valid)
                { pattern: /steps taken:/i },
                { pattern: /outcome:/i },
                { pattern: /please (give me a moment|allow me a moment|wait while)/i },
                { pattern: /i (have|'ve) (applied|fixed|repaired|restarted|resolved)/i },
                { pattern: /i('ll| will) now (apply|run|execute|perform|initiate)/i },
                { pattern: /let me (now |)(run|execute|apply|check|diagnose)/i },
                { pattern: /i('ll| will) (start|begin) by/i },
            ];

            const isHallucination = hallucinationPatterns.some(({ pattern, requiresTool: req }) => {
                if (!pattern.test(text)) return false;
                if (req) {
                    const relatedTools: Record<string, string[]> = {
                        'execute_ssh_command': ['execute_ssh_command', 'diagnose_nginx'],
                        'fix_nginx_config': ['fix_nginx_config'],
                    };
                    const acceptable = relatedTools[req] ?? [req];
                    return !hasReceipt(executionReceipts, acceptable, true, RECEIPT_FRESHNESS_MS);
                }
                return true; // planning language
            });
            // ──────────────────────────────────────────────────────────────────

            if (isHallucination) {
                console.error('[loop] HALLUCINATION DETECTED — LLM claimed success without sufficient tool execution');
                console.error('[loop] Execution receipts so far:', [...executionReceipts.keys()]);
                await indicator?.update('⚠️ Need real diagnostics — re-running with tools...');
                await onReply('⚠️ I need to verify this with real diagnostics. Running tools now — you may see a short pause.');
                messages.push({ role: 'assistant', content: text });
                messages.push({
                    role: 'system',
                    content: `[SYSTEM GUARD] Hallucination detected. No successful receipt found for required tool. `
                        + `Receipts on record: [${[...executionReceipts.keys()].join(', ') || 'none'}]. `
                        + 'Call the required diagnostic or fix tool NOW via the tool API. '
                        + 'Do not produce text until you have real tool output.',
                });
                continue;
            }

            const safeText = containsInternalToolSyntax(text)
                ? 'I am still processing this request. Please retry if you do not receive results in a moment.'
                : text;

            // If the model still avoided tool use on the very first call while tools
            // are required, it means tool_choice:'required' failed (provider issue).
            // This is often because the LLM lacks the specific tool requested (e.g. write access).
            // We should let the user see the LLM's explanation rather than fabricating an SSH error.
            if (requiresTool && executionReceipts.size === 0) {
                console.error('[loop] LLM avoided tool call despite tool_choice:required — possible provider issue or missing tool');
                console.error('[loop] Raw text returned instead of tool call:', text);
                // Fall through to show the user the text, but log it.
            }

            await indicator?.stop();
            messages.push({ role: 'assistant', content: safeText });
            await onReply(safeText);
            break;
        }

        // 4b. Tool calls requested
        messages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
            if (!toolCall.id) {
                console.warn('[loop] Tool call missing ID — skipping to prevent message history corruption');
                continue;
            }

            const toolName = toolCall.function?.name;
            if (!toolName) {
                console.warn('[loop] Received tool call without a function name, skipping.');
                continue;
            }

            let toolArgs: Record<string, unknown> = {};

            try {
                if (toolCall.function?.arguments) {
                    toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
                }
            } catch {
                console.warn(`[loop] Failed to parse args for ${toolName}:`, toolCall.function?.arguments);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `Error: Could not parse arguments for tool "${toolName}". The arguments were malformed JSON.`,
                });
                continue;
            }

            console.log(`[loop] Tool called: ${toolName}`, toolArgs);
            await indicator?.update(`⚙️ Running ${toolName}... please wait.`);

            const tool = getToolByName(toolName);
            if (!tool) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `Error: Tool "${toolName}" not found in registry.`,
                });
                continue;
            }

            if (toolSupportsServerRouting(tool)) {
                const requestedAllServers = String(toolArgs.server_label ?? '').trim().toLowerCase() === 'all'
                    || intent.targetServer === 'all';

                if (requestedAllServers) {
                    toolArgs.server_label = 'all';
                } else {
                    const explicitLabel = String(toolArgs.server_label ?? '').trim();
                    const explicitHost = String(toolArgs.host ?? '').trim();

                    if (explicitLabel) {
                        const server = await getServerByLabel(explicitLabel);
                        if (!server) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: `Error: Server "${explicitLabel}" not found. Available servers: production (139.84.130.63) and test (65.20.82.177).`,
                            });
                            continue;
                        }
                        toolArgs.server_label = server.label;
                        toolArgs.host = server.ip;
                    } else if (explicitHost) {
                        const server = await getServerByIp(explicitHost);
                        if (server) {
                            toolArgs.server_label = server.label;
                            toolArgs.host = server.ip;
                        }
                    } else {
                        const server = await resolveServerFromMessage(message.text ?? '');
                        if (!server && (await getAllServers()).length > 1) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: 'Error: Server target is ambiguous. Ask the Pilot which server to use: production (139.84.130.63) or test (65.20.82.177). Do not assume.',
                            });
                            continue;
                        }
                        if (server) {
                            toolArgs.server_label = server.label;
                            toolArgs.host = server.ip;
                        }
                    }
                }
            }

            // AUDIT GUARD — code-level, cannot be overridden by LLM
            if (intent.isAudit && WRITE_TOOLS.has(toolName)) {
                console.warn(`[loop] AUDIT GUARD blocked write tool "${toolName}" during audit`);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `BLOCKED BY AUDIT GUARD: "${toolName}" is a write operation. You are in read-only audit mode. List this as a recommendation only. Do not attempt to fix anything.`,
                });
                continue;
            }

            if (String(toolArgs.server_label ?? '').toLowerCase() === 'all' && WRITE_TOOLS.has(toolName)) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: 'Error: Write operations must target a single server. Choose either production (139.84.130.63) or test (65.20.82.177).',
                });
                continue;
            }

            const toolApproval = getToolApprovalRequest(toolName, toolArgs);
            if (toolApproval) {
                // Ensure session exists in DB before creating approval (FK constraint)
                await upsertSession({
                    id: message.sessionId,
                    channel: message.channel,
                    user_id: message.userId,
                    reply_target: message.replyTarget ?? session?.reply_target ?? null,
                    messages: stripEphemeralMessages(messages) as unknown as Array<Record<string, unknown>>,
                    receipts: serializeReceipts(executionReceipts),
                    iteration,
                });
                const saved = await createApproval({
                    session_id: message.sessionId,
                    command: toolApproval.command,
                    target_host: toolApproval.targetHost,
                    rationale: toolApproval.rationale,
                    tool_call_id: toolCall.id,
                });

                await onApproval({
                    approvalId: saved.id,
                    command: toolApproval.command,
                    targetHost: toolApproval.targetHost,
                    rationale: toolApproval.rationale,
                });

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `Approval requested (ID: ${saved.id}). Tool execution is paused until the user proceeds or rejects.`,
                });

                await onReply(
                    '🔐 *Approval Required*\n\n'
                    + `Target: \`${toolApproval.targetHost}\`\n`
                    + `${toolApproval.rationale}\n`
                    + 'Please click *Proceed* or *Reject* on the card above.\n'
                    + '_If no card appeared, the approval system has an error — check the server logs._'
                );

                await indicator?.update('⏳ Awaiting your decision (Proceed/Reject)...');
                await indicator?.stop(true);

                // FIX BUG (tool id not found): Satisfy any remaining tool calls in this batch
                // before pausing, otherwise the LLM API throws 400 on resume.
                for (const remaining of choice.message.tool_calls) {
                    if (remaining.id !== toolCall.id && !messages.some(m => m.role === 'tool' && 'tool_call_id' in m && m.tool_call_id === remaining.id)) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: remaining.id,
                            content: `Cancelled: Execution paused because '${toolName}' requires human approval.`,
                        });
                    }
                }

                await upsertSession({
                    id: message.sessionId,
                    channel: message.channel,
                    user_id: message.userId,
                    reply_target: message.replyTarget ?? session?.reply_target ?? null,
                    messages: stripEphemeralMessages(messages) as unknown as Array<Record<string, unknown>>,
                    receipts: serializeReceipts(executionReceipts),
                    iteration,
                });
                return;
            }

            // Security check for any "command" argument
            const rawCommand = toolArgs.command as string | undefined;
            if (rawCommand) {
                const filterResult = checkCommand(rawCommand);
                if (!filterResult.safe) {
                    const blockMsg = filterResult.reason ?? 'Command blocked by safety filter';
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `BLOCKED: ${blockMsg}`,
                    });
                    await onReply(`🚫 ${blockMsg}`);
                    continue;
                }

                // Block write commands during audit
                if (intent.isAudit && rawCommand && isWriteCommand(rawCommand)) {
                    console.warn(`[loop] AUDIT GUARD blocked write command during audit: ${rawCommand}`);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `BLOCKED BY AUDIT GUARD: Write command blocked. You are in read-only audit mode. Add this to your recommendations — do not execute it.`,
                    });
                    continue;
                }

                // Check if it needs Tier-3 approval
                const approvalReason = requiresApproval(rawCommand);
                if (approvalReason) {
                    const targetHost = getTargetHostDisplay(toolArgs);
                    // Encode as TOOL: format so resume.ts can decode it later
                    const encodedCommand = encodeToolApprovalCommand(toolName, encodeApprovalArgs({
                        ...toolArgs,
                        command: rawCommand,
                    }));
                    // Ensure session exists in DB before creating approval (FK constraint)
                    await upsertSession({
                        id: message.sessionId,
                        channel: message.channel,
                        user_id: message.userId,
                        reply_target: message.replyTarget ?? session?.reply_target ?? null,
                        messages: stripEphemeralMessages(messages) as unknown as Array<Record<string, unknown>>,
                        receipts: serializeReceipts(executionReceipts),
                        iteration,
                    });
                    const saved = await createApproval({
                        session_id: message.sessionId,
                        command: encodedCommand,
                        target_host: targetHost,
                        rationale: approvalReason,
                        tool_call_id: toolCall.id,
                    });

                    await onApproval({
                        approvalId: saved.id,
                        command: encodedCommand,
                        targetHost,
                        rationale: approvalReason,
                    });

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Approval requested (ID: ${saved.id}). Command execution is paused until the user approves or rejects.`,
                    });

                    await indicator?.update("⏳ Awaiting Pilot approval...");
                    await indicator?.stop(true);

                    // FIX BUG (tool id not found): Satisfy any remaining tool calls in this batch
                    // before pausing, otherwise the LLM API throws 400 on resume.
                    for (const remaining of choice.message.tool_calls) {
                        if (remaining.id !== toolCall.id && !messages.some(m => m.role === 'tool' && 'tool_call_id' in m && m.tool_call_id === remaining.id)) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: remaining.id,
                                content: `Cancelled: Execution paused because '${toolName}' requires human approval.`,
                            });
                        }
                    }

                    await upsertSession({
                        id: message.sessionId,
                        channel: message.channel,
                        user_id: message.userId,
                        reply_target: message.replyTarget ?? session?.reply_target ?? null,
                        messages: stripEphemeralMessages(messages) as unknown as Array<Record<string, unknown>>,
                        receipts: serializeReceipts(executionReceipts),
                        iteration,
                    });
                    return;
                }
            }

            // FIX BUG 4: Wrap tool execution in try/catch so a thrown error
            // doesn't leak out of the loop without persisting the session.
            let result: { success: boolean; output: string };
            let sanitizedOutput = '';
            const receiptHost = String(toolArgs.host ?? toolArgs.server_label ?? 'unknown');
            if (toolName === 'fix_nginx_config' && !hasReceipt(executionReceipts, 'diagnose_nginx', true, RECEIPT_FRESHNESS_MS, receiptHost)) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: 'BLOCKED: Run diagnose_nginx first. The fix cannot proceed without a successful diagnosis receipt.',
                });
                continue;
            }
            const mysqlAction = String(toolArgs.action ?? 'diagnose');
            if (toolName === 'repair_mysql' && mysqlAction === 'repair' && !hasReceipt(executionReceipts, 'repair_mysql:diagnose', true, RECEIPT_FRESHNESS_MS, receiptHost)) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: 'BLOCKED: Run repair_mysql with action="diagnose" first. Repair requires diagnostic receipt.',
                });
                continue;
            }
            const SSH_TOOLS = new Set([
                'execute_ssh_command', 'execute_ssh_write', 'diagnose_nginx',
                'diagnose_services', 'diagnose_domain', 'fix_nginx_config',
                'renew_ssl', 'manage_php', 'repair_mysql', 'cleanup_disk',
                'fix_wordpress', 'create_nginx_vhost'
            ]);
            const sshCallCount = [...currentLegTools].filter(t => SSH_TOOLS.has(t)).length;
            if (sshCallCount >= 30) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: 'BLOCKED: SSH rate limit reached for this session (30 tool executions). Summarize findings and stop.',
                });
                continue;
            }
            try {
                console.log(`[loop] ⚡ EXECUTING TOOL: ${toolName} on target: ${String(toolArgs.server_label ?? toolArgs.host ?? 'N/A')}`);
                if (toolArgs.server_label === 'all') {
                    const servers = await resolveAllServers();
                    const fanoutResults = await Promise.all(
                        servers.map(async (server) => {
                            const output = await tool.execute({
                                ...toolArgs,
                                server_label: server.label,
                                host: server.ip,
                            });
                            return {
                                success: output.success,
                                output: `[${server.label}]\n${output.output}`,
                            };
                        })
                    );
                    result = {
                        success: fanoutResults.every((entry) => entry.success),
                        output: fanoutResults.map((entry) => entry.output).join('\n\n'),
                    };
                } else {
                    result = await tool.execute(toolArgs);
                }

                // Save successful fix to memory (non-fatal, fire-and-forget)
                const MEMORY_TOOLS = new Set([
                    'fix_nginx_config',
                    'fix_wordpress',
                    'renew_ssl',
                    'manage_php',
                    'repair_mysql',
                    'cleanup_disk',
                    'execute_ssh_write',
                    'cloudflare_cache_purge',
                ]);

                const SENSITIVE_PATTERNS = [
                    /private.*key/i,
                    /ssh.*key/i,
                    /password/i,
                    /secret/i,
                    /token/i,
                    /\.env/i,
                ];

                const isSensitive = SENSITIVE_PATTERNS.some(p =>
                    p.test(message.text ?? '') || p.test(JSON.stringify(toolArgs))
                );

                if (result.success && MEMORY_TOOLS.has(toolName) && !isSensitive) {
                    void saveFix(
                        message.text ?? '',
                        `${toolName}: ${JSON.stringify(toolArgs)}`,
                        toolName,
                    ).catch(err => console.warn('[loop] saveFix failed (non-fatal):', err));
                }
            } catch (toolErr: unknown) {
                const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
                console.error(`[loop] ❌ TOOL THREW: ${toolName} — ${errMsg}`);
                result = { success: false, output: `Tool "${toolName}" threw an unexpected error: ${errMsg}` };
            }

            // Sanitize once for both success and error paths
            const sanitized = sanitizeToolOutput(result.output);
            if (sanitized.injections.length > 0) {
                console.warn(`[loop] postToolGuard: blocked injection patterns: ${sanitized.injections.join(', ')}`);
            }
            if (sanitized.masked) {
                console.warn('[loop] postToolGuard: secrets were masked from tool output before storing');
            }
            sanitizedOutput = sanitized.output;
            console.log(`[loop] ✅ TOOL COMPLETE: ${toolName} — success=${result.success}, output length: ${sanitized.output.length} chars`);

            const receiptKey = toolName === 'repair_mysql'
                ? `${toolName}:${mysqlAction}`
                : toolName;
            recordReceipt(
                executionReceipts,
                receiptKey,
                result.success,
                receiptHost,
                sanitizedOutput || result.output
            );
            currentLegTools.add(toolName);

            const toolOutputForMessage = sanitizedOutput.length > 0
                ? sanitizedOutput
                : '[Tool returned empty output]';
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolOutputForMessage,
            });

            // Auto-chain: if diagnose_nginx found a config file error,
            // prompt the LLM (as a user turn) to call fix_nginx_config with the right file
            if (toolName === 'diagnose_nginx' && result.success) {
                const fileMatch = (sanitizedOutput || result.output).match(
                    /in\s+(\/etc\/nginx\/[^\s:]+)[:|\s]/i
                );
                const foundFilePath = fileMatch?.[1];
                if (foundFilePath) {
                    console.log(`[loop] Auto-chain: diagnose found error in ${foundFilePath} — will call fix_nginx_config next`);
                    pendingAutoChain = {
                        name: 'fix_nginx_config',
                        args: {
                            file_path: foundFilePath,
                            server_label: String(toolArgs.server_label ?? 'production'),
                            host: String(toolArgs.host ?? '') // forward the host too if any
                        }
                    };
                }
            }
        }

        // Loop continues for another LLM call with tool results
    }

    // Guard: hit max iterations
    if (iteration >= MAX_ITERATIONS) {
        console.warn('[loop] Max iterations reached');
        await indicator?.stop();
        const escalationText =
            `⚠️ Complex issue — reached reasoning limit after ${iteration} steps.\n\n`
            + `*What I found:*\n${buildProgressSummary(messages)}\n\n`
            + 'Reply with more specific instructions or type `@CloudClaw continue` to keep going.';

        if (message.channel === 'slack' && (message.replyTarget ?? session?.reply_target)) {
            try {
                const { sendSlackMessage } = await import('../interfaces/slack.js');
                await sendSlackMessage(String(message.replyTarget ?? session?.reply_target), escalationText);
            } catch (err) {
                console.warn('[loop] Failed to send Slack escalation directly, falling back to onReply:', err);
                await onReply(escalationText);
            }
        } else {
            await onReply(escalationText);
        }
    }

    // 5. Persist session
    await upsertSession({
        id: message.sessionId,
        channel: message.channel,
        user_id: message.userId,
        reply_target: message.replyTarget ?? session?.reply_target ?? null,
        messages: stripEphemeralMessages(messages) as unknown as Array<Record<string, unknown>>,
        receipts: serializeReceipts(executionReceipts),
        iteration,
    });

    // Note: HITL resume path is implemented in src/hitl/resume.ts.
    // Remaining gaps are Layered Guards and intent classifier per v3.0 plan.
}
function stripEphemeralMessages(
    msgs: OpenAI.ChatCompletionMessageParam[]
): OpenAI.ChatCompletionMessageParam[] {
    return msgs.filter((m: any) => {
        if (m.role === 'user' && typeof m.content === 'string') {
            return !m.content.startsWith('[AUTO-CHAIN]')
                && !m.content.startsWith('[SYSTEM GUARD]')
                && !m.content.startsWith('[SYSTEM]');
        }
        return true;
    });
}
