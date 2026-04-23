/**
 * Session Limiter — in-memory per-account concurrent session limiting.
 * Resets on process restart (acceptable for Phase 2).
 *
 * Plan limits:
 *   starter (or null/unknown) → 1
 *   pro                       → 3
 *   business                  → 10
 *
 * Monthly call caps (Phase 4):
 *   starter → 100
 *   pro     → 1000
 *   business → 10000
 */

import { getPool, isDBConfigured } from '../database/db.js';

const PLAN_LIMITS: Record<string, number> = {
    starter: 1,
    pro: 3,
    business: 10,
};

const DEFAULT_LIMIT = 1;

const MONTHLY_CAP: Record<string, number> = {
    starter: 100,
    pro: 1000,
    business: 10000,
};

const activeSessions = new Map<string, number>();

function limitForPlan(planTier: string | null): number {
    if (!planTier) return DEFAULT_LIMIT;
    return PLAN_LIMITS[planTier.toLowerCase()] ?? DEFAULT_LIMIT;
}

/**
 * Attempt to acquire a session slot for the given account.
 * Returns true if under the limit (slot acquired), false if at/over limit.
 */
export function acquireSession(accountId: string, planTier: string | null): boolean {
    const limit = limitForPlan(planTier);
    const current = activeSessions.get(accountId) ?? 0;
    if (current >= limit) return false;
    activeSessions.set(accountId, current + 1);
    return true;
}

/**
 * Release a previously acquired session slot.
 */
export function releaseSession(accountId: string): void {
    const current = activeSessions.get(accountId) ?? 0;
    if (current <= 1) {
        activeSessions.delete(accountId);
    } else {
        activeSessions.set(accountId, current - 1);
    }
}

/**
 * Return the number of active sessions for the given account.
 */
export function getActiveSessions(accountId: string): number {
    return activeSessions.get(accountId) ?? 0;
}

/**
 * Check whether the account has reached its monthly LLM call cap.
 * Returns true if at or over cap. Fails open (returns false) when DB is unavailable.
 */
export async function isMonthlyCapReached(accountId: string, planTier: string | null): Promise<boolean> {
    if (!isDBConfigured()) return false;

    const cap = planTier
        ? (MONTHLY_CAP[planTier.toLowerCase()] ?? MONTHLY_CAP['starter'])
        : MONTHLY_CAP['starter'];

    try {
        const pool = getPool();
        const { rows } = await pool.query<{ call_count: string }>(
            `SELECT COUNT(*) AS call_count
             FROM usage_log
             WHERE account_id = $1
               AND date_trunc('month', created_at) = date_trunc('month', NOW())`,
            [accountId],
        );
        const callCount = parseInt(rows[0]?.call_count ?? '0', 10);
        return callCount >= cap;
    } catch (err) {
        console.warn('[session_limiter] Monthly cap check failed (non-fatal):', err);
        return false;
    }
}
