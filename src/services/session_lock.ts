import { isRedisConfigured, getRedisPublisher } from './redis_client.js';

const LOCK_TTL_SECONDS = 300; // 5 min max loop duration; auto-expires on crash

// In-memory fallback for single-instance deploys without Redis
const _memoryLocks = new Map<string, Promise<void>>();
const _memoryResolvers = new Map<string, () => void>();

function redisKey(sessionId: string): string {
    return `session_lock:${sessionId}`;
}

/**
 * Acquire a per-session lock. Returns true if acquired, false if already held
 * by another instance (Redis mode). In memory-fallback mode, always queues
 * and awaits the prior lock before returning true.
 */
export async function acquireSessionLock(sessionId: string): Promise<boolean> {
    if (isRedisConfigured()) {
        const redis = getRedisPublisher();
        const result = await redis.set(redisKey(sessionId), '1', 'EX', LOCK_TTL_SECONDS, 'NX');
        return result === 'OK';
    }

    // In-memory: queue behind any existing lock (same behaviour as the old Map mutex)
    const existing = _memoryLocks.get(sessionId);
    if (existing) await existing;

    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    _memoryLocks.set(sessionId, promise);
    _memoryResolvers.set(sessionId, resolve);
    return true;
}

/**
 * Release the per-session lock held by this instance.
 */
export async function releaseSessionLock(sessionId: string): Promise<void> {
    if (isRedisConfigured()) {
        await getRedisPublisher().del(redisKey(sessionId));
        return;
    }

    const resolve = _memoryResolvers.get(sessionId);
    _memoryLocks.delete(sessionId);
    _memoryResolvers.delete(sessionId);
    resolve?.();
}
