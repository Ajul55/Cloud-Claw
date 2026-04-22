import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
    env: {
        ENCRYPTION_KEY: 'a'.repeat(64), // valid 64-char hex
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'gpt-4o',
        SSH_USER: 'root',
        SSH_PORT: 22,
        CLOUDSTICK_API_BASE: 'https://api.cloudstick.io',
        VOYAGE_MODEL: 'voyage-code-2',
    },
}));

import { encrypt, decrypt } from '../utils/crypto.js';

describe('Cloudstick credential encryption', () => {
    it('encrypt/decrypt round-trips correctly', () => {
        const key = 'cs_live_abc123xyz456';
        const encrypted = encrypt(key);
        expect(encrypted).not.toBe(key);
        expect(decrypt(encrypted)).toBe(key);
    });

    it('two encryptions of the same value are different (IV randomness)', () => {
        const value = 'same-secret';
        expect(encrypt(value)).not.toBe(encrypt(value));
    });

    it('decrypt of a non-encrypted value throws', () => {
        expect(() => decrypt('plaintext-not-encrypted')).toThrow();
    });
});
