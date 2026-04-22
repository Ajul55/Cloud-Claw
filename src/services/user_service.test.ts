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
import { getDecryptedCloudstickCredentials } from './user_service.js';

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

describe('getDecryptedCloudstickCredentials', () => {
    it('decrypts an encrypted API key correctly', () => {
        const encrypted = encrypt('cs_live_abc123');
        const user = {
            id: 1, platform: 'slack' as const, platform_id: 'U123',
            cloudstick_api_key: encrypted,
            cloudstick_api_secret: null,
            cloudstick_user_id: '42',
            ssh_private_key: null, ssh_public_key: null,
            setup_at: null, updated_at: new Date(),
        };
        const { apiKey, apiSecret } = getDecryptedCloudstickCredentials(user);
        expect(apiKey).toBe('cs_live_abc123');
        expect(apiSecret).toBeNull();
    });

    it('falls back to plaintext when value is not encrypted (pre-migration)', () => {
        const user = {
            id: 2, platform: 'slack' as const, platform_id: 'U456',
            cloudstick_api_key: 'plaintext-key',
            cloudstick_api_secret: 'plaintext-secret',
            cloudstick_user_id: '42',
            ssh_private_key: null, ssh_public_key: null,
            setup_at: null, updated_at: new Date(),
        };
        const { apiKey, apiSecret } = getDecryptedCloudstickCredentials(user);
        expect(apiKey).toBe('plaintext-key');
        expect(apiSecret).toBe('plaintext-secret');
    });

    it('returns null for null credential fields', () => {
        const user = {
            id: 3, platform: 'telegram' as const, platform_id: '789',
            cloudstick_api_key: null,
            cloudstick_api_secret: null,
            cloudstick_user_id: null,
            ssh_private_key: null, ssh_public_key: null,
            setup_at: null, updated_at: new Date(),
        };
        const { apiKey, apiSecret } = getDecryptedCloudstickCredentials(user);
        expect(apiKey).toBeNull();
        expect(apiSecret).toBeNull();
    });
});
