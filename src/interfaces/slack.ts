/**
 * Slack Interface
 *
 * Socket Mode bot using @slack/bolt (same as OpenClaw).
 * - Identity whitelist: only responds to SLACK_USER_ID
 * - Socket Mode — no public URL required
 * - HITL: Block Kit buttons for Tier-3 action approval
 */

import bolt from '@slack/bolt';
const { App, LogLevel } = bolt;
type SlackAppInstance = InstanceType<typeof App>;

import { env } from '../config/env.js';
import { runAgentLoop } from '../agents/loop.js';
import { getSession } from '../database/db.js';
import { buildApprovalMessage } from '../hitl/approval_message.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { enqueueApproval } from '../jobs/approval_worker.js';
import { handleSlashCommand } from '../commands/slash_handler.js';
import { StatusIndicator } from '../utils/status_indicator.js';
import type { ApprovalFn, ReplyFn } from '../tools/types.js';
import { getUserBySlackUserId } from '../services/user_service.js';
import { runWithCloudstickContext } from '../api/cloudstick_context.js';

let slackAppRef: SlackAppInstance | null = null;

export function createSlackApp(): SlackAppInstance {
    const app = new App({
        token: env.SLACK_BOT_TOKEN!,
        appToken: env.SLACK_APP_TOKEN!,
        socketMode: true,
        // Using @slack/bolt >= v4 to prevent crashes on 'too_many_websockets' errors
        logLevel: LogLevel.ERROR,
    });
    slackAppRef = app;

    // Aggressive global logger cache for debugging Slack event routing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(async ({ payload, next }: any) => {
        console.log(`[Slack-DIAGNOSTIC] Raw Event Inbound:`, JSON.stringify(payload).slice(0, 300));
        await next();
    });

    // ─── Shared Message Handler ───────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMessage = async (text: string | undefined, user: string | undefined, channel: string, say: any, client: any) => {
        if (!user || !text) return;

        // Strip <@U12345> mentions from the text
        const cleanText = text.replace(/<@[^>]+>/g, '').trim();
        if (!cleanText) return;

        // Try to find a Cloudstick business user linked to this Slack user ID
        const cloudstickUser = await getUserBySlackUserId(user);

        if (!cloudstickUser) {
            // Fall back to legacy single-user whitelist for non-Cloudstick users
            if (env.SLACK_USER_ID && env.SLACK_USER_ID.startsWith('U') && user !== env.SLACK_USER_ID) {
                console.warn(`[Slack] Ignored message from unauthorized user: ${user}`);
                return;
            }
        }

        const sessionId = cloudstickUser
            ? `cloudstick:${cloudstickUser.cloudstick_account_id}`
            : `slack:${user}`;
        const lowerText = cleanText.toLowerCase().trim();
        const isContinueRequest = /^(?:@cloudclaw\s+)?(?:continue|keep going)\b/.test(lowerText);
        console.log(`[Slack] Message from ${user} in ${channel}: ${cleanText.slice(0, 80)}`);

        const onReply: ReplyFn = async (response, options) => {
            if (options?.blocks) {
                // Block Kit message — don't chunk; send as a single rich message
                await say({ text: response, blocks: options.blocks });
            } else {
                const chunks = splitMessage(response, 3000);
                for (const chunk of chunks) {
                    await say(chunk);
                }
            }
        };

        const onApproval: ApprovalFn = async (context) => {
            const { slackBlocks } = buildApprovalMessage(context);
            console.log('[slack] onApproval called — approvalId:', context.approvalId);
            console.log('[slack] Sending approval card to channel:', channel);
            try {
                const result = await client.chat.postMessage({
                    channel,
                    text: '⚠️ Action requires confirmation (Proceed/Reject)',
                    blocks: slackBlocks,
                });
                console.log('[slack] Approval card sent — ts:', result.ts);
            } catch (err) {
                console.error('[slack] FAILED to send approval card:', err);
                await client.chat.postMessage({
                    channel,
                    text:
                        '🔐 Approval required. The interactive card failed to render.\n'
                        + `Target: ${context.targetHost}\n`
                        + `Reason: ${context.rationale}\n`
                        + `Reply with \`proceed\` or \`reject\`. Approval ID: ${context.approvalId}`,
                });
            }
        };

        try {
            const isCommand = await handleSlashCommand(cleanText, 'slack', user, onReply);
            if (isCommand) return;

            const indicator = new StatusIndicator('slack', channel, client, user);
            let loopText = cleanText;

            if (isContinueRequest) {
                const existingSession = await getSession(sessionId);
                if (!existingSession) {
                    await onReply('⚠️ No active session to continue.');
                    return;
                }
                loopText = cleanText.length > 'continue'.length
                    ? `continue previous investigation. Latest Pilot instruction: ${cleanText}`
                    : 'continue previous investigation from the saved session. Resume from the latest unresolved finding and next step.';
            }

            const runLoop = () => runAgentLoop(
                { sessionId, channel: cloudstickUser ? 'cloudstick' : 'slack', userId: user, text: loopText, replyTarget: channel },
                onReply,
                onApproval,
                indicator
            );

            if (cloudstickUser) {
                await runWithCloudstickContext(cloudstickUser, runLoop);
            } else {
                await runLoop();
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('[Slack] Loop error:', errMsg);
            await say(`❌ Unexpected error: ${errMsg}`);
        }
    };

    // ─── Direct Messages & Audio Processing ───────────────────────────────────
    app.message(async ({ message, say, client }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = message as any;

        let text = msg.text || '';

        if (msg.subtype === 'file_share' && msg.files && msg.files.length > 0) {
            const file = msg.files[0];
            if (file.mimetype?.startsWith('audio/')) {
                try {
                    const response = await fetch(file.url_private_download, {
                        headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN!}` }
                    });
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    const { transcribeAudio } = await import('../voice/transcriber.js');
                    const transcribedText = await transcribeAudio(buffer, file.name || 'audio.webm');

                    await say(`_🎙 Transcribed:_ ${transcribedText}`);
                    text = text ? `${text}\n${transcribedText}` : transcribedText;
                } catch (err) {
                    console.error('[Slack] Voice processing error:', err);
                    await say('❌ Failed to transcribe audio.');
                    return;
                }
            } else {
                return; // ignore non-audio files
            }
        } else if (msg.subtype !== undefined && msg.subtype !== 'file_share') {
            return;
        }

        await handleMessage(text, msg.user, msg.channel, say, client);
    });

    // ─── Channel Mentions ─────────────────────────────────────────────────────
    app.event('app_mention', async ({ event, say, client }) => {
        await handleMessage(event.text, event.user, event.channel, say, client);
    });

    // ─── HITL: Approve ──────────────────────────────────────────────────────────
    app.action('approve_command', async ({ body, ack, client }) => {
        await ack();

        const action = (body as { actions: Array<{ value: string }> }).actions[0];
        const approvalId = parseInt(action.value, 10);
        const channelId = (body as { channel?: { id: string } }).channel?.id;
        const userId = (body as { user?: { id: string } }).user?.id ?? 'unknown';

        if (!channelId) return;

        if ((body as any).message?.ts) {
            const originalBlocks = (body as any).message?.blocks || [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const preservedBlocks = originalBlocks.filter((b: any) => b.type !== 'actions' && b.type !== 'input');
            preservedBlocks[0].text.text = '✅ Action Approved';
            preservedBlocks.push({
                type: 'context',
                elements: [{ type: 'mrkdwn', text: `✅ *Approved* by <@${userId}>` }]
            });

            await client.chat.update({
                channel: channelId,
                ts: (body as any).message.ts,
                text: 'Action Approved',
                blocks: preservedBlocks
            }).catch(() => { });
        }

        // W4: Try async queue first, fall back to synchronous execution
        const enqueued = await enqueueApproval(approvalId, userId, true);
        if (!enqueued) {
            await resumeApprovedSession(
                approvalId,
                true,
                userId,
                async (text) => { await client.chat.postMessage({ channel: channelId, text }); },
                async (context) => {
                    const { slackBlocks } = buildApprovalMessage(context);
                    await client.chat.postMessage({ channel: channelId, text: 'Approval Required', blocks: slackBlocks });
                }
            );
        }
    });

    // ─── HITL: Reject ───────────────────────────────────────────────────────────
    app.action('reject_command', async ({ body, ack, client }) => {
        await ack();

        const action = (body as { actions: Array<{ value: string }> }).actions[0];
        const approvalId = parseInt(action.value, 10);
        const channelId = (body as { channel?: { id: string } }).channel?.id;
        const userId = (body as { user?: { id: string } }).user?.id ?? 'unknown';
        const reason = (body as any).state?.values?.rejection_reason_block?.rejection_reason_input?.value ?? undefined;

        if (!channelId) return;

        if ((body as any).message?.ts) {
            const originalBlocks = (body as any).message?.blocks || [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const preservedBlocks = originalBlocks.filter((b: any) => b.type !== 'actions' && b.type !== 'input');
            preservedBlocks[0].text.text = '❌ Action Rejected';
            preservedBlocks.push({
                type: 'context',
                elements: [{ type: 'mrkdwn', text: `❌ *Rejected* by <@${userId}>${reason ? `\n*Reason:* ${reason}` : ''}` }]
            });

            await client.chat.update({
                channel: channelId,
                ts: (body as any).message.ts,
                text: 'Action Rejected',
                blocks: preservedBlocks
            }).catch(() => { });
        }

        // W4: Try async queue first, fall back to synchronous execution
        const enqueued = await enqueueApproval(approvalId, userId, false, reason);
        if (!enqueued) {
            await resumeApprovedSession(
                approvalId,
                false,
                userId,
                async (text) => { await client.chat.postMessage({ channel: channelId, text }); },
                async () => { },
                reason,
            );
        }
    });

    // ─── Interactive: Server Selection ────────────────────────────────────────
    // Each button has action_id `select_server__<label>` — regex catches all variants.
    // Note: app.action() handlers do not receive `say` in Bolt — use client.chat.postMessage.
    app.action(/^select_server__/, async ({ body, ack, client }) => {
        await ack();

        const action = (body as any).actions[0];
        const serverLabel: string = action.value;
        const channelId = (body as any).channel?.id;
        const userId = (body as any).user?.id ?? 'unknown';
        const ts = (body as any).message?.ts;

        if (!channelId) return;

        // Replace buttons with a receipt — no zombie buttons
        if (ts) {
            await client.chat.update({
                channel: channelId,
                ts,
                text: `Selected: ${serverLabel}`,
                blocks: [
                    {
                        type: 'context',
                        elements: [{
                            type: 'mrkdwn',
                            text: `🖥️ Selected: *${serverLabel}* by <@${userId}>`,
                        }],
                    },
                ],
            }).catch(err => console.warn('[slack] select_server chat.update failed:', err));
        }

        // Build a say-compatible wrapper for handleMessage
        const postSay = async (msgOrText: any) => {
            if (typeof msgOrText === 'string') {
                await client.chat.postMessage({ channel: channelId, text: msgOrText });
            } else {
                await client.chat.postMessage({ channel: channelId, ...msgOrText });
            }
        };

        // Re-enter the loop with the server label as the message text.
        await handleMessage(serverLabel, userId, channelId, postSay, client);
    });

    // ─── Interactive: Clarification — Cancel ──────────────────────────────────
    app.action('clarification_cancel', async ({ body, ack, client }) => {
        await ack();

        const channelId = (body as any).channel?.id;
        const userId = (body as any).user?.id ?? 'unknown';
        const ts = (body as any).message?.ts;

        if (!channelId) return;

        if (ts) {
            await client.chat.update({
                channel: channelId,
                ts,
                text: 'Cancelled',
                blocks: [
                    {
                        type: 'context',
                        elements: [{
                            type: 'mrkdwn',
                            text: `❌ *Cancelled* by <@${userId}>`,
                        }],
                    },
                ],
            }).catch(err => console.warn('[slack] clarification_cancel chat.update failed:', err));
        }
    });

    // ─── Interactive: Clarification — Proceed ─────────────────────────────────
    app.action('clarification_proceed', async ({ body, ack, client }) => {
        await ack();

        const channelId = (body as any).channel?.id;
        const userId = (body as any).user?.id ?? 'unknown';
        const ts = (body as any).message?.ts;

        if (!channelId) return;

        // Update UI to receipt
        if (ts) {
            await client.chat.update({
                channel: channelId,
                ts,
                text: 'Proceeding...',
                blocks: [
                    {
                        type: 'context',
                        elements: [{
                            type: 'mrkdwn',
                            text: `✅ *Proceeding...* confirmed by <@${userId}>`,
                        }],
                    },
                ],
            }).catch(err => console.warn('[slack] clarification_proceed chat.update failed:', err));
        }

        const sessionId = `slack:${userId}`;

        const onReply: ReplyFn = async (response, options) => {
            if (options?.blocks) {
                await client.chat.postMessage({ channel: channelId, text: response, blocks: options.blocks });
            } else {
                const chunks = splitMessage(response, 3000);
                for (const chunk of chunks) {
                    await client.chat.postMessage({ channel: channelId, text: chunk });
                }
            }
        };

        const onApproval: ApprovalFn = async (context) => {
            const { slackBlocks } = buildApprovalMessage(context);
            await client.chat.postMessage({
                channel: channelId,
                text: 'Action requires confirmation (Proceed/Reject)',
                blocks: slackBlocks,
            });
        };

        // isProceedClarification: true bypasses the shouldPauseForClarification gate in loop.ts
        await runAgentLoop(
            {
                sessionId,
                channel: 'slack',
                userId,
                text: 'Proceed',
                replyTarget: channelId,
                isProceedClarification: true,
            },
            onReply,
            onApproval,
        );
    });

    return app;
}

export async function startSlackApp(app: SlackAppInstance): Promise<SlackAppInstance | null> {
    try {
        await app.start();
        console.log('[Slack] Socket Mode connected ✓');
        return app;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Slack] Failed to start Slack Socket Mode (offline?):', msg);
        return null;
    }
}

export async function sendSlackMessage(channel: string, text: string): Promise<void> {
    if (!slackAppRef) {
        console.warn('[Slack] sendSlackMessage called before Slack app initialization');
        return;
    }

    await slackAppRef.client.chat.postMessage({
        channel,
        text,
    });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.slice(i, i + maxLen));
    }
    return chunks;
}
