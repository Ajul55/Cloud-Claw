import type { ApprovalFn } from '../tools/types.js';
import { describeApprovalCommand } from './tool_approval.js';

export function buildApprovalMessage(context: Parameters<ApprovalFn>[0]) {
    const { approvalId, command, targetHost, rationale } = context;
    const details = describeApprovalCommand(command);
    const detailLines = details.details.map((d) => `${d.label}: \`${d.value}\``).join('\n');

    // Telegram uses markdown and inline buttons
    const telegramText = `🔐 *Human Confirmation Required*\n\nAction: *${details.title}*\n${detailLines ? `${detailLines}\n` : ''}Server: \`${targetHost}\`\nReason: ${rationale}`;
    const telegramKeyboard = [
        [
            { text: '✅ Proceed', callback_data: `approve:${approvalId}` },
            { text: '❌ Reject', callback_data: `reject:${approvalId}` }
        ]
    ];

    // Slack uses Block Kit
    const slackBlocks = [
        { type: 'header', text: { type: 'plain_text', text: '🔐 Human Confirmation Required', emoji: true } },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Server:*\n\`${targetHost}\`` },
                { type: 'mrkdwn', text: `*Reason:*\n${rationale}` }
            ]
        },
        { type: 'section', text: { type: 'mrkdwn', text: `*Action:*\n${details.title}` } },
        ...(detailLines ? [{ type: 'section', text: { type: 'mrkdwn', text: detailLines } }] : []),
        {
            type: 'actions',
            elements: [
                { type: 'button', text: { type: 'plain_text', text: '✅ Proceed' }, style: 'primary', action_id: 'approve_command', value: String(approvalId) },
                { type: 'button', text: { type: 'plain_text', text: '❌ Reject' }, style: 'danger', action_id: 'reject_command', value: String(approvalId) }
            ]
        }
    ];

    return { telegramText, telegramKeyboard, slackBlocks };
}
