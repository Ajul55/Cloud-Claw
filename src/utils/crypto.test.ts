import { describe, expect, it, beforeEach } from 'vitest';
import { encrypt, decrypt, decodeCloudstickJwtUserId } from './crypto.js';
import { env } from '../config/env.js';

// These tests need ENCRYPTION_KEY set
const ENCRYPTION_KEY = env.ENCRYPTION_KEY;

describe('crypto utilities', () => {
    describe('encrypt / decrypt', () => {
        it('round-trips a plaintext string', () => {
            if (!ENCRYPTION_KEY) return; // Skip if no key configured
            const original = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----';
            const encrypted = encrypt(original);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(original);
        });

        it('produces different ciphertexts for same plaintext (random IV)', () => {
            if (!ENCRYPTION_KEY) return;
            const plaintext = 'same text';
            const a = encrypt(plaintext);
            const b = encrypt(plaintext);
            expect(a).not.toBe(b); // Different IVs
            expect(decrypt(a)).toBe(plaintext);
            expect(decrypt(b)).toBe(plaintext);
        });

        it('throws on tampered ciphertext', () => {
            if (!ENCRYPTION_KEY) return;
            const encrypted = encrypt('test');
            const [iv, tag, ct] = encrypted.split(':');
            const tampered = `${iv}:${tag}:${ct.replace(/^../, '00')}`;
            expect(() => decrypt(tampered)).toThrow();
        });
    });

    describe('decodeCloudstickJwtUserId', () => {
        it('extracts user_id from a valid JWT payload', () => {
            // Reconstruct a real-looking JWT: header.payload.signature
            const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64');
            const payload = Buffer.from(JSON.stringify({ user_id: 42, plan_id: 1, role: 'customer' })).toString('base64');
            const signature = 'dummy_signature';
            const jwt = `${header}.${payload}.${signature}`;

            expect(decodeCloudstickJwtUserId(jwt)).toBe('42');
        });

        it('extracts user_id from your actual env JWT (user_id=48)', () => {
            const secret = env.CLOUDSTICK_API_SECRET;
            if (!secret) return; // Skip if no secret configured
            expect(decodeCloudstickJwtUserId(secret)).toBe('48');
        });

        it('throws for a token without user_id in payload', () => {
            const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64');
            const payload = Buffer.from(JSON.stringify({ plan_id: 1, role: 'customer' })).toString('base64');
            const signature = 'dummy_signature';
            const jwt = `${header}.${payload}.${signature}`;

            expect(() => decodeCloudstickJwtUserId(jwt)).toThrow('missing user_id');
        });

        it('throws for a malformed token (not 3 parts)', () => {
            expect(() => decodeCloudstickJwtUserId('not-a-jwt')).toThrow('Invalid Cloudstick API secret format');
            expect(() => decodeCloudstickJwtUserId('a.b')).toThrow('Invalid Cloudstick API secret format');
        });

        it('throws for a malformed base64 payload', () => {
            // Valid 3-part structure but payload is not valid base64
            expect(() => decodeCloudstickJwtUserId('header.!!!signature')).toThrow('Invalid Cloudstick API secret format');
        });
    });
});
