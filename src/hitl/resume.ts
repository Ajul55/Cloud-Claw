import {
    getApprovalById,
    updateApprovalStatus,
    getSession,
    upsertSession
} from '../database/db.js';
import { getToolByName } from '../tools/tool_registry.js';
import { decodeToolApprovalCommand } from './tool_approval.js';
import { runAgentLoop } from '../agents/loop.js';
import { saveFix } from '../memory/fix_memory.js';
import type { ReplyFn, ApprovalFn } from '../tools/types.js';

export async function resumeApprovedSession(
    approvalId: number,
    approved: boolean,
    pilotUserId: string,
    onReply: ReplyFn,
    onApproval: ApprovalFn,
): Promise<void> {
    console.log(`[resume] Handling approval ${approvalId} — approved=${approved}`);

    // 1. Load approval record
    const approval = await getApprovalById(approvalId);
    if (!approval) {
        await onReply('⚠️ Approval record not found — it may have expired.');
        return;
    }
    if (approval.status !== 'pending') {
        await onReply(`⚠️ This approval is already ${approval.status}.`);
        return;
    }

    // 2. Update status immediately
    await updateApprovalStatus(approvalId, approved ? 'approved' : 'rejected', pilotUserId);

    if (!approved) {
        await onReply('❌ Action rejected. No changes were made to the server.');
        return;
    }

    // 3. Load the paused session
    const session = await getSession(approval.session_id);
    if (!session) {
        await onReply('⚠️ Session expired — please repeat your request.');
        return;
    }

    // 4. Decode what tool needs to run
    let toolName: string;
    let toolArgs: Record<string, unknown>;
    try {
        const decoded = decodeToolApprovalCommand(approval.command);
        if (decoded) {
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

    // 6. Execute the tool NOW
    await onReply(`⚙️ Proceeding — executing ${toolName} on \`${String(toolArgs.host ?? 'server')}\`...`);

    let result;
    try {
        result = await tool.execute(toolArgs);
        console.log(`[resume] ✅ Tool complete: ${toolName} — success=${result.success}`);

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

    if (!approval.tool_call_id) {
        throw new Error('Approval record is missing tool_call_id — cannot safely submit tool result to LLM');
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
    const messages = (session.messages ?? []) as any[];

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
        messages: messages as unknown as Array<Record<string, unknown>>,
        iteration: (session.iteration ?? 0),
    });

    // 9. Re-enter agent loop to generate the final reply.
    //    Pass resumedTools so the hallucination detector knows this tool ran.
    //    Extract the original user query and build a continuation prompt so the
    //    LLM continues checking other services for broad requests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalUserMsg = messages.find((m: any) => m.role === 'user' && m.content && typeof m.content === 'string' && m.content.length > 5) as any;
    const originalQuery = originalUserMsg?.content ?? '';

    // Build continuation text: remind the LLM about the original request
    const isBroadQuery = /\b(everything|nothing|completely|all\s+down|not\s+working|broken|check\s+everything)\b/i.test(originalQuery);
    let continuationText = '';
    if (isBroadQuery) {
        continuationText = `The ${toolName} fix has been applied. But my original request was broad: "${originalQuery.slice(0, 100)}". ` +
            `Check other major services too (MariaDB/MySQL, PHP-FPM) before giving the final summary. ` +
            `Use execute_ssh_command for non-nginx service checks.`;
    }

    await runAgentLoop(
        {
            sessionId: approval.session_id,
            userId: pilotUserId,
            channel: session.channel as 'telegram' | 'slack',
            text: continuationText,
            resumedTools: [toolName],
        },
        onReply,
        onApproval,
    );
}