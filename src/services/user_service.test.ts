import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };

vi.mock('../database/db.js', () => ({
    isDBConfigured: vi.fn(() => true),
    getPool: vi.fn(() => mockPool),
}));

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
import {
    getDecryptedCloudstickCredentials,
    getUserByCloudstickAccountId,
    upsertCloudstickUser,
    getUserBySlackUserId,
    linkSlackToCloudstickUser,
} from './user_service.js';

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
            cloudstick_account_id: null, plan_tier: null,
            plan_updated_at: null, slack_user_id: null, slack_workspace_id: null,
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
            cloudstick_account_id: null, plan_tier: null,
            plan_updated_at: null, slack_user_id: null, slack_workspace_id: null,
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
            cloudstick_account_id: null, plan_tier: null,
            plan_updated_at: null, slack_user_id: null, slack_workspace_id: null,
        };
        const { apiKey, apiSecret } = getDecryptedCloudstickCredentials(user);
        expect(apiKey).toBeNull();
        expect(apiSecret).toBeNull();
    });
});

const fakeUser = {
    id: 1, platform: 'cloudstick' as const, platform_id: 'acc_123',
    cloudstick_account_id: 'acc_123', plan_tier: 'pro',
    plan_updated_at: new Date(), slack_user_id: null,
    slack_workspace_id: null, cloudstick_api_key: null,
    cloudstick_api_secret: null, cloudstick_user_id: null,
    ssh_private_key: null, ssh_public_key: null,
    setup_at: null, updated_at: new Date(),
};

beforeEach(() => { mockPool.query.mockReset(); });

describe('getUserByCloudstickAccountId', () => {
    it('returns user when found', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [fakeUser] });
        const result = await getUserByCloudstickAccountId('acc_123');
        expect(result).toEqual(fakeUser);
        expect(mockPool.query).toHaveBeenCalledWith(
            expect.stringContaining('cloudstick_account_id'),
            ['acc_123']
        );
    });

    it('returns null when not found', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        const result = await getUserByCloudstickAccountId('unknown');
        expect(result).toBeNull();
    });
});

describe('upsertCloudstickUser', () => {
    it('returns the upserted row', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [fakeUser] });
        const result = await upsertCloudstickUser('acc_123', 'pro');
        expect(result.cloudstick_account_id).toBe('acc_123');
        expect(result.plan_tier).toBe('pro');
    });
});

describe('getUserBySlackUserId', () => {
    it('returns user linked to that Slack ID', async () => {
        const withSlack = { ...fakeUser, slack_user_id: 'U12345' };
        mockPool.query.mockResolvedValueOnce({ rows: [withSlack] });
        const result = await getUserBySlackUserId('U12345');
        expect(result?.slack_user_id).toBe('U12345');
    });

    it('returns null when no user is linked', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        const result = await getUserBySlackUserId('U_nobody');
        expect(result).toBeNull();
    });
});

describe('linkSlackToCloudstickUser', () => {
    it('calls UPDATE with correct params', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        await linkSlackToCloudstickUser('acc_123', 'U12345', 'T09876');
        expect(mockPool.query).toHaveBeenCalledWith(
            expect.stringContaining('slack_user_id'),
            ['acc_123', 'U12345', 'T09876']
        );
    });
});
