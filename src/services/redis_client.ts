import { Redis } from 'ioredis';
import { logger } from '../telemetry/logger.js';

let _publisher: Redis | null = null;

/**
 * Returns true if REDIS_URL is set — Redis features are active.
 * When false, callers fall back to in-memory behaviour.
 */
export function isRedisConfigured(): boolean {
    return !!process.env.REDIS_URL;
}

/**
 * Shared publisher/command client. Lazily created on first use.
 * One connection is reused for all non-subscribe commands.
 */
export function getRedisPublisher(): Redis {
    if (!_publisher) {
        _publisher = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false });
        _publisher.on('error', (err: Error) => {
            logger.error('redis_error', err, { module: 'redis_client', role: 'publisher' });
        });
    }
    return _publisher;
}

/**
 * Create a dedicated subscriber connection.
 * Each SSE stream gets its own subscriber so unsubscribe is clean.
 * Caller is responsible for calling .disconnect() when done.
 */
export function createRedisSubscriber(): Redis {
    const sub = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false });
    sub.on('error', (err: Error) => {
        logger.error('redis_error', err, { module: 'redis_client', role: 'subscriber' });
    });
    return sub;
}

export async function closeRedis(): Promise<void> {
    if (_publisher) {
        try { await _publisher.quit(); } catch { /* best effort on shutdown */ }
        _publisher = null;
    }
}
