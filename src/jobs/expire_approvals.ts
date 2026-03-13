import { getPool, isDBConfigured } from '../database/db.js';

export async function expireStaleApprovals(): Promise<void> {
    if (!isDBConfigured()) return;

    try {
        const result = await getPool().query(`
            UPDATE approval_queue
            SET status = 'expired', resolved_at = NOW()
            WHERE status = 'pending'
              AND requested_at < NOW() - INTERVAL '10 minutes'
            RETURNING id, session_id
        `);

        if (result.rows.length > 0) {
            console.log(`[expire_approvals] Expired ${result.rows.length} stale approvals`);
        }
    } catch (err) {
        console.warn('[expire_approvals] Failed (non-fatal):', err);
    }
}

