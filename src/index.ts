/**
 * Cloud-Claw — Main Entry Point
 *
 * Boots the system:
 *   1. Validate environment
 *   2. Connect to PostgreSQL (if configured)
 *   3. Start Telegram (if configured)
 *   4. Start Slack (Socket Mode)
 */

import cron from 'node-cron';
import { env } from './config/env.js';
import { connectDB, cleanupOldFixes } from './database/db.js';
import { createSlackApp, startSlackApp } from './interfaces/slack.js';
import { expireStaleApprovals } from './jobs/expire_approvals.js';
import { timeoutStaleSessions } from './jobs/timeout_sessions.js';
import { startSentinel } from './sentinel/scheduler.js';
import { startHealthServer } from './health.js';
import { createGatewayHandler } from './interfaces/http_gateway.js';

async function main(): Promise<void> {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║       ☁️  Cloud-Claw  v1.0.0          ║');
    console.log('║     AIOps Hub — Level 1 Foundation   ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');

    // 1. Database (optional)
    if (env.DATABASE_URL) {
        await connectDB();
    } else {
        console.log('[DB] No DATABASE_URL configured — running without persistence');
    }

    // 1b. Health check endpoint + Cloudstick HTTP gateway
    startHealthServer(9000, env.CLOUDSTICK_GATEWAY_KEY ? createGatewayHandler() : undefined);

    // 2. Telegram (optional)
    let telegramBot: Awaited<ReturnType<typeof import('./interfaces/telegram.js').createTelegramBot>> | null = null;
    if (env.TELEGRAM_BOT_TOKEN) {
        const { createTelegramBot, startTelegramBot } = await import('./interfaces/telegram.js');
        telegramBot = createTelegramBot();
        await startTelegramBot(telegramBot);
    } else {
        console.log('[Telegram] No TELEGRAM_BOT_TOKEN configured — skipping');
    }

    // 3. Slack (primary)
    let slackApp: Awaited<ReturnType<typeof createSlackApp>> | null = null;
    if (env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN) {
        const slackAppCandidate = createSlackApp();
        slackApp = await startSlackApp(slackAppCandidate);
        if (!slackApp) {
            console.warn('[Slack] Disabled — startup failed. Running without Slack.');
        }
    } else {
        console.log('[Slack] Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN — skipping');
    }

    console.log('');
    console.log('✅ Cloud-Claw is operational. Waiting for messages...');
    console.log('');

    cron.schedule('*/5 * * * *', () => {
        void expireStaleApprovals();
    });
    cron.schedule('*/10 * * * *', () => {
        void timeoutStaleSessions();
    });
    // W7: Daily fix_memory TTL cleanup at 3 AM
    cron.schedule('0 3 * * *', () => {
        void cleanupOldFixes(90);
    });

    // 4. Sentinel Heartbeat
    startSentinel(async (text: string) => {
        if (!env.PILOT_CHAT_ID) return;

        // Telegram chats are entirely numeric (can be negative for groups)
        if (telegramBot && /^-?\d+$/.test(env.PILOT_CHAT_ID)) {
            try {
                await telegramBot.api.sendMessage(env.PILOT_CHAT_ID, text, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('[Sentinel] Failed to notify via Telegram:', err);
            }
        } else if (slackApp) {
            // Slack channels are alphanumeric (e.g., C1234ABC)
            try {
                await slackApp.client.chat.postMessage({
                    channel: env.PILOT_CHAT_ID,
                    text
                });
            } catch (err) {
                console.error('[Sentinel] Failed to notify via Slack:', err);
            }
        }
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`\n[Main] Caught ${signal} — shutting down...`);
        if (telegramBot) telegramBot.stop();
        if (slackApp) await slackApp.stop();
        if (env.DATABASE_URL) {
            const { closeDB } = await import('./database/db.js');
            await closeDB();
        }
        console.log('[Main] Goodbye 👋');
        process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
    console.error('[Main] Fatal startup error:', err);
    process.exit(1);
});
