import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// ─── Singleton pool ────────────────────────────────────────────────────────────
let _pool: pg.Pool | null = null;

export function isDBConfigured(): boolean {
    return !!env.DATABASE_URL;
}

export function getPool(): pg.Pool {
    if (!isDBConfigured()) {
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
    if (!isDBConfigured()) {
        console.log('[DB] No DATABASE_URL configured — running without persistence');
        return;
    }

    try {
        const pool = getPool();
        const client = await pool.connect();
        client.release();

        try {
            // Expire approvals that were left pending for over 1 hour.
            await pool.query(`
                UPDATE approval_queue
                SET status = 'expired'
                WHERE status = 'pending'
                AND requested_at < NOW() - INTERVAL '1 hour'
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
        // Reset pool so isDBConfigured()-guarded code falls back to in-memory
        _pool = null;
    }
}

export async function closeDB(): Promise<void> {
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
    messages: Array<Record<string, unknown>>;
    iteration: number;
    created_at: Date;
    updated_at: Date;
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
    session: Pick<SessionRecord, 'id' | 'channel' | 'user_id' | 'iteration'> & {
        messages: Array<Record<string, unknown>>;
    }
): Promise<void> {
    if (!isDBConfigured()) {
        memoryStore.set(session.id, {
            ...(session as any),
            created_at: memoryStore.get(session.id)?.created_at ?? new Date(),
            updated_at: new Date(),
        });
        return;
    }
    const pool = getPool();
    await pool.query(
        `INSERT INTO sessions (id, channel, user_id, messages, iteration)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       messages   = EXCLUDED.messages,
       iteration  = EXCLUDED.iteration,
       updated_at = NOW()`,
        [session.id, session.channel, session.user_id, JSON.stringify(session.messages), session.iteration]
    );
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
    status: 'approved' | 'rejected'
): Promise<ApprovalRecord | null> {
    if (!isDBConfigured()) {
        const record = memoryApprovals.get(id);
        if (!record) return null;
        record.status = status;
        record.resolved_at = new Date();
        return record;
    }
    const pool = getPool();
    const { rows } = await pool.query<ApprovalRecord>(
        `UPDATE approval_queue
     SET status = $2, resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
        [id, status]
    );
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
    status: 'approved' | 'rejected',
    _pilotUserId: string
): Promise<void> {
    await resolveApproval(id, status);
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
