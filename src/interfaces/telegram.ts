/**
 * Telegram Interface
 *
 * Long polling bot using grammY (TypeScript-native, same as OpenClaw).
 * - Identity whitelist: only responds to TELEGRAM_USER_ID
 * - Sends agent responses as messages
 * - HITL: InlineKeyboard Approve / Reject buttons for Tier-3 actions
 */

import { Bot, type Context } from 'grammy';
import { env } from '../config/env.js';
import { runAgentLoop } from '../agents/loop.js';
import { buildApprovalMessage } from '../hitl/approval_message.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { handleSlashCommand } from '../commands/slash_handler.js';
import { StatusIndicator } from '../utils/status_indicator.js';
import type { ApprovalFn, ReplyFn } from '../tools/types.js';

export function createTelegramBot(): Bot {
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN!);

    // ─── Identity guard middleware ──────────────────────────────────────────────
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (userId !== env.TELEGRAM_USER_ID) {
            console.warn(`[Telegram] Ignored message from unauthorized user: ${userId}`);
            return; // silently ignore
        }
        await next();
    });

    // ─── Shared Message Handler ─────────────────────────────────────────────────
    const processMessage = async (ctx: Context, text: string) => {
        const userId = String(ctx.from!.id);
        const sessionId = `telegram:${userId}`;

        console.log(`[Telegram] Message from ${userId}: ${text.slice(0, 80)}`);

        // Typing indicator
        await ctx.replyWithChatAction('typing');

        const onReply: ReplyFn = async (response, opts) => {
            // Split long messages (Telegram limit: 4096 chars)
            const chunks = splitMessage(response, 4096);
            for (let i = 0; i < chunks.length; i++) {
                if (i === chunks.length - 1 && opts) {
                    await ctx.reply(chunks[i], opts as any);
                } else {
                    await ctx.reply(chunks[i]);
                }
            }
        };

        const onApproval: ApprovalFn = async (context) => {
            const { telegramText, telegramKeyboard } = buildApprovalMessage(context);

            await ctx.reply(telegramText, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: telegramKeyboard },
            });
        };

        try {
            const isCommand = await handleSlashCommand(text, userId, onReply);
            if (isCommand) return;

            const indicator = new StatusIndicator('telegram', String(ctx.chat?.id || userId), ctx.api);

            await runAgentLoop(
                { sessionId, channel: 'telegram', userId, text },
                onReply,
                onApproval,
                indicator
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Telegram] Loop error:`, msg);
            await ctx.reply(`❌ Unexpected error: ${msg}`);
        }
    };

    // ─── Text Messages ──────────────────────────────────────────────────────────
    bot.on('message:text', async (ctx) => {
        await processMessage(ctx, ctx.message.text);
    });

    // ─── Voice Messages ─────────────────────────────────────────────────────────
    bot.on('message:voice', async (ctx) => {
        const voice = ctx.message.voice;
        if (!voice) return;

        try {
            await ctx.replyWithChatAction('typing');

            const file = await ctx.api.getFile(voice.file_id);
            if (!file.file_path) return;

            const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const { transcribeAudio } = await import('../voice/transcriber.js');
            const transcribedText = await transcribeAudio(buffer, 'voice.ogg');

            await ctx.reply(`_🎙 Transcribed:_ ${transcribedText}`, { parse_mode: 'Markdown' });
            await processMessage(ctx, transcribedText);
        } catch (err) {
            console.error('[Telegram] Voice processing error:', err);
            await ctx.reply('❌ Failed to process voice message.');
        }
    });

    // ─── Callback query handler (HITL buttons) ──────────────────────────────────
    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const [action, idStr] = data.split(':');
        const approvalId = parseInt(idStr, 10);

        if (!action || isNaN(approvalId)) {
            await ctx.answerCallbackQuery({ text: 'Invalid action.' });
            return;
        }

        const userId = String(ctx.from!.id);

        if (action === 'approve') {
            await ctx.answerCallbackQuery({ text: 'Processing approval...' });

            // Revert keyboard to a loading state to prevent double clicks
            await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => { });

            await resumeApprovedSession(
                approvalId,
                true,
                userId,
                async (text) => { void ctx.reply(text, { parse_mode: 'Markdown' }); },
                async (context) => {
                    const { telegramText, telegramKeyboard } = buildApprovalMessage(context);
                    await ctx.reply(telegramText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: telegramKeyboard } });
                }
            );

        } else if (action === 'reject') {
            await ctx.answerCallbackQuery({ text: 'Processing rejection...' });
            await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => { });

            await resumeApprovedSession(
                approvalId,
                false,
                userId,
                async (text) => { void ctx.reply(text, { parse_mode: 'Markdown' }); },
                async () => { } // not used in rejection
            );
        }
    });

    return bot;
}

export async function startTelegramBot(bot: Bot): Promise<void> {
    await bot.init();
    console.log(`[Telegram] Bot online — @${bot.botInfo.username} ✓`);
    void bot.start({
        onStart: (info) => console.log(`[Telegram] Polling started for @${info.username}`),
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


