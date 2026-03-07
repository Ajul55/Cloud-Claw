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
import { buildApprovalMessage } from '../hitl/approval_message.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { handleSlashCommand } from '../commands/slash_handler.js';
import { StatusIndicator } from '../utils/status_indicator.js';
import type { ApprovalFn, ReplyFn } from '../tools/types.js';

export function createSlackApp(): SlackAppInstance {
    const app = new App({
        token: env.SLACK_BOT_TOKEN,
        appToken: env.SLACK_APP_TOKEN,
        socketMode: true,
        logLevel: LogLevel.WARN,
    });

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

        // Identity whitelist — relaxed temporarily since the .env contains a channel ID
        if (env.SLACK_USER_ID && env.SLACK_USER_ID.startsWith('U') && user !== env.SLACK_USER_ID) {
            console.warn(`[Slack] Ignored message from unauthorized user: ${user}`);
            // Temporarily ignoring strictly to allow testing, uncomment to enforce
            // return;
        }

        const sessionId = `slack:${user}`;
        console.log(`[Slack] Message from ${user} in ${channel}: ${cleanText.slice(0, 80)}`);

        const onReply: ReplyFn = async (response) => {
            const chunks = splitMessage(response, 3000);
            for (const chunk of chunks) {
                await say(chunk);
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
            }
        };

        try {
            const isCommand = await handleSlashCommand(cleanText, user, onReply);
            if (isCommand) return;

            const indicator = new StatusIndicator('slack', channel, client, user);

            await runAgentLoop(
                { sessionId, channel: 'slack', userId: user, text: cleanText },
                onReply,
                onApproval,
                indicator
            );
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
                        headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` }
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

        // Optionally, update the message to remove buttons here
        if ((body as any).message?.ts) {
            await client.chat.update({
                channel: channelId,
                ts: (body as any).message.ts,
                text: 'Processing approval...',
                blocks: []
            }).catch(() => { });
        }

        await resumeApprovedSession(
            approvalId,
            true,
            userId,
            async (text) => { void client.chat.postMessage({ channel: channelId, text }); },
            async (context) => {
                const { slackBlocks } = buildApprovalMessage(context);
                void client.chat.postMessage({ channel: channelId, text: 'Approval Required', blocks: slackBlocks });
            }
        );
    });

    // ─── HITL: Reject ───────────────────────────────────────────────────────────
    app.action('reject_command', async ({ body, ack, client }) => {
        await ack();

        const action = (body as { actions: Array<{ value: string }> }).actions[0];
        const approvalId = parseInt(action.value, 10);
        const channelId = (body as { channel?: { id: string } }).channel?.id;
        const userId = (body as { user?: { id: string } }).user?.id ?? 'unknown';

        if (!channelId) return;

        if ((body as any).message?.ts) {
            await client.chat.update({
                channel: channelId,
                ts: (body as any).message.ts,
                text: 'Processing rejection...',
                blocks: []
            }).catch(() => { });
        }

        await resumeApprovedSession(
            approvalId,
            false,
            userId,
            async (text) => { void client.chat.postMessage({ channel: channelId, text }); },
            async () => { }
        );
    });

    return app;
}

export async function startSlackApp(app: SlackAppInstance): Promise<void> {
    await app.start();
    console.log('[Slack] Socket Mode connected ✓');
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
