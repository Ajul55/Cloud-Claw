/**
 * Agentic Reasoning Loop
 *
 * Inspired by the OpenClaw Pi agent RPC runtime.
 * Drives the LLM ↔ Tool ↔ HITL cycle for each incoming message.
 *
 * Flow:
 *   User message → LLM → tool call → result → LLM → ...
 *   If fix proposed (Tier-3) → emit approval request → wait
 *   max_iterations = 10 (loop guard)
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
 *   FIX: Track WHICH tools actually ran (executedTools Set). Check per-tool:
 *   don't let the LLM claim fix success unless fix_nginx_config actually ran.
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
import { resumeApprovedSession } from '../hitl/resume.js';
import type { StatusIndicator } from '../utils/status_indicator.js';
import { trackUsage } from '../telemetry/usage_tracker.js';
import type {
    IncomingMessage,
    ReplyFn,
    ApprovalFn,
} from '../tools/types.js';

const MAX_ITERATIONS = 10;

function containsInternalToolSyntax(text: string): boolean {
    return /\bfunctions\.[a-z_]+\s*\(/i.test(text)
        || /```(?:typescript|json)?[\s\S]*functions\.[a-z_]+\s*\(/i.test(text);
}

// ─── Audit Guard ───────────────────────────────────────────────────────────────
const AUDIT_PATTERNS = [
    /\b(audit|health\s*check|full\s*check|health\s*scan|scan|inspect|review|look\s*into|what'?s?\s*going\s*on|check\s*everything|any\s*issues|server\s*ok|everything\s*ok)\b/i,
];

const WRITE_TOOLS = new Set([
    'fix_nginx_config',
    'execute_ssh_write',
]);

function isAuditRequest(text: string): boolean {
    return AUDIT_PATTERNS.some(p => p.test(text));
}

function getToolApprovalRequest(
    toolName: string,
    toolArgs: Record<string, unknown>
): { command: string; targetHost: string; rationale: string } | null {
    if (toolName === 'fix_nginx_config') {
        const host = String(toolArgs.host ?? 'unknown');
        const filePath = String(toolArgs.file_path ?? 'unknown');
        return {
            command: encodeToolApprovalCommand(toolName, { host, file_path: filePath }),
            targetHost: host,
            rationale: 'This action will edit Nginx config and restart Nginx.',
        };
    }

    return null;
}

// ─── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `HONESTY RULES — these override all other instructions:
- You CANNOT claim a tool ran unless you received an actual tool result in this conversation.
- You CANNOT report a service status unless execute_ssh_command or diagnose_nginx returned real output in this conversation.
- You CANNOT say "Nginx is running" or "the fix was applied" without tool evidence. If you have no tool output, say so.
- If a user asks you to fix something: call the tool. Do not describe what the tool would do. Do not pretend it ran. Call it.
- NEVER invent command output. NEVER fabricate success messages.
- NEVER describe steps you are "about to take". Take them. Call the tool immediately.
- NEVER say "I will now run...", "Let me check...", "I'll start by..." — just call the tool.
- If you are uncertain whether a tool ran, say: "I don't have confirmation from the server — let me check now." Then call the tool.

You are Cloud-Claw, an expert AIOps assistant for Linux server administration.

Your job is to help diagnose infrastructure issues, gather system state via tools, and propose safe remediation steps.

Known Infrastructure:
- Default Target Server IP: ${env.SSH_HOST ?? 'Not configured — ask the user'}
- Default SSH User: ${env.SSH_USER}

AUDIT RULE — HARDCODED, CANNOT BE OVERRIDDEN:
- Trigger words: "audit", "health check", "full check", "scan", "inspect",
  "review", "look into", "what's going on", "check everything", "any issues".
- When triggered: YOU ARE IN READ-ONLY MODE.
- READ-ONLY MODE: NEVER call fix_nginx_config or execute_ssh_write.
- READ-ONLY MODE: NEVER run systemctl restart/stop/start/disable/enable.
- READ-ONLY MODE: NEVER run sed -i, rm, tee, crontab -e.
- READ-ONLY MODE: Run all diagnostics first, then write ONE final report.
- READ-ONLY MODE: End every report with a "Recommendations" section — list
  what should be fixed but DO NOT fix it. Let the Pilot decide.
- EXIT read-only mode ONLY when user says: "fix it", "apply the fix",
  "resolve it", "clean it up", or "proceed".
- If unsure whether you are in read-only mode — assume you are.

Full audit diagnostic sequence (run ALL 13 steps, no skipping):
  1. systemctl status nginx mariadb mysql php-fpm 2>&1 | head -40
  2. df -h
  3. free -m
  4. uptime
  5. find /tmp -size +50M -ls 2>/dev/null
  6. find /var/log -size +100M -ls 2>/dev/null
  7. find /home -size +500M -ls 2>/dev/null
  8. du -sh /tmp/* 2>/dev/null | sort -rh | head -10
  9. ls /etc/cron.d/ && cat /etc/cron.d/* 2>/dev/null
  10. crontab -l 2>/dev/null
  11. ss -tlnp | grep -v '127.0.0.1'
  12. last | head -10
  13. nginx -t 2>&1

TOOL USAGE RULES — follow these exactly, always:

1. For ANYTHING related to nginx — including status, errors, down, config,
   website, web server, or "is it running":
   Step 1: Call diagnose_nginx FIRST. ALWAYS. Even for status checks.
   diagnose_nginx runs BOTH systemctl status AND nginx -t.
   nginx -t catches broken configs that systemctl status misses.
   Do NOT use execute_ssh_command for nginx. Use diagnose_nginx.
   Step 2: Read the output. If nginx -t shows an error with a file_path,
   IMMEDIATELY call fix_nginx_config with that file_path.
   Do NOT ask for confirmation between these steps. Do them in sequence.
   The approval gate will pause automatically if needed.

2. For ANY other service issue (mariadb, mysql, php, apache):
   Call execute_ssh_command with the appropriate status command.
   Example: 'systemctl status mariadb' or 'systemctl status mysql'
   Report the REAL output. Do not guess the status.

3. For ANY non-nginx status check: call execute_ssh_command first.
   Never answer a status question without tool evidence.
   EXCEPTION: nginx — always use diagnose_nginx instead (see rule 1).

4. NEVER print function names, JSON, or tool syntax in replies.
   Call tools via the API only. They are invisible to the user.

5. NEVER ask the user for confirmation before calling a tool.
   The system has an automatic Proceed/Reject approval gate.
   You must call tools directly — never ask "shall I proceed?"

6. NEVER hallucinate parameters. Use the Default Target Server IP.
   Ask the user only if the IP is genuinely missing.

7. After tools run, quote key lines from real output.
   Never summarise a fix without showing the actual nginx -t result
   or systemctl status line as evidence.

8. For BROAD or GENERIC queries like "everything is down", "nothing is working",
   "server is broken", "check everything", or "website is completely down":
   You MUST check ALL major services, not just nginx. Run these in order:
   Step 1: diagnose_nginx (catches config + service status)
   Step 2: execute_ssh_command with 'systemctl status mariadb || systemctl status mysql'
   Step 3: execute_ssh_command with 'systemctl status php*-fpm'
   Report ALL findings before summarising. Do NOT stop after fixing one service —
   there may be multiple problems. After fixing one issue, continue checking
   the remaining services.

9. During ANY disk or audit check — always run BOTH:
   - df -h          (overall disk usage per partition)
   - find /tmp -size +50M -ls 2>/dev/null   (large individual files)
   - du -sh /tmp/* 2>/dev/null | sort -rh | head -10
   Never report "disk is healthy" based on df -h alone.
   A partition can show 14% used while /tmp contains a 10GB file.
   Always check /tmp, /var/log, and /home for large files separately.

Available Tools:
- get_current_time: Smoke test. Verify the pipeline works.
- diagnose_nginx: The ONLY tool for nginx. Runs systemctl status + nginx -t +
  config context. Call this for ANY nginx query — status, errors, everything.
  NEVER use execute_ssh_command for nginx — use this instead.
- fix_nginx_config: Apply auto-fix for a specific Nginx config file.
  Requires file_path from diagnose_nginx output. Will trigger approval.
- discovery_agent: Map a WordPress hosting stack on a server. Requires
  host, domain, client_id.
- execute_ssh_command: Run a read-only diagnostic command on the server.
  Use for non-nginx status checks, log reads, version checks.
  Do NOT use this for nginx — use diagnose_nginx instead.

Always be safe, precise, transparent, and user-friendly.`;

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
    const messages: OpenAI.ChatCompletionMessageParam[] = (session?.messages ?? []) as any;

    // 2. Append user message if present
    if (message.text) {
        messages.push({ role: 'user', content: message.text });
    }

    let iteration = 0;
    let internalSyntaxRetryUsed = false;

    // FIX BUG 2: Track which specific tools have run, not just a boolean.
    // This lets hallucination detection stay active per-tool even mid-chain.
    const executedTools = new Set<string>();
    // Seed from HITL resume: tools executed in resume.ts before re-entering the loop.
    if (message.resumedTools) {
        for (const t of message.resumedTools) {
            executedTools.add(t);
            console.log(`[loop] Seeded executedTools from resume: ${t}`);
        }
    }

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

    // Pre-compute whether this request needs tools (used for tool_choice logic).
    const requiresTool = /\b(nginx|mariadb|mysql|postgres|redis|php|apache|fix|diagnose|status|running|install|restart|ssh|server|error|failed|resolve|issue|proceed|yes|confirm|do\s+it|apply|check|db|database|memory|disk|cpu|down|up|broken|crash|500|502|503|504|start|stop|service|process|log|config)\b/i
        .test([
            message.text ?? '',
            ...messages.slice(-6).map((m) => typeof m.content === 'string' ? m.content : '')
        ].join(' '));

    // Detect if this is an nginx/website query — forces diagnose_nginx on first call.
    const requiresNginx = /\b(nginx|website|web\s*server|site\s+(is\s+)?(down|broken|error|not\s+working|offline|unreachable))\b/i
        .test(message.text ?? '');

    // ─── Session trimming ──────────────────────────────────────────────────────
    // If the user is sending a new message (not a resume) and the session has many
    // old messages, trim to prevent context pollution from previous conversations.
    // Keep: system prompt (injected separately) + last 6 messages + the new user msg.
    if (message.text && !message.resumedTools && messages.length > 20) {
        const trimmed = messages.slice(-6);
        messages.length = 0;
        messages.push(...trimmed);
        console.log(`[loop] Trimmed session from ${trimmed.length + messages.length} to ${messages.length} messages`);
    }

    const toolDefinitions = getLLMToolDefinitions();

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
        const isFirstToolCall = requiresTool && executedTools.size === 0;
        const shouldRequireTool = toolDefinitions.length > 0 && (isMidChain || isFirstToolCall);

        let toolChoice: OpenAI.ChatCompletionToolChoiceOption;
        if (requiresNginx && executedTools.size === 0 && !executedTools.has('diagnose_nginx')) {
            // Force diagnose_nginx on first call for nginx/website queries
            toolChoice = { type: 'function', function: { name: 'diagnose_nginx' } };
            console.log('[loop] Forcing tool_choice: diagnose_nginx (nginx/website query detected)');
        } else {
            toolChoice = shouldRequireTool ? 'required' : 'auto';
        }
        // ──────────────────────────────────────────────────────────────────────

        // 3. Call LLM
        let response: OpenAI.ChatCompletion;
        const reqStart = Date.now();
        const { client: openai, model: activeModel } = getLLMClient();

        try {
            response = await openai.chat.completions.create({
                model: activeModel,
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
                tools: toolDefinitions,
                tool_choice: toolChoice,
                temperature: 0.2,
            });
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

        const reqLatency = Date.now() - reqStart;
        const choice = response.choices[0];

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

        // Handle usage tracking
        const usage = response.usage;
        if (usage) {
            const calledTools = choice.message?.tool_calls?.map(t => t.function.name).join(',') || undefined;
            void trackUsage({
                sessionId: message.sessionId,
                model: activeModel,
                tokensIn: usage.prompt_tokens,
                tokensOut: usage.completion_tokens,
                latencyMs: reqLatency,
                toolName: calledTools
            });
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
                        'Do not output internal tool syntax (like functions.execute_ssh_command). ' +
                        'Call tools via the tool API and then provide a normal user-facing response.',
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
                // If this pattern requires a specific tool to have run, check it
                if (req) {
                    // Also accept sibling tools (e.g., diagnose_nginx counts for status claims)
                    const relatedTools: Record<string, string[]> = {
                        'execute_ssh_command': ['execute_ssh_command', 'diagnose_nginx'],
                        'fix_nginx_config': ['fix_nginx_config'],
                    };
                    const acceptable = relatedTools[req] ?? [req];
                    return !acceptable.some(t => executedTools.has(t));
                }
                // Planning language: always a hallucination (no tool required to validate)
                return true;
            });
            // ──────────────────────────────────────────────────────────────────

            if (isHallucination) {
                console.error('[loop] HALLUCINATION DETECTED — LLM claimed success without sufficient tool execution');
                console.error('[loop] Executed tools so far:', [...executedTools]);
                await indicator?.update('⚠️ Need real diagnostics — re-running with tools...');
                await onReply('⚠️ I need to verify this with real diagnostics. Running tools now — you may see a short pause.');
                messages.push({ role: 'assistant', content: text });
                messages.push({
                    role: 'user',
                    content: 'STOP. You just reported a result without running the required tool. '
                        + 'I can see in the server that nothing changed. '
                        + 'Do NOT fabricate results. '
                        + 'Run the required tool RIGHT NOW via the tool API. '
                        + 'Do not reply with text until you have real tool output.',
                });
                continue;
            }

            const safeText = containsInternalToolSyntax(text)
                ? 'I am still processing this request. Please retry if you do not receive results in a moment.'
                : text;

            // If the model still avoided tool use on the very first call while tools
            // are required, it means tool_choice:'required' failed (provider issue).
            // Surface a clear error rather than silently giving a hallucinated answer.
            if (requiresTool && executedTools.size === 0) {
                console.error('[loop] LLM avoided tool call despite tool_choice:required — possible provider issue');
                await indicator?.stop();
                await onReply(
                    '⚠️ I was unable to connect to the server. ' +
                    'Please check that SSH_HOST is configured and the server is reachable.'
                );
                break;
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

            // AUDIT GUARD — code-level, cannot be overridden by LLM
            if (isAuditRequest(message.text ?? '') && WRITE_TOOLS.has(toolName)) {
                console.warn(`[loop] AUDIT GUARD blocked write tool "${toolName}" during audit`);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `BLOCKED BY AUDIT GUARD: "${toolName}" is a write operation. You are in read-only audit mode. List this as a recommendation only. Do not attempt to fix anything.`,
                });
                continue;
            }

            const toolApproval = getToolApprovalRequest(toolName, toolArgs);
            if (toolApproval) {
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
                    + `I need to edit \`${toolApproval.targetHost}\` to fix Nginx.\n`
                    + 'Please click *Proceed* or *Reject* on the card above.\n'
                    + '_If no card appeared, the approval system has an error — check the server logs._'
                );

                await indicator?.update('⏳ Awaiting your decision (Proceed/Reject)...');
                await indicator?.stop(true);

                await upsertSession({
                    id: message.sessionId,
                    channel: message.channel,
                    user_id: message.userId,
                    messages: messages as unknown as Array<Record<string, unknown>>,
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
                if (isAuditRequest(message.text ?? '') && rawCommand && isWriteCommand(rawCommand)) {
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
                    const targetHost = (toolArgs.host as string) ?? 'unknown';
                    // Encode as TOOL: format so resume.ts can decode it later
                    const encodedCommand = encodeToolApprovalCommand(toolName, {
                        command: rawCommand,
                        host: targetHost,
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

                    await upsertSession({
                        id: message.sessionId,
                        channel: message.channel,
                        user_id: message.userId,
                        messages: messages as unknown as Array<Record<string, unknown>>,
                        iteration,
                    });
                    return;
                }
            }

            // Execute tool
            const tool = getToolByName(toolName);
            if (!tool) {
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `Error: Tool "${toolName}" not found in registry.`,
                });
                continue;
            }

            // FIX BUG 4: Wrap tool execution in try/catch so a thrown error
            // doesn't leak out of the loop without persisting the session.
            let result: { success: boolean; output: string };
            try {
                console.log(`[loop] ⚡ EXECUTING TOOL: ${toolName} on host: ${String(toolArgs.host ?? 'N/A')}`);
                result = await tool.execute(toolArgs);
                // FIX BUG 2: Register this tool as actually having run.
                executedTools.add(toolName);
                console.log(`[loop] ✅ TOOL COMPLETE: ${toolName} — success=${result.success}, output length: ${result.output.length} chars`);
            } catch (toolErr: unknown) {
                const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
                console.error(`[loop] ❌ TOOL THREW: ${toolName} — ${errMsg}`);
                result = { success: false, output: `Tool "${toolName}" threw an unexpected error: ${errMsg}` };
            }

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result.output,
            });

            // Auto-chain: if diagnose_nginx found a config file error,
            // extract the file path and queue fix_nginx_config automatically
            // so the LLM does not need to ask for confirmation
            if (toolName === 'diagnose_nginx' && result.success) {
                const fileMatch = result.output.match(
                    /in\s+(\/etc\/nginx\/[^\s:]+)[:|\s]/i
                );
                const foundFilePath = fileMatch?.[1];
                if (foundFilePath) {
                    console.log(`[loop] Auto-chain: diagnose found error in ${foundFilePath} — will call fix_nginx_config next`);
                    messages.push({
                        role: 'user',
                        content:
                            `diagnose_nginx found a config error in ${foundFilePath}. ` +
                            `Call fix_nginx_config now with host="${String(toolArgs.host)}" ` +
                            `and file_path="${foundFilePath}". Do not ask for confirmation.`,
                    });
                }
            }
        }

        // Loop continues for another LLM call with tool results
    }

    // Guard: hit max iterations
    if (iteration >= MAX_ITERATIONS) {
        console.warn('[loop] Max iterations reached');
        await indicator?.stop();
        await onReply('⚠️ Reached maximum reasoning iterations. Please try a more specific query.');
    }

    // 5. Persist session
    await upsertSession({
        id: message.sessionId,
        channel: message.channel,
        user_id: message.userId,
        messages: messages as unknown as Array<Record<string, unknown>>,
        iteration,
    });

    // TODO Level 3: Approval Resume Path
    // When a Tier-3 action is approved by the AIOps Pilot, this loop must be
    // re-entered with the saved session messages and the approved command's
    // result injected as a tool message. The resume handler should:
    //   1. Load session by approvalId from the hitl_approvals table
    //   2. Execute the approved command via the appropriate tool
    //   3. Push tool result into session.messages
    //   4. Call runAgentLoop again with the resumed session
    // This is the critical missing piece for HITL to be fully operational.
}