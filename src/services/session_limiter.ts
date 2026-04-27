/**
 * Session Limiter — per-account concurrent session limiting.
 *
 * When REDIS_URL is set: backed by Redis INCR/DECR with TTL auto-expiry so
 * session counts survive process restarts and work across PM2 cluster instances.
 *
 * When REDIS_URL is unset: falls back to in-memory Map (single-instance only,
 * resets on restart — acceptable for development).
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
import { isRedisConfigured, getRedisPublisher } from './redis_client.js';

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

/** Redis key TTL — 10 minutes. Phantom sessions expire automatically on crash. */
const SESSION_TTL_SECONDS = 10 * 60;

// In-memory fallback used when Redis is not configured
const _memSessions = new Map<string, number>();

function limitForPlan(planTier: string | null): number {
    if (!planTier) return DEFAULT_LIMIT;
    return PLAN_LIMITS[planTier.toLowerCase()] ?? DEFAULT_LIMIT;
}

/**
 * Attempt to acquire a session slot for the given account.
 * Returns true if under the limit (slot acquired), false if at/over limit.
 */
export async function acquireSession(accountId: string, planTier: string | null): Promise<boolean> {
    const limit = limitForPlan(planTier);

    if (isRedisConfigured()) {
        const redis = getRedisPublisher();
        const key = `cloudclaw:sessions:${accountId}`;
        // INCR is atomic — safe for concurrent requests
        const count = await redis.incr(key);
        await redis.expire(key, SESSION_TTL_SECONDS);
        if (count > limit) {
            await redis.decr(key);
            return false;
        }
        return true;
    }

    // In-memory fallback
    const current = _memSessions.get(accountId) ?? 0;
    if (current >= limit) return false;
    _memSessions.set(accountId, current + 1);
    return true;
}

/**
 * Release a previously acquired session slot.
 */
export async function releaseSession(accountId: string): Promise<void> {
    if (isRedisConfigured()) {
        const redis = getRedisPublisher();
        const key = `cloudclaw:sessions:${accountId}`;
        const count = await redis.decr(key);
        if (count <= 0) await redis.del(key);
        return;
    }

    const current = _memSessions.get(accountId) ?? 0;
    if (current <= 1) {
        _memSessions.delete(accountId);
    } else {
        _memSessions.set(accountId, current - 1);
    }
}

/**
 * Return the number of active sessions for the given account.
 */
export async function getActiveSessions(accountId: string): Promise<number> {
    if (isRedisConfigured()) {
        const val = await getRedisPublisher().get(`cloudclaw:sessions:${accountId}`);
        return parseInt(val ?? '0', 10);
    }
    return _memSessions.get(accountId) ?? 0;
}

/**
 * Return the total number of active sessions across all accounts.
 */
export async function getTotalActiveSessions(): Promise<number> {
    if (isRedisConfigured()) {
        const redis = getRedisPublisher();
        let total = 0;
        let cursor = 0;
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'cloudclaw:sessions:*', 'COUNT', 100);
            cursor = parseInt(nextCursor, 10);
            if (keys.length > 0) {
                const values = await redis.mget(...keys);
                total += values.reduce((sum: number, v: string | null) => sum + parseInt(v ?? '0', 10), 0);
            }
        } while (cursor !== 0);
        return total;
    }
    let total = 0;
    for (const count of _memSessions.values()) total += count;
    return total;
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
