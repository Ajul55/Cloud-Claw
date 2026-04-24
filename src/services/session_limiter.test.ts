import { describe, it, expect, beforeEach } from 'vitest';
import {
    acquireSession,
    releaseSession,
    getTotalActiveSessions,
    getActiveSessions,
} from './session_limiter.js';

describe('getTotalActiveSessions', () => {
    beforeEach(() => {
        // Release any lingering sessions between tests
        while (getActiveSessions('acc-a') > 0) releaseSession('acc-a');
        while (getActiveSessions('acc-b') > 0) releaseSession('acc-b');
    });

    it('returns 0 when no sessions are active', () => {
        expect(getTotalActiveSessions()).toBe(0);
    });

    it('sums sessions across multiple accounts', () => {
        acquireSession('acc-a', 'pro');   // pro allows 3
        acquireSession('acc-a', 'pro');
        acquireSession('acc-b', 'starter');
        expect(getTotalActiveSessions()).toBe(3);
        releaseSession('acc-a');
        releaseSession('acc-a');
        releaseSession('acc-b');
    });
});
