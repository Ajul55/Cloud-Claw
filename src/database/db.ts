import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// ─── Singleton pool ────────────────────────────────────────────────────────────
let _pool: pg.Pool | null = null;
let _dbReady = false;

export function isDBConfigured(): boolean {
    return _dbReady;
}

export function getPool(): pg.Pool {
    if (!env.DATABASE_URL) {
        throw new Error('[DB] DATABASE_URL not configured — database operations unavailable');
    }
    if (!_pool) {
        _pool = new Pool({
            connectionString: env.DATABASE_URL,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });

        _pool.on('error', (err) => {
            console.error('[DB] Unexpected pool error:', err.message);
        });
    }
    return _pool;
}

export async function connectDB(): Promise<void> {
    if (!env.DATABASE_URL) {
        _dbReady = false;
        console.log('[DB] No DATABASE_URL configured — running without persistence');
        return;
    }

    try {
        const pool = getPool();
        const client = await pool.connect();
        client.release();
        _dbReady = true;

        try {
            // Lightweight migrations: ensure new columns exist
            await pool.query(`ALTER TABLE IF EXISTS sessions ADD COLUMN IF NOT EXISTS receipts JSONB NOT NULL DEFAULT '{}'::JSONB;`);
            await pool.query(`ALTER TABLE IF EXISTS sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;`);

            // W7: Ensure fix_memory has created_at + index for TTL cleanup
            await pool.query(`ALTER TABLE IF EXISTS fix_memory ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_fix_memory_created ON fix_memory(created_at);`);

            // Gateway migrations: ensure new columns exist on users
            await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS cloudstick_account_id TEXT UNIQUE;`);
            await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS slack_user_id TEXT UNIQUE;`);
            await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS slack_workspace_id TEXT;`);
            await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter', 'pro', 'business'));`);
            await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;`);

            // Expire approvals that were left pending for over 10 minutes.
            await pool.query(`
                UPDATE approval_queue
                SET status = 'expired', resolved_at = NOW()
                WHERE status = 'pending'
                AND requested_at < NOW() - INTERVAL '10 minutes'
            `);

            const { rows } = await pool.query<{ count: string }>(
                `SELECT COUNT(*) as count FROM approval_queue WHERE status = 'pending'`
            );
            console.log('[DB] Pending approvals on startup:', rows[0]?.count ?? '0');
        } catch (err) {
            console.warn('[DB] Approval cleanup skipped (schema not initialized yet?)');
            console.warn('[DB] Run the schema first: psql -U cloudclaw -d cloudclaw -f src/database/schema.sql');
        }

        console.log('[DB] Connected to PostgreSQL ✓');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[DB] PostgreSQL connection failed: ${msg}`);
        console.error('[DB] To set up PostgreSQL, run:');
        console.error('[DB]   1. sudo -u postgres createuser cloudclaw');
        console.error('[DB]   2. sudo -u postgres createdb -O cloudclaw cloudclaw');
        console.error('[DB]   3. psql -U cloudclaw -d cloudclaw -f src/database/schema.sql');
        console.error('[DB] Falling back to in-memory mode.');
        _dbReady = false;
        _pool = null;
    }
}

export async function closeDB(): Promise<void> {
    _dbReady = false;
    if (_pool) {
        await _pool.end();
        _pool = null;
        console.log('[DB] Pool closed');
    }
}

// ─── Typed helpers ─────────────────────────────────────────────────────────────

export interface CausalityRecord {
    id: number;
    client_id: string;
    domain: string;
    vhost_path: string | null;
    php_pool: string | null;
    db_name: string | null;
    mysql_host: string | null;
    nginx_version: string | null;
    php_version: string | null;
    extra_meta: Record<string, unknown>;
    discovered_at: Date;
    updated_at: Date;
}

let causalityIdCounter = 1;

export async function upsertCausalityRecord(
    record: Omit<CausalityRecord, 'id' | 'discovered_at' | 'updated_at'>
): Promise<CausalityRecord> {
    if (!isDBConfigured()) {
        return {
            id: causalityIdCounter++,
            ...record,
            discovered_at: new Date(),
            updated_at: new Date(),
        };
    }
    const pool = getPool();
    const { rows } = await pool.query<CausalityRecord>(
        `INSERT INTO causality_map
      (client_id, domain, vhost_path, php_pool, db_name, mysql_host, nginx_version, php_version, extra_meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (client_id, domain) DO UPDATE SET
       vhost_path    = EXCLUDED.vhost_path,
       php_pool      = EXCLUDED.php_pool,
       db_name       = EXCLUDED.db_name,
       mysql_host    = EXCLUDED.mysql_host,
       nginx_version = EXCLUDED.nginx_version,
       php_version   = EXCLUDED.php_version,
       extra_meta    = EXCLUDED.extra_meta,
       updated_at    = NOW()
     RETURNING *`,
        [
            record.client_id,
            record.domain,
            record.vhost_path,
            record.php_pool,
            record.db_name,
            record.mysql_host,
            record.nginx_version,
            record.php_version,
            JSON.stringify(record.extra_meta),
        ]
    );
    return rows[0];
}

export async function getCausalityByDomain(
    domain: string
): Promise<CausalityRecord | null> {
    const pool = getPool();
    const { rows } = await pool.query<CausalityRecord>(
        'SELECT * FROM causality_map WHERE domain = $1 LIMIT 1',
        [domain]
    );
    return rows[0] ?? null;
}

// ─── Sessions (in-memory fallback when no DB) ─────────────────────────────────

const memoryStore = new Map<string, SessionRecord>();

export interface SessionRecord {
    id: string;
    channel: string;
    user_id: string;
    reply_target: string | null;
    messages: Array<Record<string, unknown>>;
    receipts?: Record<string, unknown>;
    iteration: number;
    version: number;
    status?: string;
    created_at: Date;
    updated_at: Date;
    last_activity?: Date;
}

export async function getSession(id: string): Promise<SessionRecord | null> {
    if (!isDBConfigured()) {
        return memoryStore.get(id) ?? null;
    }
    const pool = getPool();
    const { rows } = await pool.query<SessionRecord>(
        'SELECT * FROM sessions WHERE id = $1',
        [id]
    );
    return rows[0] ?? null;
}

export async function upsertSession(
    session: Pick<SessionRecord, 'id' | 'channel' | 'user_id' | 'iteration' | 'reply_target'> & {
        messages: Array<Record<string, unknown>>;
        receipts?: Record<string, unknown>;
        expectedVersion?: number;  // if provided, use conditional UPDATE (OCC)
    }
): Promise<void> {
    if (!isDBConfigured()) {
        const existing = memoryStore.get(session.id);
        if (
            session.expectedVersion !== undefined &&
            existing &&
            existing.version !== session.expectedVersion
        ) {
            console.warn(`[DB] Session ${session.id} version conflict (expected ${session.expectedVersion}, got ${existing.version}) — skipping stale write`);
            return;
        }
        memoryStore.set(session.id, {
            ...(session as any),
            receipts: session.receipts ?? existing?.receipts ?? {},
            version: (existing?.version ?? 0) + 1,
            created_at: existing?.created_at ?? new Date(),
            updated_at: new Date(),
            last_activity: new Date(),
            status: 'active',
        });
        return;
    }

    const pool = getPool();

    if (session.expectedVersion !== undefined) {
        // OCC: conditional update — only writes if version matches
        const result = await pool.query(
            `UPDATE sessions SET
               reply_target  = $1,
               messages      = $2,
               receipts      = $3,
               iteration     = $4,
               last_activity = NOW(),
               status        = 'active',
               updated_at    = NOW(),
               version       = version + 1
             WHERE id = $5 AND version = $6`,
            [
                session.reply_target ?? null,
                JSON.stringify(session.messages),
                JSON.stringify(session.receipts ?? {}),
                session.iteration,
                session.id,
                session.expectedVersion,
            ]
        );
        if ((result.rowCount ?? 0) === 0) {
            console.warn(`[DB] Session ${session.id} version conflict (expected v${session.expectedVersion}) — skipping stale write`);
        }
    } else {
        // Blind upsert (first write / session creation)
        await pool.query(
            `INSERT INTO sessions (id, channel, user_id, reply_target, messages, receipts, iteration, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
         ON CONFLICT (id) DO UPDATE SET
           reply_target  = EXCLUDED.reply_target,
           messages      = EXCLUDED.messages,
           receipts      = EXCLUDED.receipts,
           iteration     = EXCLUDED.iteration,
           last_activity = NOW(),
           status        = 'active',
           updated_at    = NOW(),
           version       = sessions.version + 1`,
            [
                session.id,
                session.channel,
                session.user_id,
                session.reply_target ?? null,
                JSON.stringify(session.messages),
                JSON.stringify(session.receipts ?? {}),
                session.iteration,
            ]
        );
    }
}

// ─── Approval Queue ────────────────────────────────────────────────────────────

const memoryApprovals = new Map<number, ApprovalRecord>();
let approvalIdCounter = 1;

export interface ApprovalRecord {
    id: number;
    session_id: string;
    command: string;
    target_host: string;
    rationale: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    tool_call_id: string;
    requested_at: Date;
    resolved_at: Date | null;
}

export async function createApproval(
    data: Pick<ApprovalRecord, 'session_id' | 'command' | 'target_host' | 'rationale' | 'tool_call_id'>
): Promise<ApprovalRecord> {
    if (!isDBConfigured()) {
        const record: ApprovalRecord = {
            id: approvalIdCounter++,
            ...data,
            status: 'pending',
            requested_at: new Date(),
            resolved_at: null,
        };
        memoryApprovals.set(record.id, record);
        return record;
    }
    const pool = getPool();
    const { rows } = await pool.query<ApprovalRecord>(
        `INSERT INTO approval_queue (session_id, command, target_host, rationale, tool_call_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [data.session_id, data.command, data.target_host, data.rationale, data.tool_call_id]
    );
    return rows[0];
}

export async function resolveApproval(
    id: number,
    status: 'approved' | 'rejected' | 'expired'
): Promise<ApprovalRecord | null> {
    if (!isDBConfigured()) {
        const record = memoryApprovals.get(id);
        if (!record || record.status !== 'pending') return null;
        record.status = status;
        record.resolved_at = new Date();
        return record;
    }
    const pool = getPool();
    const { rows } = await pool.query<ApprovalRecord>(
        `UPDATE approval_queue
     SET status = $2, resolved_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
        [id, status]
    );
    if (rows.length === 0) {
        // If rowCount is 0, it means the approval was already handled
        // or doesn't exist. Return null to abort the duplicate run.
        return null;
    }
    return rows[0] ?? null;
}

export async function getApprovalById(id: number): Promise<ApprovalRecord | null> {
    if (!isDBConfigured()) {
        return memoryApprovals.get(id) ?? null;
    }
    const pool = getPool();
    const { rows } = await pool.query<ApprovalRecord>(
        'SELECT * FROM approval_queue WHERE id = $1',
        [id]
    );
    return rows[0] ?? null;
}

export async function updateApprovalStatus(
    id: number,
    status: 'approved' | 'rejected' | 'expired',
    _pilotUserId: string
): Promise<boolean> {
    const record = await resolveApproval(id, status);
    return record !== null;
}

export async function getLatestPendingApproval(sessionId: string): Promise<ApprovalRecord | null> {
    if (!isDBConfigured()) {
        let latest: ApprovalRecord | null = null;
        for (const rec of memoryApprovals.values()) {
            if (rec.session_id === sessionId && rec.status === 'pending') {
                if (!latest || rec.requested_at > latest.requested_at) {
                    latest = rec;
                }
            }
        }
        return latest;
    }
    const pool = getPool();
    const { rows } = await pool.query<ApprovalRecord>(
        `SELECT * FROM approval_queue
         WHERE session_id = $1 AND status = 'pending'
         ORDER BY requested_at DESC
         LIMIT 1`,
        [sessionId]
    );
    return rows[0] ?? null;
}

// ─── W7: fix_memory TTL cleanup ────────────────────────────────────────────────

/**
 * Delete fix_memory records older than the specified number of days.
 * Prevents the embeddings table from growing unbounded.
 * Called on a schedule (e.g., daily via cron or pg-boss).
 */
export async function cleanupOldFixes(maxAgeDays = 90): Promise<number> {
    if (!isDBConfigured()) return 0;

    try {
        const result = await getPool().query(
            `DELETE FROM fix_memory
             WHERE created_at < NOW() - INTERVAL '1 day' * $1
             RETURNING id`,
            [maxAgeDays]
        );
        const count = result.rowCount ?? 0;
        if (count > 0) {
            console.log(`[fix_memory] TTL cleanup: deleted ${count} records older than ${maxAgeDays} days`);
        }
        return count;
    } catch (err) {
        console.warn('[fix_memory] TTL cleanup failed (non-fatal):', err);
        return 0;
    }
}

export async function clearSession(id: string): Promise<void> {
    if (!isDBConfigured()) {
        const existing = memoryStore.get(id);
        if (existing) {
            existing.messages = [];
            existing.receipts = {};
            existing.iteration = 0;
            existing.updated_at = new Date();
        }
        for (const [appId, app] of memoryApprovals.entries()) {
            if (app.session_id === id && app.status === 'pending') {
                app.status = 'expired';
                app.resolved_at = new Date();
            }
        }
        return;
    }
    const pool = getPool();
    await pool.query(
        `UPDATE sessions SET messages = '[]'::JSONB, receipts = '{}'::JSONB, iteration = 0, updated_at = NOW() WHERE id = $1`,
        [id]
    );
    await pool.query(
        `UPDATE approval_queue SET status = 'expired', resolved_at = NOW() WHERE session_id = $1 AND status = 'pending'`,
        [id]
    );
}
