import { describe, it, expect, beforeEach } from 'vitest';
import {
    acquireSession,
    releaseSession,
    getTotalActiveSessions,
    getActiveSessions,
} from './session_limiter.js';

// Tests use in-memory fallback (REDIS_URL is not set in test env)

describe('getTotalActiveSessions', () => {
    beforeEach(async () => {
        // Release any lingering sessions between tests
        while (await getActiveSessions('acc-a') > 0) await releaseSession('acc-a');
        while (await getActiveSessions('acc-b') > 0) await releaseSession('acc-b');
    });

    it('returns 0 when no sessions are active', async () => {
        expect(await getTotalActiveSessions()).toBe(0);
    });

    it('sums sessions across multiple accounts', async () => {
        await acquireSession('acc-a', 'pro');   // pro allows 3
        await acquireSession('acc-a', 'pro');
        await acquireSession('acc-b', 'starter');
        expect(await getTotalActiveSessions()).toBe(3);
        await releaseSession('acc-a');
        await releaseSession('acc-a');
        await releaseSession('acc-b');
    });
});
