import cron from 'node-cron';
import { env } from '../config/env.js';
import { getPool, isDBConfigured } from '../database/db.js';

export type NotifyFn = (text: string) => Promise<void>;

/**
 * Starts the Sentinel cron jobs.
 * @param notify A callback to broadcast messages to the primary channel (e.g. Telegram or Slack).
 */
export function startSentinel(notify: NotifyFn): void {
    if (!env.PILOT_CHAT_ID) {
        console.log('[Sentinel] Auto-scheduling disabled (no PILOT_CHAT_ID set).');
        return;
    }

    console.log('[Sentinel] Heartbeat Scheduler online.');

    // Morning Briefing at 08:00 AM daily
    cron.schedule('0 8 * * *', async () => {
        try {
            let activeNodes = 0;
            let totalNodes = 0;

            if (isDBConfigured()) {
                const pool = getPool();
                const res = await pool.query('SELECT is_active FROM server_nodes');
                totalNodes = res.rows.length;
                activeNodes = res.rows.filter(r => r.is_active).length;
            }

            const msg = `🌅 *Good morning, Pilot.*\n\n` +
                `Sentinel Heartbeat active.\n` +
                `Managed Nodes: ${activeNodes}/${totalNodes} online.\n` +
                `Systems nominal. Type /status to view current LLM loop states.`;

            await notify(msg);
        } catch (err) {
            console.error('[Sentinel] Morning briefing failed:', err);
        }
    });

    // We can add more cron jobs here (e.g. hourly disk space checks)
}
