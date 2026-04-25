import { getPool, isDBConfigured, type ApprovalRecord } from '../database/db.js';
import { env } from '../config/env.js';

export async function expireStaleApprovals(): Promise<void> {
    if (!isDBConfigured()) return;

    let expired: ApprovalRecord[] = [];
    try {
        const result = await getPool().query<ApprovalRecord>(`
            UPDATE approval_queue
            SET status = 'expired', resolved_at = NOW()
            WHERE status = 'pending'
              AND requested_at < NOW() - INTERVAL '10 minutes'
            RETURNING id, session_id, slack_channel, slack_message_ts
        `);

        expired = result.rows;
        if (expired.length > 0) {
            console.log(`[expire_approvals] Expired ${expired.length} stale approvals`);
        }
    } catch (err) {
        console.warn('[expire_approvals] Failed (non-fatal):', err);
        return;
    }

    // HIGH-8: Update expired Slack cards so Pilots don't click dead buttons
    if (!env.SLACK_BOT_TOKEN || expired.length === 0) return;

    const { WebClient } = await import('@slack/web-api');
    const slack = new WebClient(env.SLACK_BOT_TOKEN);

    for (const approval of expired) {
        if (!approval.slack_channel || !approval.slack_message_ts) continue;
        try {
            await slack.chat.update({
                channel: approval.slack_channel,
                ts: approval.slack_message_ts,
                text: '⏰ This approval expired',
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `⏰ *Approval Expired* — This action card expired after 10 minutes.\nSession: \`${approval.session_id}\``,
                        },
                    },
                ],
            });
        } catch (err) {
            console.warn(`[expire_approvals] Failed to update Slack card for approval ${approval.id}:`, err);
        }
    }
}
