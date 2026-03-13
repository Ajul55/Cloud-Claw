import { getPool, isDBConfigured } from '../database/db.js';
import { sendSlackMessage } from '../interfaces/slack.js';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// In-memory fallback tracker
const sessionActivity = new Map<string, Date>();

export function touchSession(sessionId: string): void {
    sessionActivity.set(sessionId, new Date());
}

export async function timeoutStaleSessions(): Promise<void> {
    if (!isDBConfigured()) {
        const now = Date.now();
        for (const [sessionId, lastActivity] of sessionActivity.entries()) {
            if (now - lastActivity.getTime() > SESSION_TIMEOUT_MS) {
                sessionActivity.delete(sessionId);
                console.log(`[timeout_sessions] In-memory session ${sessionId} timed out`);
            }
        }
        return;
    }

    try {
        const stale = await getPool().query<{
            id: string;
            channel: string;
            reply_target: string | null;
        }>(`
            SELECT DISTINCT s.id, s.channel, s.reply_target
            FROM sessions s
            INNER JOIN approval_queue a ON a.session_id = s.id
            WHERE s.status = 'active'
              AND a.status = 'pending'
              AND s.last_activity < NOW() - INTERVAL '30 minutes'
        `);

        for (const session of stale.rows) {
            await getPool().query(
                `UPDATE sessions
                 SET status = 'timed_out', updated_at = NOW()
                 WHERE id = $1`,
                [session.id]
            );
            await getPool().query(
                `UPDATE approval_queue
                 SET status = 'expired', resolved_at = NOW()
                 WHERE session_id = $1 AND status = 'pending'`,
                [session.id]
            );

            if (session.channel === 'slack' && session.reply_target) {
                await sendSlackMessage(
                    session.reply_target,
                    '⏰ Session timed out after 30 minutes of inactivity. Please start a new request.'
                );
            }

            console.log(`[timeout_sessions] Session ${session.id} timed out`);
        }
    } catch (err) {
        console.warn('[timeout_sessions] Failed (non-fatal):', err);
    }
}

