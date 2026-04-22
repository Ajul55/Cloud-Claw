import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal mocks to avoid real SSH
vi.mock('../config/env.js', () => ({
    env: { SSH_USER: 'root', SSH_PORT: 22, ENCRYPTION_KEY: undefined, LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-4o', CLOUDSTICK_API_BASE: 'https://api.cloudstick.io', VOYAGE_MODEL: 'voyage-code-2' },
}));
vi.mock('../services/user_service.js', () => ({ getUserByPlatformId: vi.fn(), getDecryptedSshKey: vi.fn(), getDecryptedCloudstickCredentials: vi.fn() }));
vi.mock('../api/cloudstick_context.js', () => ({ getCloudstickUser: vi.fn(() => null) }));
vi.mock('../security/ssh_ca.js', () => ({ isSSHCAConfigured: vi.fn(() => false), getSignedCert: vi.fn(), readCertificate: vi.fn() }));

describe('SSH pool — iterative wait does not overflow', () => {
    it('fails gracefully (no RangeError) when pool is saturated', async () => {
        // Import after mocks
        const { sshExec } = await import('./ssh.js');

        // Fire 50 concurrent calls — all will fail (no real SSH) but none should RangeError
        const calls = Array.from({ length: 50 }, () =>
            sshExec('127.0.0.1', 'echo test', { retries: 1, timeoutMs: 200 }).catch(err => err.message)
        );
        const results = await Promise.all(calls);

        // None should be a RangeError
        const rangeErrors = results.filter(r => typeof r === 'string' && r.includes('Maximum call stack'));
        expect(rangeErrors).toHaveLength(0);

        // All should be some form of error (SSH failed, timeout, or pool exhausted)
        expect(results.every(r => typeof r === 'string')).toBe(true);
    }, 10_000);
});
