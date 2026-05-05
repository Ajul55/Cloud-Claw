/**
 * Create the initial dashboard admin account.
 *
 * Usage:
 *   npx tsx scripts/seed-admin.ts <username> <password>
 *
 * Example:
 *   npx tsx scripts/seed-admin.ts pilot S3cur3P@ss!
 */

import pg from 'pg';
import bcrypt from 'bcrypt';

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
    console.error('Usage: npx tsx scripts/seed-admin.ts <username> <password>');
    process.exit(1);
}

if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('DATABASE_URL environment variable is required.');
    process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function main() {
    await client.connect();

    const hash = await bcrypt.hash(password, 12);

    await client.query(
        `INSERT INTO dashboard_admins (username, password_hash, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash`,
        [username, hash]
    );

    console.log(`Admin "${username}" created/updated.`);
    await client.end();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
