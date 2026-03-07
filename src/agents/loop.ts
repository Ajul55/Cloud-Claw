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
 */

import OpenAI from 'openai';
import { env } from '../config/env.js';
import { getLLMClient } from '../llm/provider.js';
import { getSession, upsertSession, createApproval, getLatestPendingApproval } from '../database/db.js';
import { getLLMToolDefinitions, getToolByName } from '../tools/tool_registry.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';
import { checkCommand, requiresApproval } from '../security/command_filter.js';
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
- If you are uncertain whether a tool ran, say: "I don't have confirmation from the server — let me check now." Then call the tool.

You are Cloud-Claw, an expert AIOps assistant for Linux server administration.

Your job is to help diagnose infrastructure issues, gather system state via tools, and propose safe remediation steps.

Known Infrastructure:
- Default Target Server IP: ${env.SSH_HOST ?? 'Not configured — ask the user'}
- Default SSH User: ${env.SSH_USER}

TOOL USAGE RULES — follow these exactly, always:

1. For ANY nginx issue (error, failed, down, config problem):
   Step 1: Call diagnose_nginx FIRST. Get the real output.
   Step 2: Read the output. Find the file_path in the error line.
   Step 3: IMMEDIATELY call fix_nginx_config with that file_path.
   Do NOT ask for confirmation between these steps. Do them in sequence.
   The approval gate will pause automatically if needed.

2. For ANY other service issue (mariadb, mysql, php, apache):
   Call execute_ssh_command with the appropriate status command.
   Example: 'systemctl status mariadb' or 'systemctl status mysql'
   Report the REAL output. Do not guess the status.

3. For ANY status check: call execute_ssh_command first.
   Never answer a status question without tool evidence.

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

Available Tools:
- get_current_time: Smoke test. Verify the pipeline works.
- diagnose_nginx: Focused Nginx diagnostics — service status, nginx -t,
  config error line. Use for ANY Nginx issue first.
- fix_nginx_config: Apply auto-fix for a specific Nginx config file.
  Requires file_path from diagnose_nginx output. Will trigger approval.
- discovery_agent: Map a WordPress hosting stack on a server. Requires
  host, domain, client_id.
- execute_ssh_command: Run a read-only diagnostic command on the server.
  Use for status checks, log reads, version checks.

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
    let hasExecutedTool = false;
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

    while (iteration < MAX_ITERATIONS) {
        iteration++;
        console.log(`[loop] Iteration ${iteration}/${MAX_ITERATIONS} — session: ${message.sessionId}`);

        // 3. Call LLM
        let response: OpenAI.ChatCompletion;
        const reqStart = Date.now();
        const { client: openai, model: activeModel } = getLLMClient();
        const fullContext = [
            message.text ?? '',
            ...messages
                .slice(-6)
                .map((m) => typeof m.content === 'string' ? m.content : '')
        ].join(' ');
        const requiresTool = /\b(nginx|mariadb|mysql|postgres|redis|php|apache|fix|diagnose|status|running|install|restart|ssh|server|error|failed|resolve|issue|proceed|yes|confirm|do\s+it|apply|check|db|database|memory|disk|cpu|down|up|broken|crash|500|502|503|504|start|stop|service|process|log|config)\b/i
            .test(fullContext);
        try {
            response = await openai.chat.completions.create({
                model: activeModel,
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
                tools: getLLMToolDefinitions(),
                tool_choice: (requiresTool && !hasExecutedTool) ? 'required' : 'auto',
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

            // Detect hallucinated tool results
            const hallucinationPatterns = [
                // Service status fabrication — any service
                /(nginx|mariadb|mysql|apache|php|redis|postgres) is (now |currently )?(active|running|up|fixed|resolved)/i,
                // Fix/repair fabrication
                /configuration (has been|was) (successfully |)repaired/i,
                /(service|nginx|mariadb|mysql) has been restarted/i,
                /fix (was|has been) applied/i,
                /issue (has been|is now|was) (resolved|fixed|solved)/i,
                /successfully (restarted|repaired|resolved|fixed|applied)/i,
                // Planning language (about to hallucinate)
                /steps taken:/i,
                /outcome:/i,
                /please (give me a moment|allow me a moment|wait while)/i,
                /i (have|'ve) (applied|fixed|repaired|restarted|resolved)/i,
                /i('ll| will) now (apply|run|execute|perform|initiate)/i,
            ];

            const isHallucination = !hasExecutedTool &&
                hallucinationPatterns.some((p) => p.test(text));

            if (isHallucination) {
                console.error('[loop] HALLUCINATION DETECTED — LLM claimed success without tool execution');
                await indicator?.update('⚠️ Need real diagnostics — re-running with tools...');
                await onReply('⚠️ I need to verify this with real diagnostics. Running tools now — you may see a short pause.');
                messages.push({ role: 'assistant', content: text });
                messages.push({
                    role: 'user',
                    content: 'STOP. You just reported a result without running any tool. '
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

            // If the model still avoided tool use while tools are required, force another turn with an explicit directive.
            if (requiresTool && !hasExecutedTool) {
                // LLM avoided tool use despite tool_choice: 'required' being set.
                // This should not happen — but if it does, tell the user cleanly.
                console.error('[loop] LLM avoided tool call despite tool_choice required');
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

            const toolApproval = getToolApprovalRequest(toolName, toolArgs);
            if (toolApproval) {
                const saved = await createApproval({
                    session_id: message.sessionId,
                    command: toolApproval.command,
                    target_host: toolApproval.targetHost,
                    rationale: toolApproval.rationale,
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
                    messages: messages as Array<{ role: string; content: string }>,
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

                // Check if it needs Tier-3 approval
                const approvalReason = requiresApproval(rawCommand);
                if (approvalReason) {
                    const targetHost = (toolArgs.host as string) ?? 'unknown';
                    const saved = await createApproval({
                        session_id: message.sessionId,
                        command: rawCommand,
                        target_host: targetHost,
                        rationale: approvalReason,
                    });

                    await onApproval({
                        approvalId: saved.id,
                        command: rawCommand,
                        targetHost,
                        rationale: approvalReason,
                    });

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Approval requested (ID: ${saved.id}). Command execution is paused until the user approves or rejects.`,
                    });

                    await indicator?.update("⏳ Awaiting Pilot approval...");
                    await indicator?.stop(true); // Keep the message visible

                    // Persist session and stop loop — will resume when approval is handled
                    await upsertSession({
                        id: message.sessionId,
                        channel: message.channel,
                        user_id: message.userId,
                        messages: messages as Array<{ role: string; content: string }>,
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

            console.log(`[loop] ⚡ EXECUTING TOOL: ${toolName} on host: ${String(toolArgs.host ?? 'N/A')}`);
            const result = await tool.execute(toolArgs);
            hasExecutedTool = true;
            console.log(`[loop] Tool result (${toolName}): success=${result.success}`);

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
            console.log(`[loop] ✅ TOOL COMPLETE: ${toolName} — output length: ${result.output.length} chars`);
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
        messages: messages as Array<{ role: string; content: string }>,
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
