/**
 * One-off migration: encrypt existing plaintext Cloudstick credentials.
 * Safe to run multiple times — already-encrypted values are detected and skipped.
 * Usage: npx tsx src/scripts/migrate_encrypt_cloudstick_creds.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { encrypt } from '../utils/crypto.js';

function isAlreadyEncrypted(value: string): boolean {
    // AES-256-GCM output: iv=16 bytes=32 hex chars, tag=16 bytes=32 hex chars, ciphertext >= 1 byte
    return /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]{2,}$/.test(value);
}

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL not set');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query('SELECT id, cloudstick_api_key, cloudstick_api_secret FROM users');

    let migrated = 0;
    for (const row of rows) {
        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (row.cloudstick_api_key && !isAlreadyEncrypted(row.cloudstick_api_key)) {
            updates.push(`cloudstick_api_key = $${idx++}`);
            values.push(encrypt(row.cloudstick_api_key));
        }
        if (row.cloudstick_api_secret && !isAlreadyEncrypted(row.cloudstick_api_secret)) {
            updates.push(`cloudstick_api_secret = $${idx++}`);
            values.push(encrypt(row.cloudstick_api_secret));
        }

        if (updates.length > 0) {
            values.push(row.id);
            await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
            migrated++;
            console.log(`Migrated user id=${row.id}`);
        }
    }

    console.log(`Done. Migrated ${migrated} of ${rows.length} users.`);
    await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
