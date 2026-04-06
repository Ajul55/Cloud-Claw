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
 * ─── REFACTORING v2 (March 2026) ─────────────────────────────────────────────
 *
 * 1. Removed pendingAutoChain — inline auto-chain as direct tool execution
 * 2. Receipt freshness: clear on new intent, added expectedOutputHash
 * 3. Hallucination guard: READ/WRITE receipt split (delegated to hallucination_guard.ts)
 * 4. SSH rate limiter: Map<string, number> instead of Set<string>
 * 5. stripEphemeralMessages: extended filter + session length guard
 * 6. Fanout Promise.all: 30s per-server timeout
 * 7. getToolApprovalRequest: simplified to registry lookup
 * 8. Intent classifier hint: soft suggestion for nginx
 * 9. encodeApprovalArgs: fixed double-encoding
 * 10. dynamicPrompt: clarification injected via SYSTEM_PROMPT parameter
 * 11. SSH key injection blocked (command_filter + tool_guard)
 * 12. Server disambiguation for generic prompts
 * 13-17. Quality fixes (buildProgressSummary, WRITE_TOOLS, messages binding, canRequireTool)
 */

import OpenAI from 'openai';
import { env } from '../config/env.js';
import { getLLMClient } from '../llm/provider.js';
import { getSession, upsertSession, createApproval, getLatestPendingApproval } from '../database/db.js';
import { getLLMToolDefinitions, getToolByName, getAllTools } from '../tools/tool_registry.js';
import { encodeToolApprovalCommand, isInternalApprovalArg, isSensitiveApprovalArg } from '../hitl/tool_approval.js';
import { recordToolUsage } from '../telemetry/ssh_escalation_analyzer.js';
import { checkCommand, requiresApproval, isWriteCommand } from '../security/command_filter.js';
import { classifyIntent, type Intent } from './intent_classifier.js';
import { checkForHallucination } from './hallucination_guard.js';
import { sanitizeToolOutput, checkWriteTarget } from './tool_guard.js';
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
import { setCloudstickUser } from '../api/cloudstick_context.js';
import { getUserByPlatformId, hasCloudstickCredentials } from '../services/user_service.js';
import type {
    IncomingMessage,
    ReplyFn,
    ApprovalFn,
} from '../tools/types.js';

const MAX_ITERATIONS = 15;
// Receipts older than this are considered stale and should not bypass guards
const RECEIPT_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes

// ─── Lazy load WRITE_TOOLS to prevent module init crashes ────────────────────
let WRITE_TOOLS: Set<string> | null = null;
function getWriteTools(): Set<string> {
    if (!WRITE_TOOLS) {
        WRITE_TOOLS = new Set(getAllTools().filter(t => t.approvalTier === 3).map(t => t.name));
    }
    return WRITE_TOOLS;
}

// ─── Hoisted constants (avoid re-creating on every tool call) ──────────────────
const SSH_TOOLS = new Set([
    'execute_ssh_command', 'execute_ssh_write', 'diagnose_nginx',
    'diagnose_services', 'diagnose_domain', 'fix_nginx_config',
    'renew_ssl', 'manage_php', 'repair_mysql', 'cleanup_disk',
    'fix_wordpress', 'create_nginx_vhost'
]);

const MEMORY_TOOLS = new Set([
    'fix_nginx_config', 'fix_wordpress', 'renew_ssl', 'manage_php',
    'repair_mysql', 'cleanup_disk', 'execute_ssh_write', 'cloudflare_cache_purge',
]);

const SENSITIVE_PATTERNS = [
    /private.*key/i, /ssh.*key/i, /password/i,
    /secret/i, /token/i, /\.env/i,
];

// ─── Tools suppressed after an API tool succeeds ────────────────────────────
// Tracks tools that should be blocked because a prior tool already handled the job.
// Keyed by sessionId, cleared on each fresh user message.
const suppressedToolsMap = new Map<string, Set<string>>();

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

// Quality fix #13: rewrite as filter + slice instead of reverse-iterate + .reverse()
function buildProgressSummary(messages: OpenAI.ChatCompletionMessageParam[]): string {
    const summaryLines = messages
        .filter((msg: any) => {
            if (msg.role === 'tool') return true;
            if (msg.role === 'assistant' && typeof msg.content === 'string' && !containsInternalToolSyntax(msg.content)) return true;
            if (msg.role === 'user') return true;
            return false;
        })
        .slice(-5)
        .map((msg: any) => {
            if (msg.role === 'tool') {
                const text = summarizeText(getMessageText(msg.content), 220);
                return text ? `- Tool result: ${text}` : null;
            }
            if (msg.role === 'assistant' && typeof msg.content === 'string') {
                const text = summarizeText(msg.content, 160);
                return text ? `- Assistant: ${text}` : null;
            }
            if (msg.role === 'user') {
                const text = summarizeText(getMessageText(msg.content), 160);
                return text ? `- Pilot: ${text}` : null;
            }
            return null;
        })
        .filter(Boolean) as string[];

    return summaryLines.length > 0
        ? summaryLines.join('\n')
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
    outputOrHash: string,
    isAlreadyHashed = false
): void {
    receipts.set(key, {
        toolName: key.includes(':') ? key.split(':')[0] : key,
        success,
        host,
        timestamp: Date.now(),
        outputHash: isAlreadyHashed ? outputOrHash : hashOutput(outputOrHash ?? ''),
    });
}

// Fix #2: added optional expectedOutputHash parameter
export function hasReceipt(
    receipts: Map<string, ToolReceipt>,
    toolNames: string | string[],
    requireSuccess = false,
    maxAgeMs?: number,
    expectedHost?: string,
    expectedOutputHash?: string
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
        if (expectedOutputHash && rec.outputHash !== expectedOutputHash) return false;
        return true;
    });
}

// ─── Fix #9: encodeApprovalArgs — no double-encoding ─────────────────────────
function encodeApprovalArgs(toolArgs: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(toolArgs)
            .filter(([key]) => !isInternalApprovalArg(key) && !isSensitiveApprovalArg(key))
            .map(([key, value]) => {
                if (typeof value === 'string') return [key, value]; // already a string, never re-encode
                if (Array.isArray(value) || (value && typeof value === 'object')) return [key, JSON.stringify(value)];
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

export function intentRequiresServerTarget(intent: Pick<Intent, 'requiresTool' | 'toolHint'>): boolean {
    if (!intent.requiresTool) {
        return false;
    }

    const hintedTool = intent.toolHint !== 'none'
        ? getToolByName(intent.toolHint)
        : null;

    if (!hintedTool) {
        return true;
    }

    return toolSupportsServerRouting(hintedTool);
}

// ─── Fix #7: Simplified getToolApprovalRequest — registry lookup with fallback
function getToolApprovalRequest(
    toolName: string,
    toolArgs: Record<string, unknown>
): { command: string; targetHost: string; rationale: string } | null {
    const tool = getToolByName(toolName);
    if (!tool) return null;

    // Check if tool has its own approval request builder
    if (tool.getApprovalRequest) {
        return tool.getApprovalRequest(toolArgs);
    }

    // Check approval tier from registry
    if (tool.approvalTier === 3) {
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs(toolArgs)),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: tool.getRationale?.(toolArgs)
                ?? `This action will run ${toolName} on ${getTargetHostDisplay(toolArgs)}.`,
        };
    }

    return null;
}

// ─── Fix #6: Fanout timeout helper ────────────────────────────────────────────
function withTimeout(
    p: Promise<{ success: boolean; output: string }>,
    ms: number,
    label: string
): Promise<{ success: boolean; output: string }> {
    return Promise.race([
        p,
        new Promise<{ success: boolean; output: string }>(res =>
            setTimeout(() => res({ success: false, output: `[${label}] Timed out after ${ms / 1000}s` }), ms)
        ),
    ]);
}

// ─── Fix #5: Extended stripEphemeralMessages ──────────────────────────────────
function stripEphemeralMessages(
    msgs: OpenAI.ChatCompletionMessageParam[]
): OpenAI.ChatCompletionMessageParam[] {
    const filtered = msgs.filter((m: any) => {
        // Strip user-role ephemeral messages
        if (m.role === 'user' && typeof m.content === 'string') {
            if (m.content.startsWith('[AUTO-CHAIN]')
                || m.content.startsWith('[AUTO')
                || m.content.startsWith('[SYSTEM GUARD]')
                || m.content.startsWith('[SYSTEM]')
                || m.content.startsWith('[HALLUCINATION')
                || m.content.startsWith('[GUARD')
            ) {
                return false;
            }
        }
        // Strip assistant-role messages with [AUTO-CHAIN] content (legacy cleanup)
        if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('[AUTO-CHAIN]')) {
            return false;
        }
        return true;
    });

    // Session length guard: cap at 40 messages from a clean user-role boundary
    if (filtered.length > 60) {
        let startIndex = filtered.length - 40;
        while (startIndex < filtered.length && filtered[startIndex].role !== 'user') {
            startIndex++;
        }
        if (startIndex >= filtered.length) {
            // Fallback: no user message found, trim strictly to 40 but drop leading tools
            startIndex = filtered.length - 40;
            while (startIndex < filtered.length && filtered[startIndex].role === 'tool') startIndex++;
        }
        return filtered.slice(startIndex);
    }

    return filtered;
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
    // 0. Clear any suppressed-tools state from prior turns in this session
    suppressedToolsMap.delete(message.sessionId);

    // 1. Load or create session
    const session = await getSession(message.sessionId);

    // 1b. Multi-tenant: set per-user Cloudstick credentials for this request
    try {
        const user = await getUserByPlatformId(message.channel, message.userId);
        if (user && hasCloudstickCredentials(user)) {
            setCloudstickUser(user);
        } else {
            setCloudstickUser(null);
        }
    } catch (err) {
        console.warn('[loop] User credential lookup failed (non-fatal):', err);
        setCloudstickUser(null);
    }
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

    // Fast-path: user explicitly typed proceed/approve/reject while an approval is pending
    const normalized = (message.text ?? '').trim().toLowerCase();
    const pending = await getLatestPendingApproval(message.sessionId);
    if (normalized && pending) {
        if (['proceed', 'approve', 'yes', 'apply', 'fix', 'do it'].some(k => normalized === k)) {
            await resumeApprovedSession(pending.id, true, message.userId, onReply, onApproval);
            await indicator?.stop(true);
            return;
        }
        if (['reject', 'no', 'stop', 'cancel'].some(k => normalized === k)) {
            await resumeApprovedSession(pending.id, false, message.userId, onReply, onApproval);
            await indicator?.stop(true);
            return;
        }
    }

    // Fix #2: Clear receipts on new user intent (not a resume)
    const isFastPathApproval = message.text && pending && ['proceed', 'approve', 'yes', 'apply', 'fix', 'do it'].some(k => normalized === k);
    const isFastPathRejection = message.text && pending && ['reject', 'no', 'stop', 'cancel'].some(k => normalized === k);
    const isResume = (Array.isArray(message.resumedTools) && message.resumedTools.length > 0) || isFastPathApproval || isFastPathRejection;

    let executionReceipts: Map<string, ToolReceipt>;
    if (message.text && !isResume) {
        // New user intent — start fresh, don't inherit receipts from previous conversation turns
        executionReceipts = new Map<string, ToolReceipt>();
        console.log('[loop] New user intent detected — cleared previous receipts');
    } else {
        executionReceipts = loadReceiptsFromSession(session?.receipts);
    }

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

    // Fix #4: Track tools executed in this loop leg with counts (not a Set)
    const currentLegCounts = new Map<string, number>();

    await indicator?.start('🔍 Analysing your request...');

    const intent = await classifyIntent(message.text ?? '');
    const requiresTool = intent.requiresTool;
    const requiresCloudstickConnection = intent.toolHint === 'check_cloudstick_connection';
    const requiresCloudflarePurge = intent.toolHint === 'cloudflare_cache_purge';
    const requiresDomainDiagnosis = intent.toolHint === 'diagnose_domain';
    const requiresNginx = intent.toolHint === 'diagnose_nginx';
    const requiresSslCheck = intent.toolHint === 'check_ssl_api';
    const requiresWebsiteList = intent.toolHint === 'get_cloudstick_websites';
    const requiresServerDetails = intent.toolHint === 'get_server_details';
    const requiresWpDetails = intent.toolHint === 'get_wordpress_details';

    // ─── Session trimming & Sanitation ─────────────────────────────────────────
    // Sanitize any existing corrupted history (e.g., from previous bad trims)
    // where a tool response was left orphaned without its assistant tool_call.
    while (messages.length > 0 && messages[0].role === 'tool') {
        messages.shift();
        console.log('[loop] Shifted orphaned tool message from beginning of history');
    }

    // If the user is sending a new message (not a resume) and the session has many
    // old messages, trim to prevent context pollution from previous conversations.
    // Fix #15: use let reassignment instead of in-place mutation
    const userTurnCount = messages.filter((m: any) => m.role === 'user').length;
    if (message.text && !isResume && userTurnCount > 3) {
        let startIndex = messages.length - 6;
        // Move backwards to find a clean boundary (user message) so we don't sever
        // an assistant tool_call from its tool responses.
        while (startIndex > 0 && messages[startIndex].role !== 'user') {
            startIndex--;
        }
        messages = messages.slice(startIndex);
        console.log(`[loop] Trimmed session safely to ${messages.length} messages`);
    }

    // ─── Fix #12: Server disambiguation for generic prompts ────────────────
    // Placed AFTER session sanitization so persisted messages are clean.
    const isGenericWithoutServer = intentRequiresServerTarget(intent)
        && (!intent.targetServer || intent.targetServer === 'unknown');
    if (intent.requiresServerClarification || isGenericWithoutServer) {
        const allServers = await getAllServers();
        if (allServers.length > 1 && isGenericWithoutServer) {
            const serverList = allServers.map(s => `• ${s.label} (${s.ip})`).join('\n');
            await onReply(
                `Which server should I run this on?\n${serverList}\n\nReply with the server name (e.g. "production" or "test").`
            );
            await upsertSession({
                id: message.sessionId,
                channel: message.channel,
                user_id: message.userId,
                reply_target: message.replyTarget ?? session?.reply_target ?? null,
                messages: stripEphemeralMessages(messages) as unknown as Array<Record<string, unknown>>,
                receipts: serializeReceipts(executionReceipts),
                iteration,
            });
            await indicator?.stop(true);
            return;
        }
    }

    const toolDefinitions = getLLMToolDefinitions();
    // Fix #17: centralise canRequireTool guard
    const canRequireTool = toolDefinitions.length > 0;

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

    // Fix #10: clarification injected via SYSTEM_PROMPT parameter, not prepended
    const clarificationBlock = shouldPauseForClarification
        ? `Before acting, summarize: (1) what the desired state is, (2) what has already been tried,
(3) your root cause hypothesis. Ask Pilot to confirm before making any changes.

Recent tool attempts:
${priorToolLines || 'No prior tool outputs recorded.'}`
        : undefined;

    let cloudstickServersStr: string | undefined = undefined;
    const { getCloudstickUser } = await import('../api/cloudstick_context.js');
    const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
    
    if (effectiveUserId) {
        try {
            const { getCloudstickClient } = await import('../api/cloudstick_client.js');
            const client = getCloudstickClient();
            const response = await client.listServersByUser(effectiveUserId);
            if (response?.message?.servers?.length) {
                cloudstickServersStr = response.message.servers
                    .map((s: any) => `  - ${s.name} → ${s.ip4} (ID: ${s.id})`)
                    .join('\n');
            }
        } catch (err) {
            console.warn('[loop] Failed to fetch live Cloudstick servers for system prompt:', err instanceof Error ? err.message : String(err));
        }
    }

    while (iteration < MAX_ITERATIONS) {
        iteration++;
        console.log(`[loop] Iteration ${iteration}/${MAX_ITERATIONS} — session: ${message.sessionId}`);

        // Fix #11: Base prompt is built inside the loop so clarification block stays fresh
        const baseSystemPrompt = SYSTEM_PROMPT({
            sshHost: '139.84.130.63',
            sshUser: 'root',
            pastFixes: pastFixesStr || undefined,
            clarificationBlock,
            cloudstickServers: cloudstickServersStr,
        });

        // Fix #8: rebuild nginx hint per-iteration so it only appears when no tools have run
        let dynamicPromptHint = '';
        if (requiresNginx && iteration === 1 && !hasReceipt(executionReceipts, 'diagnose_nginx', true, RECEIPT_FRESHNESS_MS)) {
            dynamicPromptHint = 'Hint: this query is likely nginx-related. Start with diagnose_nginx unless PHP or MySQL symptoms are more prominent.\n\n';
        }
        const fullSystemPrompt = dynamicPromptHint + baseSystemPrompt;

        // ─── tool_choice logic ─────────────────────────────────────────────
        const lastMsg = messages[messages.length - 1];
        const isMidChain = lastMsg?.role === 'tool';
        const isFirstToolCall = requiresTool && iteration === 1;

        const shouldRequireTool = canRequireTool && (isMidChain || isFirstToolCall);

        let toolChoice: OpenAI.ChatCompletionToolChoiceOption;
        if (shouldPauseForClarification && iteration === 1) {
            toolChoice = 'none';
            console.log('[loop] Forcing tool_choice: none (long conversation clarification gate)');
        } else if (requiresCloudstickConnection && iteration === 1 && !hasReceipt(executionReceipts, 'check_cloudstick_connection', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = canRequireTool
                ? { type: 'function', function: { name: 'check_cloudstick_connection' } }
                : 'auto';
            console.log('[loop] Forcing tool_choice: check_cloudstick_connection (explicit Cloudstick connectivity check detected)');
        } else if (requiresCloudflarePurge && iteration === 1 && !hasReceipt(executionReceipts, 'cloudflare_cache_purge', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = canRequireTool
                ? { type: 'function', function: { name: 'cloudflare_cache_purge' } }
                : 'auto';
            console.log('[loop] Forcing tool_choice: cloudflare_cache_purge (explicit cache purge request detected)');
        } else if (requiresDomainDiagnosis && iteration === 1 && !hasReceipt(executionReceipts, 'diagnose_domain', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = canRequireTool
                ? { type: 'function', function: { name: 'diagnose_domain' } }
                : 'auto';
            console.log('[loop] Forcing tool_choice: diagnose_domain (domain routing query detected)');
        } else if (requiresSslCheck && iteration === 1 && !hasReceipt(executionReceipts, 'check_ssl_api', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = canRequireTool
                ? { type: 'function', function: { name: 'check_ssl_api' } }
                : 'auto';
            console.log('[loop] Forcing tool_choice: check_ssl_api (SSL status query detected)');
        } else if (requiresWebsiteList && iteration === 1 && !hasReceipt(executionReceipts, 'get_cloudstick_websites', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = canRequireTool
                ? { type: 'function', function: { name: 'get_cloudstick_websites' } }
                : 'auto';
            console.log('[loop] Forcing tool_choice: get_cloudstick_websites (website listing query detected)');
        } else if (requiresServerDetails && iteration === 1 && !hasReceipt(executionReceipts, 'get_server_details', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = canRequireTool
                ? { type: 'function', function: { name: 'get_server_details' } }
                : 'auto';
            console.log('[loop] Forcing tool_choice: get_server_details (server details query detected)');
        } else if (requiresWpDetails && iteration === 1 && !hasReceipt(executionReceipts, 'get_wordpress_details', true, RECEIPT_FRESHNESS_MS)) {
            toolChoice = canRequireTool
                ? { type: 'function', function: { name: 'get_wordpress_details' } }
                : 'auto';
            console.log('[loop] Forcing tool_choice: get_wordpress_details (WordPress details query detected)');
        } else if (requiresNginx && iteration === 1 && !hasReceipt(executionReceipts, 'diagnose_nginx', true, RECEIPT_FRESHNESS_MS)) {
            // Fix #8: soft suggestion — require A tool but don't mandate which one
            toolChoice = shouldRequireTool ? 'required' : 'auto';
            console.log('[loop] Nginx hint injected into prompt — requiring a tool call (soft, not forced)');
        } else {
            toolChoice = shouldRequireTool ? 'required' : 'auto';
        }
        // ──────────────────────────────────────────────────────────────────────

        // 3. Call LLM
        let choice: OpenAI.ChatCompletion.Choice;
        let reqStart = Date.now();
        const { client: openai, model: activeModel } = getLLMClient();
        let reqLatency = 0;

        // One final strict sanitization pass: ensure absolutely NO orphaned tool messages remain.
        // First pass cleans the global `messages` array of any pre-existing orphan corruption.
        const globalValidToolIds = new Set<string>();
        messages = messages.filter((msg: any) => {
            if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
                msg.tool_calls.forEach((tc: any) => {
                    if (tc.id) globalValidToolIds.add(tc.id);
                });
            } else if (msg.role === 'tool') {
                if (!msg.tool_call_id || !globalValidToolIds.has(msg.tool_call_id)) {
                    console.warn(`[loop] Dropping globally orphaned tool message with ID ${msg.tool_call_id}`);
                    return false;
                }
            }
            return true;
        });

        try {
            // Trim session to last 20 messages before each LLM call (Fix for BUG-10)
            // Always keep the first message (original request context)
            const MAX_HISTORY = 20;
            let trimmedMessages = messages.length > MAX_HISTORY
                ? [messages[0], ...messages.slice(-MAX_HISTORY + 1)]
                : messages;

            // Second pass cleans any orphans created BY the trim slice itself, which
            // guarantees we never hit the 2013 "tool id not found" provider error.
            const trimmedValidToolIds = new Set<string>();
            trimmedMessages = trimmedMessages.filter((msg: any) => {
                if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    msg.tool_calls.forEach((tc: any) => {
                        if (tc.id) trimmedValidToolIds.add(tc.id);
                    });
                } else if (msg.role === 'tool') {
                    if (!msg.tool_call_id || !trimmedValidToolIds.has(msg.tool_call_id)) {
                        console.warn(`[loop] Dropping orphaned tool message from trimmed window with ID ${msg.tool_call_id}`);
                        return false; 
                    }
                }
                return true;
            });

            console.log(`[loop] Outgoing messages to API (trimmed from ${messages.length} to ${trimmedMessages.length})`);
            
            const response = await openai.chat.completions.create({
                model: activeModel,
                messages: [{ role: 'system', content: fullSystemPrompt }, ...trimmedMessages],
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
                    role: 'user',
                    content:
                        '[SYSTEM] Tool syntax detected in your last response. '
                        + 'Do not output functions.* or <minimax:tool_call> syntax. '
                        + 'Call tools via the tool API only.',
                });
                continue;
            }

            // ─── Fix #3: Hallucination detection — delegated to hallucination_guard.ts ──
            const isHallucination = checkForHallucination(text, executionReceipts, RECEIPT_FRESHNESS_MS);

            if (isHallucination) {
                console.error('[loop] HALLUCINATION DETECTED — LLM claimed success without sufficient tool execution');
                console.error('[loop] Execution receipts so far:', [...executionReceipts.keys()]);
                await indicator?.update('⚠️ Need real diagnostics — re-running with tools...');
                await onReply('⚠️ I need to verify this with real diagnostics. Running tools now — you may see a short pause.');
                messages.push({ role: 'assistant', content: text });
                messages.push({
                    role: 'user',
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

            if (requiresTool && executionReceipts.size === 0) {
                console.error('[loop] LLM avoided tool call despite tool_choice:required — possible provider issue or missing tool');
                console.error('[loop] Raw text returned instead of tool call:', text);
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

            // ─── Suppression guard: block tools made redundant by a prior API tool ─
            const suppressed = suppressedToolsMap.get(message.sessionId);
            if (suppressed?.has(toolName)) {
                console.warn(`[loop] SUPPRESSED: "${toolName}" is redundant after a prior API tool in this session`);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `BLOCKED: "${toolName}" is not needed — the Cloudstick API already handled this operation. Do not re-run this command.`,
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
                                content: `Error: Server "${explicitLabel}" not found. Please review the REGISTERED SERVERS list in the system prompt.`,
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
                        // No server explicitly specified by the LLM
                        const isWriteOp = (tool.approvalTier ?? 0) >= 2;

                        if (isWriteOp) {
                            // ─── Fix 1: Single-Server Write Lock ──────────────────────
                            // Write operations MUST have an explicit server reference.
                            // Even if only one server exists, we stop and ask.
                            const allServers = await getAllServers();
                            const serverList = allServers.map(s => `• ${s.label} (${s.ip})`).join('\n');
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: `BLOCKED: Write operations require an explicit server target. `
                                    + `The user did not specify which server to run "${toolName}" on.\n`
                                    + `Available servers:\n${serverList}\n\n`
                                    + `Ask the user: "Which server should I run this on?" and wait for their answer. `
                                    + `Do NOT guess or default.`,
                            });
                            continue;
                        }

                        // Read-only tools can silently default
                        const server = await resolveServerFromMessage(message.text ?? '');
                        if (server) {
                            toolArgs.server_label = server.label;
                            toolArgs.host = server.ip;
                        }
                    }
                }
            }

            // AUDIT GUARD — code-level, cannot be overridden by LLM
            if (intent.isAudit && getWriteTools().has(toolName)) {
                console.warn(`[loop] AUDIT GUARD blocked write tool "${toolName}" during audit`);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `BLOCKED BY AUDIT GUARD: "${toolName}" is a write operation. You are in read-only audit mode. List this as a recommendation only. Do not attempt to fix anything.`,
                });
                continue;
            }

            if (String(toolArgs.server_label ?? '').toLowerCase() === 'all' && getWriteTools().has(toolName)) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: 'Error: Write operations must target a single registered server.',
                });
                continue;
            }

            // Fix #11b: Block execute_ssh_write to SSH-sensitive paths
            if (toolName === 'execute_ssh_write' && ('path' in toolArgs || 'file_path' in toolArgs)) {
                const writeGuardReason = checkWriteTarget(toolArgs as any);
                if (writeGuardReason) {
                    console.warn(`[loop] SSH write path guard blocked: ${writeGuardReason}`);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `BLOCKED: ${writeGuardReason}`,
                    });
                    continue;
                }
            }

            const toolApproval = getToolApprovalRequest(toolName, toolArgs);
            if (toolApproval) {
                // ─── Fix 3: Pre-flight state snapshot ──────────────────────────
                // Capture resource state now so resume.ts can detect drift later.
                if (tool.getCurrentState) {
                    try {
                        const stateSnapshot = await tool.getCurrentState(toolArgs);
                        const stateHash = createHash('sha256').update(stateSnapshot).digest('hex').slice(0, 16);
                        // Embed in the command string so it survives serialisation
                        toolApproval.command += `|__stateHash=${encodeURIComponent(stateHash)}`;
                        console.log(`[loop] State hash captured for ${toolName}: ${stateHash}`);
                    } catch (err) {
                        console.warn(`[loop] getCurrentState failed for ${toolName}, skipping hash:`, err);
                    }
                }

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
                const isWriteTool = toolName === 'execute_ssh_write';
                const filterResult = checkCommand(rawCommand, isWriteTool);
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

                    await onReply(
                        '🔐 *Approval Required*\n\n'
                        + `Target: \`${targetHost}\`\n`
                        + `${approvalReason}\n`
                        + 'Please click *Proceed* or *Reject* on the card above.\n'
                        + '_If no card appeared, the approval system has an error — check the server logs._'
                    );

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

            // Fix #4: wire expectedOutputHash — the diagnose receipt must match the target file path
            const expectedHash = String(toolArgs.file_path ?? '') ? hashOutput(String(toolArgs.file_path)) : undefined;
            if (toolName === 'fix_nginx_config' && !hasReceipt(executionReceipts, 'diagnose_nginx', true, RECEIPT_FRESHNESS_MS, receiptHost, expectedHash)) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: 'BLOCKED: Run diagnose_nginx first. The fix cannot proceed without a successful diagnosis receipt for this specific file path.',
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

            // Fix #4: SSH rate limiter — sum counts from Map (SSH_TOOLS hoisted to module scope)
            const sshCallCount = [...currentLegCounts.entries()]
                .filter(([t]) => SSH_TOOLS.has(t))
                .reduce((sum, [, n]) => sum + n, 0);
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
                    // Fix #6: wrap each fanout promise in a 30s timeout
                    const fanoutResults = await Promise.all(
                        servers.map(server => withTimeout(
                            tool.execute({
                                ...toolArgs,
                                server_label: server.label,
                                host: server.ip,
                            }).then(output => ({
                                success: output.success,
                                output: `[${server.label}]\n${output.output}`,
                            })),
                            30_000,
                            server.label
                        ))
                    );
                    result = {
                        success: fanoutResults.every((entry) => entry.success),
                        output: fanoutResults.map((entry) => entry.output).join('\n\n'),
                    };
                } else {
                    result = await tool.execute(toolArgs);
                }

                // ─── Phase 4: Record tool usage for SSH escalation analysis ──
                recordToolUsage(toolName, message.sessionId, result.success);

                // Save successful fix to memory (MEMORY_TOOLS/SENSITIVE_PATTERNS hoisted to module scope)
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

                // ─── Register suppressed tools after successful API tool ───────────
                if (result.success && tool.suppressTools) {
                    if (!suppressedToolsMap.has(message.sessionId)) {
                        suppressedToolsMap.set(message.sessionId, new Set());
                    }
                    for (const suppressed of tool.suppressTools) {
                        suppressedToolsMap.get(message.sessionId)!.add(suppressed);
                        console.log(`[loop] Suppressing redundant tool: ${suppressed} (suppressed by ${toolName})`);
                    }
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

            // For diagnose_nginx, if it successfully found a path, use its hash so fix_nginx_config can verify it
            let receiptOutputOrHash = sanitizedOutput || result.output;
            let isAlreadyHashed = false;

            if (toolName === 'diagnose_nginx' && result.success) {
                const fileMatch = (sanitizedOutput || result.output).match(/in\s+(\/etc\/nginx\/[^\s:]+)[:|\s]/i);
                if (fileMatch?.[1]) {
                    receiptOutputOrHash = hashOutput(fileMatch[1]);
                    isAlreadyHashed = true;
                }
            }

            const receiptKey = toolName === 'repair_mysql'
                ? `${toolName}:${mysqlAction}`
                : toolName;
            recordReceipt(
                executionReceipts,
                receiptKey,
                result.success,
                receiptHost,
                receiptOutputOrHash,
                isAlreadyHashed
            );
            // Fix #4: increment tool count in Map
            currentLegCounts.set(toolName, (currentLegCounts.get(toolName) ?? 0) + 1);

            const toolOutputForMessage = sanitizedOutput.length > 0
                ? sanitizedOutput
                : '[Tool returned empty output]';

            // ─── Phase 1: Exact Fingerprint Loop Detection ────────────────────────
            let identicalCount = 0;
            const currentArgsStr = JSON.stringify(toolArgs);
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i] as any;
                if (msg.role === 'tool' && msg.content === toolOutputForMessage && msg.tool_call_id) {
                    // Walk backwards to find the parent assistant message with tool_calls
                    for (let j = i - 1; j >= 0; j--) {
                        const candidate = messages[j] as any;
                        if (candidate.role === 'assistant' && candidate.tool_calls) {
                            const callMatch = candidate.tool_calls.find((tc: any) => tc.id === msg.tool_call_id);
                            if (callMatch?.function?.name === toolName && callMatch?.function?.arguments === currentArgsStr) {
                                identicalCount++;
                            }
                            break; // stop searching once we find the parent
                        }
                        // If we hit a user message, the parent is missing — stop
                        if (candidate.role === 'user') break;
                    }
                }
            }

            if (identicalCount >= 2) { 
                 console.warn(`[loop] 🛑 LOOP GUARD BLOCKED: ${toolName} with identical args repeated 3 times.`);
                 messages.push({
                     role: 'tool',
                     tool_call_id: toolCall.id,
                     content: 'BLOCKED BY LOOP DETECTOR: You have executed this exact tool with these parameters 3 times and received the exact same output. Stop repeating this action. Summarize the failure and ask the human for help.'
                 });
                 continue; 
            }

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolOutputForMessage,
            });

            // Fix #1: Auto-chain — route through HITL approval gate
            if (toolName === 'diagnose_nginx' && result.success && isAlreadyHashed) {
                // We know fileMatch succeeded. The expected hash for the fix will be the exact same.
                const fileMatch = (sanitizedOutput || result.output).match(/in\s+(\/etc\/nginx\/[^\s:]+)[:|\s]/i);
                const foundFilePath = fileMatch![1];

                console.log(`[loop] Auto-chain: diagnose found error in ${foundFilePath} — requesting approval for fix_nginx_config`);
                const fixTool = getToolByName('fix_nginx_config');
                if (fixTool) {
                    const fixArgs: Record<string, unknown> = {
                        file_path: foundFilePath,
                        server_label: String(toolArgs.server_label ?? 'production'),
                        host: String(toolArgs.host ?? ''),
                    };
                    const fixCallId = `call_autochain_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

                    // Check receipt pre-condition: diagnose_nginx must have succeeded on same host
                    if (!hasReceipt(executionReceipts, 'diagnose_nginx', true, RECEIPT_FRESHNESS_MS, receiptHost)) {
                        console.warn('[loop] Auto-chain: diagnose_nginx receipt check failed despite just running — skipping');
                    } else {
                        // Route through the approval gate — fix_nginx_config is Tier-3
                        const fixApproval = getToolApprovalRequest('fix_nginx_config', fixArgs);
                        if (fixApproval) {
                            // Inject a proper assistant tool_call so the message history stays valid
                            messages.push({
                                role: 'assistant',
                                content: null,
                                tool_calls: [{
                                    id: fixCallId,
                                    type: 'function' as const,
                                    function: {
                                        name: 'fix_nginx_config',
                                        arguments: JSON.stringify(fixArgs),
                                    },
                                }],
                            });

                            // Create approval and pause
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
                                command: fixApproval.command,
                                target_host: fixApproval.targetHost,
                                rationale: `Auto-detected nginx config error in ${foundFilePath}. ${fixApproval.rationale}`,
                                tool_call_id: fixCallId,
                            });

                            await onApproval({
                                approvalId: saved.id,
                                command: fixApproval.command,
                                targetHost: fixApproval.targetHost,
                                rationale: `Auto-detected nginx config error in ${foundFilePath}. ${fixApproval.rationale}`,
                            });

                            messages.push({
                                role: 'tool',
                                tool_call_id: fixCallId,
                                content: `Approval requested (ID: ${saved.id}). Auto-chain fix paused until user proceeds or rejects.`,
                            });

                            await onReply(
                                `🔍 Found nginx config error in \`${foundFilePath}\`.\n\n`
                                + '🔐 *Approval Required* to apply the fix.\n'
                                + 'Please click *Proceed* or *Reject* on the card above.'
                            );

                            await indicator?.update('⏳ Awaiting your decision (Proceed/Reject)...');
                            await indicator?.stop(true);

                            // FIX BUG: Satisfy any remaining tool calls in this batch
                            for (const remaining of choice.message.tool_calls) {
                                if (remaining.id !== toolCall.id && !messages.some(m => m.role === 'tool' && 'tool_call_id' in m && m.tool_call_id === remaining.id)) {
                                    messages.push({
                                        role: 'tool',
                                        tool_call_id: remaining.id,
                                        content: `Cancelled: Execution paused because auto-chain 'fix_nginx_config' requires human approval.`,
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
                            return; // PAUSE — wait for HITL
                        } else {
                            // No approval required (shouldn't happen for Tier-3, but safety fallback)
                            console.warn('[loop] Auto-chain: fix_nginx_config did not require approval — executing directly');

                            // Audit Guard for direct execution
                            if (intent.isAudit && getWriteTools().has('fix_nginx_config')) {
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: fixCallId,
                                    content: `BLOCKED BY AUDIT GUARD: "fix_nginx_config" is a write operation. You are in read-only audit mode.`,
                                });
                                continue;
                            }

                            // Rate Limiter Guard for direct execution
                            if (sshCallCount >= 30) {
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: fixCallId,
                                    content: `BLOCKED: SSH rate limit reached for this session (30 tool executions).`,
                                });
                                continue;
                            }

                            const fixResult = await fixTool.execute(fixArgs);

                            messages.push({
                                role: 'assistant',
                                content: null,
                                tool_calls: [{
                                    id: fixCallId,
                                    type: 'function' as const,
                                    function: {
                                        name: 'fix_nginx_config',
                                        arguments: JSON.stringify(fixArgs),
                                    },
                                }],
                            });

                            const fixSanitized = sanitizeToolOutput(fixResult.output);
                            messages.push({
                                role: 'tool',
                                tool_call_id: fixCallId,
                                content: fixSanitized.output,
                            });

                            recordReceipt(executionReceipts, 'fix_nginx_config', fixResult.success, receiptHost, fixSanitized.output);
                            currentLegCounts.set('fix_nginx_config', (currentLegCounts.get('fix_nginx_config') ?? 0) + 1);
                            console.log(`[loop] ✅ AUTO-CHAIN COMPLETE: fix_nginx_config — success=${fixResult.success}`);
                        }
                    }
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

    // 6. Clear per-user context
    setCloudstickUser(null);
}
