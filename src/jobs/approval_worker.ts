/**
 * Approval Worker — pg-boss Job Queue for HITL Resume
 *
 * Decouples the Slack/Telegram approval webhook from tool execution.
 * Instead of running resumeApprovedSession synchronously in the webhook
 * handler (risking timeouts), the webhook enqueues a job and returns
 * immediately. This worker processes the job in the background with
 * automatic retries.
 *
 * Also schedules the daily fix_memory TTL cleanup job (W7).
 *
 * Why pg-boss (not BullMQ)?
 *   - Cloud-Claw already uses PostgreSQL
 *   - pg-boss stores jobs IN PostgreSQL (no Redis dependency)
 *   - Jobs survive process restarts
 *   - Exactly-once execution guarantee
 */

import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';
import { cleanupOldFixes } from '../database/db.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import type { ReplyFn, ApprovalFn } from '../tools/types.js';

let _boss: InstanceType<typeof PgBoss> | null = null;

/**
 * Get or create the pg-boss instance.
 * Returns null if DATABASE_URL is not configured.
 */
export function getBoss(): InstanceType<typeof PgBoss> | null {
    return _boss;
}

/**
 * Start the pg-boss approval worker.
 *
 * @param onReply  - function to send text messages back to the pilot
 * @param onApproval - function to render approval cards
 */
export async function startApprovalWorker(
    onReply: ReplyFn,
    onApproval: ApprovalFn,
): Promise<void> {
    if (!env.DATABASE_URL) {
        console.log('[approval-worker] No DATABASE_URL — skipping pg-boss startup');
        return;
    }

    try {
        _boss = new PgBoss(env.DATABASE_URL);

        _boss.on('error', (err: unknown) => {
            console.error('[approval-worker] pg-boss error:', err);
        });

        await _boss.start();
        console.log('[approval-worker] pg-boss started ✓');

        // ─── HITL resume worker ──────────────────────────────────────────────
        await _boss.work(
            'hitl-resume',
            { batchSize: 1, localConcurrency: 3 },
            async (jobs: { data: { approvalId: number; userId: string; approved: boolean; rejectionReason?: string } }[]) => {
                for (const job of jobs) {
                    const { approvalId, userId, approved, rejectionReason } = job.data;
                    console.log(`[approval-worker] Processing hitl-resume job: approval=${approvalId} approved=${approved}`);
                    await resumeApprovedSession(approvalId, approved, userId, onReply, onApproval, rejectionReason);
                }
            },
        );
        console.log('[approval-worker] hitl-resume worker registered');

        // ─── W7: Scheduled fix_memory cleanup (daily at 3 AM) ────────────────
        await _boss.schedule('fix-memory-cleanup', '0 3 * * *', {});
        await _boss.work('fix-memory-cleanup', async () => {
            const deleted = await cleanupOldFixes(90);
            console.log(`[approval-worker] fix-memory-cleanup: ${deleted} records purged`);
        });
        console.log('[approval-worker] fix-memory-cleanup scheduled (daily 3 AM)');

    } catch (err) {
        console.warn('[approval-worker] pg-boss startup failed (non-fatal):', err);
        _boss = null;
    }
}

/**
 * Enqueue an approval for background processing.
 * Called by webhook handlers INSTEAD of running resumeApprovedSession directly.
 * Returns immediately — the worker picks up the job asynchronously.
 */
export async function enqueueApproval(
    approvalId: number,
    userId: string,
    approved: boolean,
    rejectionReason?: string,
): Promise<boolean> {
    if (!_boss) {
        // Fallback: if pg-boss isn't running, return false so caller
        // can fall back to synchronous execution.
        return false;
    }

    try {
        const jobId = await _boss.send(
            'hitl-resume',
            { approvalId, userId, approved, rejectionReason },
            {
                retryLimit: 2,          // retry twice on failure
                retryDelay: 5,          // wait 5 seconds between retries
                expireInSeconds: 300,   // expire if not processed in 5 min
            },
        );
        console.log(`[approval-worker] Enqueued hitl-resume job ${jobId} for approval ${approvalId}`);
        return true;
    } catch (err) {
        console.error('[approval-worker] Failed to enqueue approval:', err);
        return false;
    }
}

/**
 * Gracefully stop the pg-boss instance.
 */
export async function stopApprovalWorker(): Promise<void> {
    if (_boss) {
        await _boss.stop();
        _boss = null;
        console.log('[approval-worker] pg-boss stopped');
    }
}
