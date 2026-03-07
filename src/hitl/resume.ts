import { resolveApproval, getSession, upsertSession } from '../database/db.js';
import { executeSshCommandTool } from '../tools/execute_ssh_command.js';
import { getToolByName } from '../tools/tool_registry.js';
import { saveFix } from '../memory/fix_memory.js';
import { runAgentLoop } from '../agents/loop.js';
import { decodeToolApprovalCommand } from './tool_approval.js';
import type { ReplyFn, ApprovalFn, ToolResult } from '../tools/types.js';

export async function resumeApprovedSession(
    approvalId: number,
    approved: boolean,
    pilotUserId: string,
    onReply: ReplyFn,
    onApproval: ApprovalFn
): Promise<void> {
    const record = await resolveApproval(approvalId, approved ? 'approved' : 'rejected');
    if (!record) {
        await onReply(`⚠️ *Error:* Approval request #${approvalId} not found or expired.`);
        return;
    }

    // TODO Level 2: Verify pilotUserId matches the session's assigned pilot

    const session = await getSession(record.session_id);
    if (!session) {
        await onReply(`⚠️ *Error:* Session ${record.session_id} not found.`);
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = session.messages as any[];

    if (!approved) {
        const msgText = 'Command rejected by AIOps Pilot. No changes made.';
        const toolCallId = `approval-${approvalId}-reject`;
        messages.push({
            role: 'assistant',
            tool_calls: [
                {
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: 'approval_reject',
                        arguments: JSON.stringify({ reason: 'pilot_rejected' })
                    }
                }
            ]
        });
        messages.push({ role: 'tool', tool_call_id: toolCallId, content: msgText });
        await upsertSession(session);
        await onReply('❌ *Rejected* — action cancelled.');
    } else {
        await onReply(`✅ *Proceeding* — executing on \`${record.target_host}\`... please wait.`);

        const decodedTool = decodeToolApprovalCommand(record.command);
        let result: ToolResult;
        let toolName = 'execute_ssh_command';
        let toolArgs: Record<string, unknown> = { host: record.target_host, command: record.command };

        if (decodedTool) {
            toolName = decodedTool.toolName;
            toolArgs = decodedTool.args;
            const tool = getToolByName(decodedTool.toolName);
            if (!tool) {
                result = {
                    success: false,
                    output: `Tool "${decodedTool.toolName}" not found.`,
                };
            } else {
                result = await tool.execute(decodedTool.args);
            }
        } else {
            result = await executeSshCommandTool.execute(toolArgs);
        }

        const toolCallId = `approval-${approvalId}-run`;
        messages.push({
            role: 'assistant',
            tool_calls: [
                {
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: toolName,
                        arguments: JSON.stringify(toolArgs)
                    }
                }
            ]
        });
        messages.push({ role: 'tool', tool_call_id: toolCallId, content: result.output });

        await upsertSession(session);

        // Record the resolved issue logic to pgvector database
        if (record.rationale) {
            void saveFix(record.rationale, record.command);
        }

        try {
            await runAgentLoop(
                { sessionId: session.id, channel: session.channel as any, userId: session.user_id, text: '' },
                onReply,
                onApproval
            );
        } catch (err) {
            console.error(`[resume] Loop error:`, err);
            await onReply(`❌ Error resuming session: ${err}`);
        }
    }
}
