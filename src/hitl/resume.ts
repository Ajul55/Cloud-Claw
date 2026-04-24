import { createHash } from 'crypto';
import {
    getApprovalById,
    updateApprovalStatus,
    getSession,
    upsertSession
} from '../database/db.js';
import { getToolByName, getAllTools } from '../tools/tool_registry.js';
import { decodeToolApprovalCommand } from './tool_approval.js';
import { runAgentLoop } from '../agents/loop.js';
import { touchSession } from '../jobs/timeout_sessions.js';
import { saveFix } from '../memory/fix_memory.js';
import { checkCommand } from '../security/command_filter.js';
import type { ReplyFn, ApprovalFn } from '../tools/types.js';

// SSH tools whose `command` arg must be re-checked against the command blocklist on resume
const SSH_COMMAND_TOOLS = new Set([
    'execute_ssh_command', 'execute_ssh_write',
]);

// Lazily-built set of write tools (approvalTier === 3)
let _WRITE_TOOLS: Set<string> | null = null;
function getWriteToolsLocal(): Set<string> {
    if (!_WRITE_TOOLS) {
        _WRITE_TOOLS = new Set(getAllTools().filter(t => t.approvalTier === 3).map(t => t.name));
    }
    return _WRITE_TOOLS;
}

export function extractApprovedToolCall(
    messages: Array<Record<string, unknown>>,
    toolCallId: string,
): { toolName: string; args: Record<string, unknown> } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i] as any;
        if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
            continue;
        }

        const match = message.tool_calls.find((toolCall: any) => toolCall?.id === toolCallId);
        if (!match?.function?.name) {
            continue;
        }

        let args: Record<string, unknown> = {};
        if (typeof match.function.arguments === 'string' && match.function.arguments.trim()) {
            try {
                const parsed = JSON.parse(match.function.arguments);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    args = parsed as Record<string, unknown>;
                }
            } catch (err) {
                console.warn(`[resume] Failed to parse stored tool args for ${toolCallId}:`, err);
            }
        }

        return {
            toolName: String(match.function.name),
            args,
        };
    }

    return null;
}

export async function resumeApprovedSession(
    approvalId: number,
    approved: boolean,
    pilotUserId: string,
    onReply: ReplyFn,
    onApproval: ApprovalFn,
    rejectionReason?: string,
): Promise<void> {
    console.log(`[resume] Handling approval ${approvalId} — approved=${approved}`);

    // 1. Load approval record
    const approval = await getApprovalById(approvalId);
    if (!approval) {
        await onReply('⚠️ Approval record not found — it may have expired.');
        return;
    }
    if (approval.status === 'expired') {
        await onReply('⏰ This approval expired (>10 min). Please re-run the command.');
        return;
    }
    if (approval.status !== 'pending') {
        await onReply(`⚠️ This approval is already ${approval.status}.`);
        return;
    }

    // 2. Load the paused session
    const session = await getSession(approval.session_id);
    if (!session) {
        await onReply('⚠️ Session expired — please repeat your request.');
        return;
    }
    touchSession(approval.session_id);

    // HIGH-4 / MED-7: Track session version for OCC writes
    let sessionVersion = session.version ?? 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (session.messages ?? []) as any[];
    const receipts: Record<string, any> = typeof session.receipts === 'object' && session.receipts
        ? { ...(session.receipts as Record<string, any>) }
        : {};

    if (!approval.tool_call_id) {
        throw new Error('Approval record is missing tool_call_id — cannot safely update the pending tool result');
    }

    if (!approved) {
        const rejectionContent = rejectionReason
            ? `Pilot rejected this command. Reason given: "${rejectionReason}". Re-evaluate your approach and suggest an alternative that addresses the Pilot's concern. Do NOT retry the same command.`
            : 'Pilot rejected this command with no reason given. Re-evaluate your approach and ask the Pilot what they would prefer instead.';

        // Store rejection in fix_memory to prevent future identical suggestions
        void saveFix(
            `Pilot rejected proposed action: ${approval.command.slice(0, 300)}`,
            rejectionReason ? `Rejected because: ${rejectionReason}` : 'Rejected with no reason given. Do NOT retry.',
            'rejected_action'
        ).catch(err => console.warn('[resume] saveFix (rejection) failed:', err));

        const placeholderIndex = messages.findIndex(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (m: any) => m.role === 'tool' && m.tool_call_id === approval.tool_call_id
        );

        const didUpdate = await updateApprovalStatus(approvalId, 'rejected', pilotUserId);
        if (!didUpdate) {
            console.warn(`[resume] Approval ${approvalId} was already handled before rejection could be applied.`);
            await onReply('⚠️ This approval is already being handled or has already been processed.');
            return;
        }

        if (placeholderIndex !== -1) {
            messages[placeholderIndex] = {
                role: 'tool',
                tool_call_id: approval.tool_call_id,
                content: rejectionContent,
            };
        } else {
            messages.push({
                role: 'tool',
                tool_call_id: approval.tool_call_id,
                content: rejectionContent,
            });
        }

        await upsertSession({
            id: approval.session_id,
            channel: session.channel,
            user_id: session.user_id,
            reply_target: session.reply_target ?? null,
            messages: messages as unknown as Array<Record<string, unknown>>,
            receipts,
            iteration: session.iteration ?? 0,
            expectedVersion: sessionVersion,
        });
        sessionVersion++;

        await runAgentLoop(
            {
                sessionId: approval.session_id,
                userId: pilotUserId,
                channel: session.channel as 'telegram' | 'slack',
                text: '',
                replyTarget: session.reply_target ?? undefined,
            },
            onReply,
            onApproval,
        );
        return;
    }

    // 4. Decode what tool needs to run
    let toolName: string;
    let toolArgs: Record<string, unknown>;
    try {
        const storedToolCall = extractApprovedToolCall(
            messages as unknown as Array<Record<string, unknown>>,
            approval.tool_call_id,
        );
        const decoded = decodeToolApprovalCommand(approval.command);

        if (storedToolCall && decoded && storedToolCall.toolName !== decoded.toolName) {
            console.warn(
                `[resume] Stored tool name (${storedToolCall.toolName}) does not match encoded approval tool (${decoded.toolName}). Using stored tool call.`,
            );
        }

        if (storedToolCall && decoded) {
            toolName = storedToolCall.toolName;
            toolArgs = { ...decoded.args, ...storedToolCall.args };
        } else if (storedToolCall) {
            toolName = storedToolCall.toolName;
            toolArgs = storedToolCall.args;
        } else if (decoded) {
            toolName = decoded.toolName;
            toolArgs = decoded.args;
        } else {
            // Fallback: old approval records may store raw bash commands
            // without the TOOL: prefix. Treat as execute_ssh_command.
            console.warn(`[resume] Command not TOOL:-encoded, falling back to execute_ssh_command: ${approval.command.slice(0, 80)}`);
            toolName = 'execute_ssh_command';
            toolArgs = { command: approval.command, host: approval.target_host };
        }
    } catch (err) {
        await onReply(`⚠️ Could not decode approval command: ${String(err)}`);
        return;
    }

    console.log(`[resume] Executing approved tool: ${toolName}`, toolArgs);

    // 5. Get the tool
    const tool = getToolByName(toolName);
    if (!tool) {
        await onReply(`⚠️ Tool "${toolName}" not found in registry.`);
        return;
    }

    // ─── Fix 3: Pre-flight state re-validation ──────────────────────────
    // Step 1: Token refresh (Removed: API Keys do not require refreshing)

    // Step 2 & 3: State hash comparison (if tool supports getCurrentState)
    const savedHash = toolArgs.__stateHash as string | undefined;
    // Remove the internal hash from args before passing to the tool
    delete toolArgs.__stateHash;

    if (savedHash && tool.getCurrentState) {
        try {
            const currentState = await tool.getCurrentState(toolArgs);
            const currentHash = createHash('sha256').update(currentState).digest('hex').slice(0, 16);
            console.log(`[resume] State hash comparison: saved=${savedHash} current=${currentHash}`);

            if (currentHash !== savedHash) {
                console.warn(`[resume] ⚠️ State drift detected for ${toolName}! saved=${savedHash} current=${currentHash}`);
                await updateApprovalStatus(approvalId, 'expired', pilotUserId);
                await onReply(
                    '⚠️ **Execution Aborted — State Drift Detected**\n\n'
                    + 'The server state has changed since this approval was requested. '
                    + 'This can happen if someone made manual changes, background scripts ran, '
                    + 'or another process modified the resource.\n\n'
                    + 'Execution aborted to prevent conflicts. Please request the action again.'
                );
                return;
            }
            console.log(`[resume] State hash matches — safe to proceed.`);
        } catch (err) {
            console.warn('[resume] getCurrentState re-check failed, proceeding cautiously:', err);
        }
    }

    // HIGH-3: Re-validate the tool is still safe to execute before marking approved.
    // (a) Re-fetch approval to guard against race conditions / revocation between
    //     state-hash check and actual execution.
    const freshApproval = await getApprovalById(approvalId);
    if (!freshApproval || freshApproval.status !== 'pending') {
        const currentStatus = freshApproval?.status ?? 'not found';
        console.warn(`[resume] Approval ${approvalId} is no longer pending at execution time (status: ${currentStatus}).`);
        await onReply(`⚠️ This approval is no longer actionable (status: ${currentStatus}). Please re-run the command if needed.`);
        return;
    }

    // (b) Confirm the tool is a recognised write tool — reject unknown tools that
    //     somehow passed earlier validation.
    if (!getWriteToolsLocal().has(toolName)) {
        console.warn(`[resume] Tool "${toolName}" is not in the WRITE_TOOLS set — refusing to execute via HITL resume.`);
        await onReply(`⚠️ Tool "${toolName}" is not a recognised write tool and cannot be executed via the approval flow.`);
        return;
    }

    // (c) For SSH command tools, re-run the command blocklist check so a malicious
    //     command string cannot slip through if the blocklist was updated after
    //     approval was requested.
    if (SSH_COMMAND_TOOLS.has(toolName)) {
        const cmdArg = (toolArgs as any).command;
        if (typeof cmdArg === 'string') {
            const isWriteTool = toolName === 'execute_ssh_write';
            const cmdCheck = checkCommand(cmdArg, isWriteTool);
            if (!cmdCheck.safe) {
                console.warn(`[resume] Command blocklist blocked "${toolName}" at execution time: ${cmdCheck.reason}`);
                await updateApprovalStatus(approvalId, 'rejected', pilotUserId);
                await onReply(`🚫 Execution blocked by security filter: ${cmdCheck.reason}\n\nThis command was blocked at execution time. Please re-evaluate and request a new action.`);
                return;
            }
        }
    }

    const didUpdate = await updateApprovalStatus(approvalId, 'approved', pilotUserId);
    if (!didUpdate) {
        console.warn(`[resume] Approval ${approvalId} was already handled before execution could start.`);
        await onReply('⚠️ This approval is already being handled or has already been processed.');
        return;
    }

    // 6. Execute the tool NOW
    await onReply(`⚙️ Running \`${toolName}\`…`);

    let result;
    try {
        result = await tool.execute(toolArgs);
        console.log(`[resume] ✅ Tool complete: ${toolName} — success=${result.success}`);
        receipts[toolName] = {
            toolName,
            success: Boolean(result.success),
            host: String((toolArgs as any).host ?? (toolArgs as any).server_label ?? 'unknown'),
            timestamp: Date.now(),
            outputHash: createHash('sha256').update((result.output ?? '').slice(0, 200)).digest('hex'),
        };

        // Save successful fix to memory (non-fatal)
        if (result.success) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const issueText = (session.messages as any[])
                .filter((m: any) => m.role === 'user')
                .map((m: any) => typeof m.content === 'string' ? m.content : '')
                .join(' ')
                .slice(0, 300);
            void saveFix(
                issueText,
                `${toolName}: ${JSON.stringify(toolArgs)}`,
                toolName,
            ).catch(err => console.warn('[resume] saveFix failed (non-fatal):', err));
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[resume] Tool execution failed: ${msg}`);
        await onReply(`❌ Tool execution failed: ${msg}`);
        return;
    }

    // ─── FIX: Replace placeholder, do NOT append ──────────────────────────────
    //
    // THE BUG (old code):
    //   When the loop paused for approval, it already saved a placeholder tool
    //   message into the session: { role: 'tool', tool_call_id: 'call_abc',
    //   content: "Approval requested (ID: 5)..." }
    //
    //   The old code then pushed a SECOND tool message with the same tool_call_id.
    //   The LLM received two tool results for the same call — invalid conversation
    //   structure — causing MiniMax to return 500 "unknown error (1000)".
    //

    // THE FIX:
    //   Find the placeholder in the saved messages and REPLACE it in-place with
    //   the real tool result. This keeps exactly one tool message per tool_call_id,
    //   maintaining a valid conversation chain.
    // ─────────────────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const placeholderIndex = messages.findIndex(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any) => m.role === 'tool' && m.tool_call_id === approval.tool_call_id
    );

    if (placeholderIndex !== -1) {
        // Replace the placeholder with the real result
        console.log(`[resume] Replacing placeholder at index ${placeholderIndex} for tool_call_id=${approval.tool_call_id}`);
        messages[placeholderIndex] = {
            role: 'tool',
            tool_call_id: approval.tool_call_id,
            content: result.output,
        };
    } else {
        // No placeholder found — this means the session was saved before the
        // placeholder was pushed (edge case). Safe to append here.
        console.warn(`[resume] No placeholder found for tool_call_id=${approval.tool_call_id} — appending result`);
        messages.push({
            role: 'tool',
            tool_call_id: approval.tool_call_id,
            content: result.output,
        });
    }

    // 8. Save updated session with real result in place of placeholder
    await upsertSession({
        id: approval.session_id,
        channel: session.channel,
        user_id: session.user_id,
        reply_target: session.reply_target ?? null,
        messages: messages as unknown as Array<Record<string, unknown>>,
        receipts,
        iteration: (session.iteration ?? 0),
        expectedVersion: sessionVersion,
    });
    sessionVersion++;

    // 9. Re-enter agent loop to generate the final reply.
    //    Pass resumedTools so the hallucination detector knows this tool ran.
    //    Extract the original user query and build a continuation prompt so the
    //    LLM continues checking other services for broad requests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalUserMsg = messages.find((m: any) => m.role === 'user' && m.content && typeof m.content === 'string' && m.content.length > 5) as any;
    const originalQuery = originalUserMsg?.content ?? '';

    // Build continuation text: remind the LLM about the original request
    const isBroadQuery = /\b(everything|nothing|completely|all\s+down|not\s+working|broken|check\s+everything)\b/i.test(originalQuery);

    const targetLabel = String((toolArgs as any).server_label ?? '').trim();
    const targetHost = String((toolArgs as any).host ?? '').trim();
    const serverContext = (targetLabel || targetHost)
        ? `Continue on server ${targetLabel || targetHost}${targetHost ? ` (${targetHost})` : ''}. Do NOT switch servers unless the Pilot explicitly asks.`
        : '';

    const broadContinuation = isBroadQuery
        ? `The ${toolName} action has been applied. Original request was broad: "${originalQuery.slice(0, 100)}". ` +
        `Check other major services (MariaDB/MySQL, PHP-FPM) before giving the final summary. ` +
        `Use execute_ssh_command for non-nginx checks.`
        : '';

    // continuationText is ONLY set for broad queries that need follow-up checks.
    // For specific tasks, the tool result is the final answer.
    // Always include at least a summary prompt so the LLM does NOT get tool_choice:required
    // from isMidChain=true — MiniMax returns empty choices when forced to call a tool
    // after a final result with nothing left to do.
    const continuationText = broadContinuation || '[SYSTEM] The approved action completed. Report the result to the Pilot now. Do not call any more tools unless the result indicates a follow-up is needed.';

    const resumedTools = new Set<string>();
    for (const msg of messages) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc = (msg as any).tool_calls;
        if (msg.role === 'assistant' && Array.isArray(tc)) {
            tc.forEach((call: any) => {
                if (call?.function?.name) resumedTools.add(call.function.name);
            });
        }
    }
    resumedTools.add(toolName);

    await runAgentLoop(
        {
            sessionId: approval.session_id,
            userId: pilotUserId,
            channel: session.channel as 'telegram' | 'slack',
            text: continuationText,
            replyTarget: session.reply_target ?? undefined,
            resumedTools: Array.from(resumedTools),
        },
        onReply,
        onApproval,
    );
}
