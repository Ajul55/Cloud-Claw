/**
 * Backfill Embeddings — One-time migration script
 *
 * Generates Voyage AI embeddings for any existing fix_memory rows
 * that have a NULL embedding column.
 *
 * Run with: npx tsx src/scripts/backfill_embeddings.ts
 */

import 'dotenv/config';
import pg from 'pg';
import { generateEmbedding, vectorToSQL } from '../utils/embeddings.js';

const { Pool } = pg;

async function backfill() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('[backfill] DATABASE_URL not set — nothing to backfill');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });

    try {
        const { rows } = await pool.query(
            `SELECT id, issue_text, fix_command FROM fix_memory WHERE embedding IS NULL`,
        );

        console.log(`[backfill] ${rows.length} fixes need embeddings`);

        if (rows.length === 0) {
            console.log('[backfill] Nothing to backfill — all done!');
            process.exit(0);
        }

        let success = 0;
        let skipped = 0;

        for (const row of rows) {
            const text = `${row.issue_text} ${row.fix_command}`;
            const embedding = await generateEmbedding(text);

            if (embedding) {
                await pool.query(
                    `UPDATE fix_memory SET embedding = $1::vector WHERE id = $2`,
                    [vectorToSQL(embedding), row.id],
                );
                console.log(`[backfill] ✅ Fix #${row.id} done`);
                success++;
            } else {
                console.warn(`[backfill] ⚠️ Fix #${row.id} skipped — embedding failed`);
                skipped++;
            }

            // Voyage free tier = 3 req/sec — respect rate limit
            await new Promise(r => setTimeout(r, 400));
        }

        console.log(`[backfill] Complete — ${success} embedded, ${skipped} skipped`);
    } catch (err) {
        console.error('[backfill] Fatal:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }

    process.exit(0);
}

backfill().catch(err => {
    console.error('[backfill] Fatal:', err);
    process.exit(1);
});
