import https from 'https';
import { URL } from 'url';
import cron from 'node-cron';
import { env } from '../config/env.js';
import { isDBConfigured, getPool } from '../database/db.js';
import { getTotalActiveSessions } from '../services/session_limiter.js';
import { getConsecutiveLlmFailures } from './llm_health.js';

function postWebhook(url: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, (res) => {
            res.resume();
            res.on('end', resolve);
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

export async function sendOpsAlert(
    title: string,
    message: string,
    severity: 'warning' | 'critical',
): Promise<void> {
    if (!env.SLACK_OPS_WEBHOOK_URL) return;

    const color = severity === 'critical' ? '#dc2626' : '#f59e0b';
    const payload = JSON.stringify({
        attachments: [{
            color,
            blocks: [
                {
                    type: 'section',
                    text: { type: 'mrkdwn', text: `*${title}*\n${message}` },
                },
                {
                    type: 'context',
                    elements: [{
                        type: 'mrkdwn',
                        text: `Cloud-Claw • ${new Date().toISOString()}`,
                    }],
                },
            ],
        }],
    });

    try {
        await postWebhook(env.SLACK_OPS_WEBHOOK_URL, payload);
    } catch (err) {
        console.error('[ops-alerts] Failed to send Slack alert:', err);
    }
}

async function runChecks(): Promise<void> {
    // 1. Memory high
    const memMb = process.memoryUsage().rss / 1024 / 1024;
    if (memMb > 800) {
        await sendOpsAlert(
            'High Memory Usage',
            `Cloud-Claw is using ${Math.round(memMb)} MB — approaching the 1024 MB restart threshold.`,
            'warning',
        );
    }

    // 2. DB unreachable
    if (isDBConfigured()) {
        try {
            await getPool().query('SELECT 1');
        } catch {
            await sendOpsAlert(
                'Database Connection Lost',
                'Cloud-Claw cannot reach PostgreSQL — all sessions will fail.',
                'critical',
            );
        }
    }

    // 3. LLM API consecutive failures
    const llmErrors = getConsecutiveLlmFailures();
    if (llmErrors >= 3) {
        await sendOpsAlert(
            'LLM API Failing',
            `${llmErrors} consecutive LLM errors — check your provider's status page. All user sessions are failing.`,
            'critical',
        );
    }

    // 4. Recent process crash (uptime < 5 min means PM2 just restarted us)
    const uptimeSec = process.uptime();
    if (uptimeSec < 300) {
        await sendOpsAlert(
            'Cloud-Claw Restarted',
            `Process uptime is ${Math.round(uptimeSec / 60)} minute(s) — Cloud-Claw crashed and was restarted by PM2. Check logs: \`pm2 logs cloudclaw\``,
            'warning',
        );
    }
}

export function startAlertScheduler(): void {
    if (!env.SLACK_OPS_WEBHOOK_URL) {
        console.log('[ops-alerts] SLACK_OPS_WEBHOOK_URL not set — alerting disabled');
        return;
    }
    console.log('[ops-alerts] Alert scheduler started (5-min interval)');
    cron.schedule('*/5 * * * *', () => {
        void runChecks();
    });
}
