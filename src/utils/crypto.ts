/**
 * AES-256-GCM encryption for sensitive data at rest.
 * Used to encrypt SSH private keys stored in the users table.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env.js';

const CIPHER = 'aes-256-gcm';

function getKey(): Buffer {
    const key = env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY is not set in environment — add it to .env (32-byte hex string)');
    }
    if (key.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(key, 'hex');
}

/**
 * Encrypt plaintext. Returns: iv_hex:tag_hex:ciphertext_hex
 */
export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(CIPHER, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decode the user_id from a Cloudstick API secret JWT.
 * The JWT payload looks like: {"user_id":48,"plan_id":1,"role":"customer",...}
 * We decode without verifying the signature — the API server handles that.
 *
 * @returns The numeric user_id from the JWT payload
 * @throws Error if the token is malformed or missing user_id
 */
export function decodeCloudstickJwtUserId(jwtSecret: string): string {
    const parts = jwtSecret.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid Cloudstick API secret format — expected a JWT');
    }
    try {
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        const parsed = JSON.parse(payload) as { user_id?: number; [key: string]: unknown };
        if (!parsed.user_id) {
            throw new Error('Cloudstick API secret is missing user_id in JWT payload');
        }
        return String(parsed.user_id);
    } catch (err) {
        if (err instanceof SyntaxError) {
            throw new Error('Invalid Cloudstick API secret — could not decode JWT payload');
        }
        throw err;
    }
}

/**
 * Decrypt a ciphertext produced by encrypt().
 */
export function decrypt(ciphertext: string): string {
    const key = getKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid ciphertext format');
    }
    const [ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv(CIPHER, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
