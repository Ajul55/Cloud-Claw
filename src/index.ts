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
import { startHealthServer, startDashboardServer, registerReadinessCheck } from './health.js';
import { startAlertScheduler } from './telemetry/ops_alerts.js';
import { createGatewayHandler } from './interfaces/http_gateway.js';
import { logger } from './telemetry/logger.js';

// ─── FIX: Global crash handlers ─────────────────────────────────────────────
// Without these, unhandled rejections and uncaught exceptions kill PM2 workers
// silently with no diagnostic output — making production outages undebuggable.
process.on('uncaughtException', (err) => {
    logger.error('[FATAL] uncaughtException — process will exit', err);
    // Flush logs then exit non-zero so PM2 restarts the worker
    setTimeout(() => process.exit(1), 500);
});
// HIGH-10: Track unhandled rejections — alert ops when threshold exceeded
let _unhandledRejectionCount = 0;
let _lastRejectionAlertAt = 0;
const REJECTION_ALERT_THRESHOLD = 5;
const REJECTION_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

process.on('unhandledRejection', (reason) => {
    _unhandledRejectionCount++;
    logger.error(`[FATAL] unhandledRejection #${_unhandledRejectionCount}`, reason);

    const now = Date.now();
    if (
        _unhandledRejectionCount >= REJECTION_ALERT_THRESHOLD &&
        now - _lastRejectionAlertAt > REJECTION_ALERT_COOLDOWN_MS
    ) {
        _lastRejectionAlertAt = now;
        // Lazy import to avoid circular dep at module load time
        import('./telemetry/ops_alerts.js').then(({ sendOpsAlert }) => {
            void sendOpsAlert('Unhandled Rejections', `${_unhandledRejectionCount} unhandled rejections since startup.\n\nLast: ${String(reason).slice(0, 200)}`, 'warning');
        }).catch(() => { /* non-fatal */ });
    }
});

async function main(): Promise<void> {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║       ☁️  Cloud-Claw  v1.0.0          ║');
    console.log('║     AIOps Hub — Level 1 Foundation   ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');

    // MED-8: Readiness checks — /ready returns 503 until all configured services are up
    let _dbReady = false;
    let _slackReady = false;
    let _telegramReady = false;
    let _telegramConfigured = false;
    let _slackConfigured = false;
    registerReadinessCheck('db', () => !env.DATABASE_URL || _dbReady);
    registerReadinessCheck('slack', () => !_slackConfigured || _slackReady);
    registerReadinessCheck('telegram', () => !_telegramConfigured || _telegramReady);

    // 1. Database (optional)
    if (env.DATABASE_URL) {
        await connectDB();
        _dbReady = true;
    } else {
        logger.info('[DB] No DATABASE_URL configured — running without persistence');
    }

    // 1b. Health check endpoint + Cloudstick HTTP gateway
    startHealthServer(9000, env.CLOUDSTICK_GATEWAY_KEY ? createGatewayHandler() : undefined);
    if (env.DATABASE_URL) {
        startDashboardServer(Number(process.env.DASHBOARD_PORT) || 3001);
    }

    // 2. Telegram (optional)
    let telegramBot: Awaited<ReturnType<typeof import('./interfaces/telegram.js').createTelegramBot>> | null = null;
    if (env.TELEGRAM_BOT_TOKEN) {
        _telegramConfigured = true;
        const { createTelegramBot, startTelegramBot } = await import('./interfaces/telegram.js');
        telegramBot = createTelegramBot();
        await startTelegramBot(telegramBot);
        _telegramReady = true;
    } else {
        logger.info('[Telegram] No TELEGRAM_BOT_TOKEN configured — skipping');
    }

    // 3. Slack (primary)
    let slackApp: Awaited<ReturnType<typeof createSlackApp>> | null = null;
    if (env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN) {
        _slackConfigured = true;
        const slackAppCandidate = createSlackApp();
        slackApp = await startSlackApp(slackAppCandidate);
        if (!slackApp) {
            logger.warn('[Slack] Disabled — startup failed. Running without Slack.');
        } else {
            _slackReady = true;
        }
    } else {
        logger.info('[Slack] Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN — skipping');
    }

    console.log('');
    console.log('✅ Cloud-Claw is operational. Waiting for messages...');
    console.log('');

    // Phase 6: Ops alerting
    startAlertScheduler();

    cron.schedule('*/5 * * * *', () => {
        expireStaleApprovals().catch(err => logger.error('[cron] expireStaleApprovals failed', err));
    });
    cron.schedule('*/10 * * * *', () => {
        timeoutStaleSessions().catch(err => logger.error('[cron] timeoutStaleSessions failed', err));
    });
    // W7: Daily fix_memory TTL cleanup at 3 AM
    cron.schedule('0 3 * * *', () => {
        cleanupOldFixes(90).catch(err => logger.error('[cron] cleanupOldFixes failed', err));
    });

    // 4. Sentinel Heartbeat
    startSentinel(async (text: string) => {
        if (!env.PILOT_CHAT_ID) return;

        // Telegram chats are entirely numeric (can be negative for groups)
        if (telegramBot && /^-?\d+$/.test(env.PILOT_CHAT_ID)) {
            try {
                await telegramBot.api.sendMessage(env.PILOT_CHAT_ID, text, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error('[Sentinel] Failed to notify via Telegram', err);
            }
        } else if (slackApp) {
            // Slack channels are alphanumeric (e.g., C1234ABC)
            try {
                await slackApp.client.chat.postMessage({
                    channel: env.PILOT_CHAT_ID,
                    text
                });
            } catch (err) {
                logger.error('[Sentinel] Failed to notify via Slack', err);
            }
        }
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.info(`[Main] Caught ${signal} — shutting down...`);
        if (telegramBot) telegramBot.stop();
        if (slackApp) await slackApp.stop();
        if (env.DATABASE_URL) {
            const { closeDB } = await import('./database/db.js');
            await closeDB();
            const { closeDashboardPool } = await import('./dashboard/pool.js');
            await closeDashboardPool();
        }
        const { drainSSHPool } = await import('./utils/ssh.js');
        drainSSHPool();
        logger.info('[Main] Goodbye');
        process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
    logger.error('[Main] Fatal startup error', err);
    process.exit(1);
});
