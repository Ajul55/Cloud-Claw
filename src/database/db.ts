import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// ─── Singleton pool ────────────────────────────────────────────────────────────
let _pool: pg.Pool | null = null;
// Single-process assumption: _dbReady is in-process state.
// In a multi-process (cluster) or multi-instance deployment, each process
// maintains its own flag. Redis-backed readiness would be needed for
// true cross-process coordination (Phase 3).
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

    let lastConnectError: Error | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const pool = getPool();
            const client = await pool.connect();
            client.release();
            _dbReady = true;
            lastConnectError = undefined;
            break;
        } catch (err) {
            lastConnectError = err instanceof Error ? err : new Error(String(err));
            if (attempt < 3) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[DB] Connection attempt ${attempt}/3 failed, retrying in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    if (lastConnectError) {
        const msg = lastConnectError.message;
        console.error(`[DB] PostgreSQL connection failed after 3 attempts: ${msg}`);
        console.error('[DB] To set up PostgreSQL, run:');
        console.error('[DB]   1. sudo -u postgres createuser cloudclaw');
        console.error('[DB]   2. sudo -u postgres createdb -O cloudclaw cloudclaw');
        console.error('[DB]   3. psql -U cloudclaw -d cloudclaw -f src/database/schema.sql');
        console.error('[DB] Falling back to in-memory mode.');
        _dbReady = false;
        _pool = null;
        return;
    }

    // FIX: Acquire advisory lock so only one PM2 cluster worker runs migrations at startup.
    // Lock ID 42 is arbitrary but stable — all workers compete for the same lock.
    const pool = getPool();
    try {
        const migrationClient = await pool.connect();
            try {
                await migrationClient.query('SELECT pg_advisory_lock(42)');

                // Lightweight migrations: ensure new columns exist
                await migrationClient.query(`ALTER TABLE IF EXISTS sessions ADD COLUMN IF NOT EXISTS receipts JSONB NOT NULL DEFAULT '{}'::JSONB;`);
                await migrationClient.query(`ALTER TABLE IF EXISTS sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;`);

                // W7: Ensure fix_memory has created_at + index for TTL cleanup
                await migrationClient.query(`ALTER TABLE IF EXISTS fix_memory ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`);
                await migrationClient.query(`CREATE INDEX IF NOT EXISTS idx_fix_memory_created ON fix_memory(created_at);`);

                // Gateway migrations: ensure new columns exist on users
                await migrationClient.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS cloudstick_account_id TEXT UNIQUE;`);
                await migrationClient.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS slack_user_id TEXT UNIQUE;`);
                await migrationClient.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS slack_workspace_id TEXT;`);
                await migrationClient.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter', 'pro', 'business'));`);
                await migrationClient.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;`);

                // HIGH-8: Store Slack message info on approval so expiry job can update the card
                await migrationClient.query(`ALTER TABLE IF EXISTS approval_queue ADD COLUMN IF NOT EXISTS slack_channel TEXT;`);
                await migrationClient.query(`ALTER TABLE IF EXISTS approval_queue ADD COLUMN IF NOT EXISTS slack_message_ts TEXT;`);

                // Agent trace event log
                await migrationClient.query(`
                  CREATE TABLE IF NOT EXISTS agent_events (
                    id                SERIAL PRIMARY KEY,
                    session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    iteration         INTEGER NOT NULL DEFAULT 0,
                    event_type        TEXT NOT NULL,
                    tool_name         TEXT,
                    args              JSONB,
                    result_summary    TEXT,
                    duration_ms       INTEGER,
                    success           BOOLEAN,
                    input_tokens      INTEGER,
                    output_tokens     INTEGER,
                    cache_read_tokens INTEGER,
                    finish_reason     TEXT,
                    timestamp         TIMESTAMPTZ NOT NULL DEFAULT now()
                  );
                `);
                await migrationClient.query(`CREATE INDEX IF NOT EXISTS agent_events_session_id_idx ON agent_events(session_id);`);
                await migrationClient.query(`CREATE INDEX IF NOT EXISTS agent_events_timestamp_idx ON agent_events(timestamp DESC);`);

                // Usage log: ensure account_id column exists for multi-tenant tracking
                await migrationClient.query(`ALTER TABLE IF EXISTS usage_log ADD COLUMN IF NOT EXISTS account_id TEXT;`);

                // ARCH-5: Dynamic Tool Registry
                await migrationClient.query(`
                  CREATE TABLE IF NOT EXISTS tools (
                    id          TEXT        PRIMARY KEY,
                    name        TEXT        NOT NULL,
                    description TEXT,
                    schema      JSONB,
                    tier        INTEGER     DEFAULT 1,
                    enabled     BOOLEAN     DEFAULT true,
                    tenant_id   UUID        REFERENCES accounts(id) ON DELETE CASCADE
                  );
                `);
                await migrationClient.query(`CREATE INDEX IF NOT EXISTS idx_tools_tenant ON tools (tenant_id);`);
                await migrationClient.query(`CREATE INDEX IF NOT EXISTS idx_tools_enabled ON tools (enabled);`);

                await migrationClient.query('SELECT pg_advisory_unlock(42)');
            } finally {
                migrationClient.release();
            }

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
        'SELECT * FROM sessions WHERE id = $1 LIMIT 1',
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

    // CRIT-8: Cap messages JSONB at 50KB to prevent unbounded growth
    const MAX_MESSAGES_BYTES = 50_000;
    let messagesToStore = session.messages;
    let messagesJson = JSON.stringify(messagesToStore);
    if (messagesJson.length > MAX_MESSAGES_BYTES) {
        // Trim from the front (oldest messages) until we're under the cap
        while (messagesToStore.length > 5 && messagesJson.length > MAX_MESSAGES_BYTES) {
            messagesToStore = messagesToStore.slice(1);
            messagesJson = JSON.stringify(messagesToStore);
        }
        console.warn(`[DB] Session ${session.id} messages trimmed to ${messagesToStore.length} msgs (>50KB)`);
    }

    const pool = getPool();

    if (session.expectedVersion !== undefined && session.expectedVersion > 0) {
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
                messagesJson,
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
                messagesJson,
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
    // HIGH-8: Slack card coordinates for updating the message on expiry
    slack_channel?: string | null;
    slack_message_ts?: string | null;
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

/**
 * MED-9: Atomically update approval status AND save session in a single transaction.
 * Prevents split-brain if the process crashes between the two operations.
 */
export async function resolveApprovalAndSaveSession(
    approvalId: number,
    status: 'approved' | 'rejected',
    session: Pick<SessionRecord, 'id' | 'channel' | 'user_id' | 'iteration' | 'reply_target'> & {
        messages: Array<Record<string, unknown>>;
        receipts?: Record<string, unknown>;
        expectedVersion?: number;
    }
): Promise<boolean> {
    if (!isDBConfigured()) {
        // In-memory mode — no transaction needed, just do both
        const approvalOk = await resolveApproval(approvalId, status);
        if (!approvalOk) return false;
        await upsertSession(session);
        return true;
    }

    // CRIT-8 cap
    const MAX_MESSAGES_BYTES = 50_000;
    let messagesToStore = session.messages;
    let messagesJson = JSON.stringify(messagesToStore);
    if (messagesJson.length > MAX_MESSAGES_BYTES) {
        while (messagesToStore.length > 5 && messagesJson.length > MAX_MESSAGES_BYTES) {
            messagesToStore = messagesToStore.slice(1);
            messagesJson = JSON.stringify(messagesToStore);
        }
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Resolve approval atomically
        const { rows } = await client.query<ApprovalRecord>(
            `UPDATE approval_queue
             SET status = $2, resolved_at = NOW()
             WHERE id = $1 AND status = 'pending'
             RETURNING *`,
            [approvalId, status]
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return false; // already handled
        }

        // 2. Save session
        if (session.expectedVersion !== undefined && session.expectedVersion > 0) {
            await client.query(
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
                    messagesJson,
                    JSON.stringify(session.receipts ?? {}),
                    session.iteration,
                    session.id,
                    session.expectedVersion,
                ]
            );
        } else {
            await client.query(
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
                    messagesJson,
                    JSON.stringify(session.receipts ?? {}),
                    session.iteration,
                ]
            );
        }

        await client.query('COMMIT');
        return true;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/** HIGH-8: Store the Slack channel + message_ts on an approval so it can be updated on expiry. */
export async function updateApprovalSlackInfo(id: number, channel: string, ts: string): Promise<void> {
    if (!isDBConfigured()) {
        const r = memoryApprovals.get(id);
        if (r) { r.slack_channel = channel; r.slack_message_ts = ts; }
        return;
    }
    await getPool().query(
        'UPDATE approval_queue SET slack_channel = $1, slack_message_ts = $2 WHERE id = $3',
        [channel, ts, id]
    );
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

// ─── Agent Event Trace ─────────────────────────────────────────────────────────

export interface AgentEvent {
    id: number;
    session_id: string;
    iteration: number;
    event_type: string;
    tool_name: string | null;
    args: Record<string, unknown> | null;
    result_summary: string | null;
    duration_ms: number | null;
    success: boolean | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    finish_reason: string | null;
    timestamp: Date;
}

export async function insertAgentEvent(event: Omit<AgentEvent, 'id'>): Promise<void> {
    if (!isDBConfigured()) return;
    try {
        await getPool().query(
            `INSERT INTO agent_events
               (session_id, iteration, event_type, tool_name, args, result_summary,
                duration_ms, success, input_tokens, output_tokens, cache_read_tokens,
                finish_reason, timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
                event.session_id,
                event.iteration,
                event.event_type,
                event.tool_name ?? null,
                event.args ? JSON.stringify(event.args) : null,
                event.result_summary ?? null,
                event.duration_ms ?? null,
                event.success ?? null,
                event.input_tokens ?? null,
                event.output_tokens ?? null,
                event.cache_read_tokens ?? null,
                event.finish_reason ?? null,
                event.timestamp,
            ]
        );
    } catch (err) {
        // Non-fatal — tracing must never break the main flow
        console.warn('[db] insertAgentEvent failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
}

export async function getSessionTrace(sessionId: string): Promise<{
    events: AgentEvent[];
    messages: unknown[];
}> {
    if (!isDBConfigured()) return { events: [], messages: [] };
    const pool = getPool();
    const [eventsResult, sessionResult] = await Promise.all([
        pool.query<AgentEvent>(
            `SELECT * FROM agent_events WHERE session_id = $1 ORDER BY timestamp ASC`,
            [sessionId]
        ),
        pool.query<{ messages: unknown[] }>(
            `SELECT messages FROM sessions WHERE id = $1 LIMIT 1`,
            [sessionId]
        ),
    ]);
    return {
        events: eventsResult.rows,
        messages: (sessionResult.rows[0]?.messages as unknown[]) ?? [],
    };
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
