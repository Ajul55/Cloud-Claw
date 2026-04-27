/**
 * AES-256-GCM encryption for sensitive data at rest.
 * Used to encrypt SSH private keys stored in the users table.
 */

import { createCipheriv, createDecipheriv, createVerify, randomBytes } from 'crypto';
import { env } from '../config/env.js';

/** Decode a base64url-encoded string (JWT uses base64url, not standard base64). */
function base64urlDecode(str: string): Buffer {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

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
 * Decode the user_id from a Cloudstick API secret JWT and verify its signature.
 *
 * When CLOUDSTICK_JWT_PUBLIC_KEY is set (PEM-format EC public key), the ES256
 * signature is verified using the P-256 curve before trusting the payload.
 * A forged or tampered token will throw rather than return a user_id.
 *
 * When the key is not set, the payload is decoded with a startup warning — this
 * maintains backward compatibility but leaves token forgery possible. Set the key
 * in production to close this gap.
 *
 * @returns The numeric user_id from the verified JWT payload
 * @throws Error if the token is malformed, missing user_id, or signature invalid
 */
export function decodeCloudstickJwtUserId(jwtSecret: string): string {
    const parts = jwtSecret.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid Cloudstick API secret format — expected a JWT');
    }

    const [header, payload, signature] = parts;

    const publicKeyPem = env.CLOUDSTICK_JWT_PUBLIC_KEY;
    if (publicKeyPem) {
        let valid = false;
        try {
            const verifier = createVerify('SHA256');
            verifier.update(`${header}.${payload}`);
            // JWT ES256 uses IEEE P1363 encoding (raw R||S), not DER
            valid = verifier.verify(
                { key: publicKeyPem, dsaEncoding: 'ieee-p1363' },
                base64urlDecode(signature),
            );
        } catch (err) {
            throw new Error(
                `Cloudstick JWT signature verification error: ${err instanceof Error ? err.message : String(err)}`
            );
        }
        if (!valid) {
            throw new Error('Cloudstick JWT signature verification failed — token may be forged or tampered');
        }
    } else {
        console.warn(
            '[crypto] CLOUDSTICK_JWT_PUBLIC_KEY not set — JWT signature not verified. ' +
            'Set this in .env to prevent token forgery during /setup.'
        );
    }

    try {
        const decoded = Buffer.from(payload, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded) as { user_id?: number; [key: string]: unknown };
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
