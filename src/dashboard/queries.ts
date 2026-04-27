import { getDashboardPool } from './pool.js';
import { getTotalActiveSessions } from '../services/session_limiter.js';
import { getConsecutiveLlmFailures } from '../telemetry/llm_health.js';

export type Range = '24h' | '7d' | '30d';
export type BurnRange = '7d' | '14d' | '30d';

export interface StatsResult {
    range: Range;
    totals: { tokens: number; costUsd: number; llmCalls: number; pendingHitl: number };
    burnRate: { bucket: string; tokens: number }[];
    topTools: { toolName: string; count: number }[];
    laneSplit: { lane: 1 | 2 | 3; label: 'API' | 'SSH Read' | 'SSH Write'; count: number }[];
    recentSessions: {
        sessionId: string;
        platform: 'slack' | 'telegram';
        tokensTotal: number;
        costUsd: number;
        toolCount: number;
        topLane: 1 | 2 | 3;
        createdAt: string;
    }[];
    system: {
        activeSessions: number;
        memoryMb: number;
        uptimeSeconds: number;
        llmConsecutiveErrors: number;
    };
}

const RANGE_INTERVAL: Record<Range, string> = {
    '24h': '24 hours',
    '7d':  '7 days',
    '30d': '30 days',
};

const LANE1_TOOLS = [
    'create_system_user', 'delete_system_user', 'change_system_user_password',
    'create_database_user', 'delete_database_user', 'change_database_user_password',
    'create_database', 'delete_database', 'issue_ssl', 'renew_ssl_api', 'delete_ssl',
    'update_ssl_settings', 'switch_php_api',
];

const LANE3_TOOLS = [
    'execute_ssh_write', 'fix_nginx_config', 'fix_wordpress', 'renew_ssl',
    'manage_php', 'repair_mysql', 'cleanup_disk', 'create_nginx_vhost',
    'cloudflare_cache_purge', 'emergency_service_restart',
];

function laneCase(): string {
    const l1 = LANE1_TOOLS.map(t => `'${t}'`).join(',');
    const l3 = LANE3_TOOLS.map(t => `'${t}'`).join(',');
    return `CASE WHEN tool_name IN (${l1}) THEN 1 WHEN tool_name IN (${l3}) THEN 3 ELSE 2 END`;
}

const LANE_LABELS: Record<number, 'API' | 'SSH Read' | 'SSH Write'> = {
    1: 'API',
    2: 'SSH Read',
    3: 'SSH Write',
};

export interface SessionRow {
    id: string;
    channel: string;
    userId: string;
    status: string;
    iteration: number;
    problemClass: string | null;
    createdAt: string;
    updatedAt: string;
    lastActivity: string | null;
}

export interface ServerRow {
    id: number;
    label: string;
    ip: string;
    sshUser: string;
    sshPort: number;
    active: boolean;
    addedAt: string;
}

export interface ApprovalRow {
    id: number;
    sessionId: string;
    command: string;
    targetHost: string;
    rationale: string | null;
    status: string;
    requestedAt: string;
    resolvedAt: string | null;
}

export interface ToolsResult {
    tools: { toolName: string; count: number; lane: 1 | 2 | 3 }[];
    totalCalls: number;
}

export async function fetchSessions(limit = 50): Promise<SessionRow[]> {
    const pool = getDashboardPool();
    const res = await pool.query(
        `SELECT id, channel, user_id, status, iteration, problem_class,
                created_at, updated_at, last_activity
         FROM sessions
         ORDER BY COALESCE(last_activity, updated_at) DESC
         LIMIT $1`,
        [limit],
    );
    return res.rows.map(r => ({
        id:           r.id as string,
        channel:      r.channel as string,
        userId:       r.user_id as string,
        status:       r.status as string,
        iteration:    Number(r.iteration),
        problemClass: r.problem_class as string | null,
        createdAt:    new Date(r.created_at).toISOString(),
        updatedAt:    new Date(r.updated_at).toISOString(),
        lastActivity: r.last_activity ? new Date(r.last_activity).toISOString() : null,
    }));
}

export async function fetchServers(): Promise<ServerRow[]> {
    const pool = getDashboardPool();
    const res = await pool.query(
        `SELECT id, label, ip, ssh_user, ssh_port, active, added_at
         FROM servers
         ORDER BY id ASC`,
    );
    return res.rows.map(r => ({
        id:       Number(r.id),
        label:    r.label as string,
        ip:       r.ip as string,
        sshUser:  r.ssh_user as string,
        sshPort:  Number(r.ssh_port),
        active:   r.active as boolean,
        addedAt:  new Date(r.added_at).toISOString(),
    }));
}

export async function fetchApprovals(status?: string): Promise<ApprovalRow[]> {
    const pool = getDashboardPool();
    const where = status ? `WHERE status = $1` : '';
    const params = status ? [status] : [];
    const res = await pool.query(
        `SELECT id, session_id, command, target_host, rationale, status,
                requested_at, resolved_at
         FROM approval_queue
         ${where}
         ORDER BY requested_at DESC
         LIMIT 100`,
        params,
    );
    return res.rows.map(r => ({
        id:          Number(r.id),
        sessionId:   r.session_id as string,
        command:     r.command as string,
        targetHost:  r.target_host as string,
        rationale:   r.rationale as string | null,
        status:      r.status as string,
        requestedAt: new Date(r.requested_at).toISOString(),
        resolvedAt:  r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    }));
}

export async function fetchTools(range: Range): Promise<ToolsResult> {
    const pool = getDashboardPool();
    const interval = RANGE_INTERVAL[range];
    const res = await pool.query(
        `SELECT tool_name, COUNT(*) AS count, ${laneCase()} AS lane
         FROM usage_log
         WHERE created_at >= NOW() - $1::interval
           AND tool_name IS NOT NULL
         GROUP BY tool_name, lane
         ORDER BY count DESC
         LIMIT 50`,
        [interval],
    );
    const tools = res.rows.map(r => ({
        toolName: r.tool_name as string,
        count:    Number(r.count),
        lane:     Number(r.lane) as 1 | 2 | 3,
    }));
    return { tools, totalCalls: tools.reduce((s, t) => s + t.count, 0) };
}

export async function fetchStats(range: Range): Promise<StatsResult> {
    const pool = getDashboardPool();
    const interval = RANGE_INTERVAL[range];
    const bucket = range === '24h' ? 'hour' : 'day';

    const [totalsRes, hitlRes, burnRes, toolsRes, laneRes, sessionsRes] = await Promise.all([
        pool.query(
            `SELECT
               COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
               COALESCE(SUM(cost_usd), 0)               AS cost_usd,
               COUNT(*)                                  AS llm_calls
             FROM usage_log
             WHERE created_at >= NOW() - $1::interval`,
            [interval],
        ),
        pool.query(
            `SELECT COUNT(*) AS pending_hitl FROM approval_queue WHERE status = 'pending'`,
        ),
        pool.query(
            `SELECT date_trunc($1, created_at) AS bucket,
                    SUM(tokens_in + tokens_out) AS tokens
             FROM usage_log
             WHERE created_at >= NOW() - $2::interval
             GROUP BY bucket
             ORDER BY bucket`,
            [bucket, interval],
        ),
        pool.query(
            `SELECT tool_name, COUNT(*) AS count
             FROM usage_log
             WHERE created_at >= NOW() - $1::interval
               AND tool_name IS NOT NULL
             GROUP BY tool_name
             ORDER BY count DESC
             LIMIT 10`,
            [interval],
        ),
        pool.query(
            `SELECT ${laneCase()} AS lane, COUNT(*) AS count
             FROM usage_log
             WHERE created_at >= NOW() - $1::interval
               AND tool_name IS NOT NULL
             GROUP BY lane
             ORDER BY lane`,
            [interval],
        ),
        pool.query(
            `WITH session_stats AS (
               SELECT session_id,
                      SPLIT_PART(session_id, ':', 1) AS platform,
                      SUM(tokens_in + tokens_out)    AS tokens_total,
                      SUM(cost_usd)                  AS cost_usd,
                      COUNT(CASE WHEN tool_name IS NOT NULL THEN 1 END) AS tool_count,
                      MAX(created_at)                AS created_at
               FROM usage_log
               WHERE created_at >= NOW() - $1::interval
               GROUP BY session_id
             ),
             session_lanes AS (
               SELECT session_id, ${laneCase()} AS lane, COUNT(*) AS cnt
               FROM usage_log
               WHERE created_at >= NOW() - $1::interval AND tool_name IS NOT NULL
               GROUP BY session_id, lane
             ),
             top_lanes AS (
               SELECT DISTINCT ON (session_id) session_id, lane AS top_lane
               FROM session_lanes
               ORDER BY session_id, cnt DESC
             )
             SELECT s.session_id, s.platform, s.tokens_total, s.cost_usd,
                    s.tool_count, s.created_at, COALESCE(l.top_lane, 2) AS top_lane
             FROM session_stats s
             LEFT JOIN top_lanes l ON l.session_id = s.session_id
             ORDER BY s.created_at DESC
             LIMIT 10`,
            [interval],
        ),
    ]);

    const t = totalsRes.rows[0];
    const h = hitlRes.rows[0];

    return {
        range,
        totals: {
            tokens:      Number(t.tokens),
            costUsd:     Number(t.cost_usd),
            llmCalls:    Number(t.llm_calls),
            pendingHitl: Number(h.pending_hitl),
        },
        burnRate: burnRes.rows.map(r => ({
            bucket: new Date(r.bucket).toISOString(),
            tokens: Number(r.tokens),
        })),
        topTools: toolsRes.rows.map(r => ({
            toolName: r.tool_name as string,
            count:    Number(r.count),
        })),
        laneSplit: laneRes.rows.map(r => ({
            lane:  Number(r.lane) as 1 | 2 | 3,
            label: LANE_LABELS[Number(r.lane)],
            count: Number(r.count),
        })),
        recentSessions: sessionsRes.rows.map(r => ({
            sessionId:   r.session_id as string,
            platform:    (r.platform === 'telegram' ? 'telegram' : 'slack') as 'slack' | 'telegram',
            tokensTotal: Number(r.tokens_total),
            costUsd:     Number(r.cost_usd),
            toolCount:   Number(r.tool_count),
            topLane:     Number(r.top_lane) as 1 | 2 | 3,
            createdAt:   new Date(r.created_at).toISOString(),
        })),
        system: {
            activeSessions:        await getTotalActiveSessions(),
            memoryMb:              Math.round(process.memoryUsage().rss / 1024 / 1024),
            uptimeSeconds:         Math.round(process.uptime()),
            llmConsecutiveErrors:  getConsecutiveLlmFailures(),
        },
    };
}

const BURN_RANGE_INTERVAL: Record<BurnRange, string> = {
    '7d':  '7 days',
    '14d': '14 days',
    '30d': '30 days',
};

export async function fetchBurnRate(range: BurnRange): Promise<{ bucket: string; tokens: number }[]> {
    const pool = getDashboardPool();
    const interval = BURN_RANGE_INTERVAL[range];
    // generate_series fills every day in the range with 0 so bars are always present
    const res = await pool.query(
        `SELECT gs.day                                    AS bucket,
                COALESCE(SUM(u.tokens_in + u.tokens_out), 0) AS tokens
         FROM generate_series(
                date_trunc('day', NOW() - $1::interval),
                date_trunc('day', NOW()),
                '1 day'::interval
              ) AS gs(day)
         LEFT JOIN usage_log u
           ON date_trunc('day', u.created_at) = gs.day
         GROUP BY gs.day
         ORDER BY gs.day`,
        [interval],
    );
    return res.rows.map(r => ({
        bucket: new Date(r.bucket).toISOString(),
        tokens: Number(r.tokens),
    }));
}
