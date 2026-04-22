/**
 * User Service — manages per-client (Slack/Telegram user) credentials.
 *
 * Each Pilot authenticating via Slack or Telegram has their own Cloudstick
 * account credentials stored in the `users` table.
 */

import { getPool, isDBConfigured } from '../database/db.js';
import { encrypt, decrypt } from '../utils/crypto.js';

export interface CloudclawUser {
    id: number;
    platform: 'slack' | 'telegram';
    platform_id: string;
    cloudstick_api_key: string | null;
    cloudstick_api_secret: string | null;
    cloudstick_user_id: string | null;
    ssh_private_key: string | null;
    ssh_public_key: string | null;
    setup_at: Date | null;
    updated_at: Date;
}

export async function getUserByPlatformId(
    platform: string,
    platformId: string
): Promise<CloudclawUser | null> {
    const pool = getPool();
    const { rows } = await pool.query(
        'SELECT * FROM users WHERE platform = $1 AND platform_id = $2',
        [platform, platformId]
    );
    return (rows[0] as unknown as CloudclawUser) ?? null;
}

export async function upsertUser(
    platform: string,
    platformId: string,
    data: Partial<Omit<CloudclawUser, 'id' | 'platform' | 'platform_id' | 'updated_at'>>
): Promise<CloudclawUser> {
    const pool = getPool();

    const existing = await getUserByPlatformId(platform, platformId);

    if (existing) {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (data.cloudstick_api_key !== undefined) {
            fields.push(`cloudstick_api_key = $${idx++}`);
            values.push(data.cloudstick_api_key ? encrypt(data.cloudstick_api_key) : null);
        }
        if (data.cloudstick_api_secret !== undefined) {
            fields.push(`cloudstick_api_secret = $${idx++}`);
            values.push(data.cloudstick_api_secret ? encrypt(data.cloudstick_api_secret) : null);
        }
        if (data.cloudstick_user_id !== undefined) {
            fields.push(`cloudstick_user_id = $${idx++}`);
            values.push(data.cloudstick_user_id);
        }
        if (data.ssh_private_key !== undefined) {
            fields.push(`ssh_private_key = $${idx++}`);
            values.push(data.ssh_private_key);
        }
        if (data.ssh_public_key !== undefined) {
            fields.push(`ssh_public_key = $${idx++}`);
            values.push(data.ssh_public_key);
        }
        if (data.setup_at !== undefined) {
            fields.push(`setup_at = $${idx++}`);
            values.push(data.setup_at);
        }

        fields.push(`updated_at = NOW()`);
        values.push(platform);
        values.push(platformId);

        const { rows } = await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE platform = $${idx++} AND platform_id = $${idx} RETURNING *`,
            values
        );
        return rows[0] as unknown as CloudclawUser;
    } else {
        const { rows } = await pool.query(
            `INSERT INTO users (platform, platform_id, cloudstick_api_key, cloudstick_api_secret, cloudstick_user_id, ssh_private_key, ssh_public_key, setup_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                platform,
                platformId,
                data.cloudstick_api_key ? encrypt(data.cloudstick_api_key) : null,
                data.cloudstick_api_secret ? encrypt(data.cloudstick_api_secret) : null,
                data.cloudstick_user_id ?? null,
                data.ssh_private_key ?? null,
                data.ssh_public_key ?? null,
                data.setup_at ?? null,
            ]
        );
        return rows[0] as unknown as CloudclawUser;
    }
}

export async function setUserCloudstickCredentials(
    platform: string,
    platformId: string,
    apiKey: string,
    apiSecret: string,
    userId: string
): Promise<void> {
    await upsertUser(platform, platformId, {
        cloudstick_api_key: apiKey,
        cloudstick_api_secret: apiSecret,
        cloudstick_user_id: userId,
        setup_at: new Date(),
    });
}

export async function setUserSshKey(
    platform: string,
    platformId: string,
    privateKey: string,
    publicKey: string
): Promise<void> {
    await upsertUser(platform, platformId, {
        ssh_private_key: encrypt(privateKey),
        ssh_public_key: publicKey,
    });
}

export function getDecryptedSshKey(user: CloudclawUser): string | null {
    if (!user.ssh_private_key) return null;
    return decrypt(user.ssh_private_key);
}

export function getDecryptedCloudstickCredentials(user: CloudclawUser): {
    apiKey: string | null;
    apiSecret: string | null;
} {
    try {
        return {
            apiKey: user.cloudstick_api_key ? decrypt(user.cloudstick_api_key) : null,
            apiSecret: user.cloudstick_api_secret ? decrypt(user.cloudstick_api_secret) : null,
        };
    } catch {
        // Pre-migration plaintext fallback — value will be re-encrypted on next /setup
        return {
            apiKey: user.cloudstick_api_key,
            apiSecret: user.cloudstick_api_secret,
        };
    }
}

export function hasCloudstickCredentials(user: CloudclawUser): boolean {
    return !!(
        user.cloudstick_api_key &&
        user.cloudstick_api_secret &&
        user.cloudstick_user_id
    );
}
