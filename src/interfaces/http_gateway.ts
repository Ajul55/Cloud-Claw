import http from 'http';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { env } from '../config/env.js';
import { getUserByCloudstickAccountId, upsertCloudstickUser, linkSlackToCloudstickUser } from '../services/user_service.js';
import { runAgentLoop } from '../agents/loop.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { runWithCloudstickContext } from '../api/cloudstick_context.js';
import { acquireSession, releaseSession, isMonthlyCapReached } from '../services/session_limiter.js';
import { getPool, isDBConfigured } from '../database/db.js';
import { logger } from '../telemetry/logger.js';
import { isRedisConfigured, getRedisPublisher, createRedisSubscriber } from '../services/redis_client.js';
import type { ReplyFn, ApprovalFn, IncomingMessage } from '../tools/types.js';

type PlanTier = 'starter' | 'pro' | 'business';
const VALID_PLANS = new Set<string>(['starter', 'pro', 'business']);

// HIGH-2: Per-account rate limiter — sliding window, no external package needed
const RATE_LIMITS: Record<string, number> = { starter: 10, pro: 30, business: 60 };
const _rateCounts = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000;

// Prune stale rate-limit entries every 5 minutes to prevent unbounded map growth
setInterval(() => {
    const cutoff = Date.now() - RATE_WINDOW_MS * 2;
    for (const [id, entry] of _rateCounts) {
        if (entry.windowStart < cutoff) _rateCounts.delete(id);
    }
}, 5 * 60_000).unref();

// ARCH-4: Bounded incoming message queue per session
const SESSION_QUEUE_LIMIT = 3;
const _sessionInFlight = new Map<string, number>();

function acquireSessionSlot(sessionId: string): boolean {
    const count = _sessionInFlight.get(sessionId) ?? 0;
    if (count >= SESSION_QUEUE_LIMIT) return false;
    _sessionInFlight.set(sessionId, count + 1);
    return true;
}

function releaseSessionSlot(sessionId: string): void {
    const count = _sessionInFlight.get(sessionId) ?? 1;
    if (count <= 1) _sessionInFlight.delete(sessionId);
    else _sessionInFlight.set(sessionId, count - 1);
}

function checkRateLimit(accountId: string, plan: string): boolean {
    const limit = RATE_LIMITS[plan] ?? 10;
    const now = Date.now();
    const entry = _rateCounts.get(accountId);
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
        _rateCounts.set(accountId, { count: 1, windowStart: now });
        return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
}

// ── SSE event bus ────────────────────────────────────────────────────────────
//
// When REDIS_URL is set: Redis pub/sub enables PM2 cluster mode and
// cross-instance streaming. Replay buffer stored in Redis LISTs.
//
// When REDIS_URL is unset: in-memory EventEmitter (single-instance only).

const MAX_REPLAY = 50;
const SESSION_REPLAY_TTL_S = 300; // 5 min while active, 30 s after close
const REDIS_CH = 'cloudclaw:session:';
const REDIS_REPLAY = 'cloudclaw:replay:';
const REDIS_SEQ = 'cloudclaw:seq:';

interface ReplayEvent {
    id: string;
    event: string;
    data: object;
}

// In-memory state (fallback when Redis is not configured)
const sessionBus = new Map<string, EventEmitter>();
const replayBuffer = new Map<string, ReplayEvent[]>();
const sessionSeq = new Map<string, number>();

function getBus(sessionId: string): EventEmitter {
    if (!sessionBus.has(sessionId)) {
        const emitter = new EventEmitter();
        emitter.setMaxListeners(5);
        sessionBus.set(sessionId, emitter);
    }
    return sessionBus.get(sessionId)!;
}

async function emitSSE(sessionId: string, event: string, data: object): Promise<void> {
    if (isRedisConfigured()) {
        const redis = getRedisPublisher();
        const replayKey = `${REDIS_REPLAY}${sessionId}`;
        const seqKey = `${REDIS_SEQ}${sessionId}`;
        const seq = await redis.incr(seqKey);
        const entry: ReplayEvent = { id: `${sessionId}:${seq}`, event, data };
        const serialized = JSON.stringify(entry);
        // Pipeline: store in replay list first, then publish so subscribers
        // fetching replay on reconnect always see the event.
        await redis.pipeline()
            .rpush(replayKey, serialized)
            .ltrim(replayKey, -MAX_REPLAY, -1)
            .expire(replayKey, SESSION_REPLAY_TTL_S)
            .expire(seqKey, SESSION_REPLAY_TTL_S)
            .publish(`${REDIS_CH}${sessionId}`, serialized)
            .exec();
        return;
    }
    // In-memory fallback
    const seq = (sessionSeq.get(sessionId) ?? 0) + 1;
    sessionSeq.set(sessionId, seq);
    const entry: ReplayEvent = { id: `${sessionId}:${seq}`, event, data };
    const buf = replayBuffer.get(sessionId) ?? [];
    buf.push(entry);
    if (buf.length > MAX_REPLAY) buf.shift();
    replayBuffer.set(sessionId, buf);
    getBus(sessionId).emit('sse', entry);
}

async function closeBus(sessionId: string): Promise<void> {
    if (isRedisConfigured()) {
        const redis = getRedisPublisher();
        // Keep replay alive 30 s so reconnecting clients can catch up
        await Promise.all([
            redis.expire(`${REDIS_REPLAY}${sessionId}`, 30),
            redis.expire(`${REDIS_SEQ}${sessionId}`, 30),
        ]);
        return;
    }
    // In-memory fallback
    getBus(sessionId).emit('close');
    sessionBus.delete(sessionId);
    sessionSeq.delete(sessionId);
    setTimeout(() => { replayBuffer.delete(sessionId); }, 30_000);
}

const MAX_BODY_BYTES = 50 * 1024; // 50 KB

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        req.on('data', (c: Buffer) => {
            totalBytes += c.length;
            if (totalBytes > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

// ── Security headers applied to every JSON response ──────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cache-Control': 'no-store',
};

function getCorsHeaders(): Record<string, string> {
    const origin = env.CORS_ORIGIN;
    if (!origin) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Cloudstick-Account-Id, X-Cloudstick-Plan, X-Cloudclaw-Timestamp, X-Cloudclaw-Signature',
        'Access-Control-Max-Age': '86400',
    };
}

function json(res: http.ServerResponse, status: number, body: object): void {
    res.writeHead(status, { ...SECURITY_HEADERS, ...getCorsHeaders() });
    res.end(JSON.stringify(body));
}

function getHeader(req: http.IncomingMessage, name: string): string | undefined {
    const raw = req.headers[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0];
    return raw;
}

function verifyGatewayAuth(req: http.IncomingMessage, body: string, requestId: string): { ok: true } | { ok: false; status: number; error: string } {
    const key = env.CLOUDSTICK_GATEWAY_KEY;
    if (!key) return { ok: false, status: 503, error: 'Gateway not configured' };

    const timestamp = getHeader(req, 'x-cloudclaw-timestamp');
    const signature = getHeader(req, 'x-cloudclaw-signature');
    if (!timestamp || !signature) {
        logger.warn('gateway_auth_missing_signature', { module: 'gateway', event: 'auth_missing_signature', requestId });
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs)) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const skewMs = Math.abs(Date.now() - timestampMs);
    if (skewMs > env.CLOUDSTICK_GATEWAY_SIGNATURE_TOLERANCE_SECONDS * 1000) {
        logger.warn('gateway_auth_timestamp_outside_window', { module: 'gateway', event: 'auth_stale_timestamp', requestId, skewMs });
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const method = req.method ?? '';
    const path = req.url ?? '';
    const payload = `${method}\n${path}\n${timestamp}\n${body}`;
    const expected = createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest('hex');

    const provided = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
    if (!/^[a-f0-9]{64}$/i.test(provided)) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(provided, 'hex');
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
        logger.warn('gateway_auth_bad_signature', { module: 'gateway', event: 'auth_bad_signature', requestId });
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    return { ok: true };
}

// ── HIGH-7: Request body schemas ────────────────────────────────────────────
const PostChatSchema = z.object({
    message: z.string().min(1).max(4000),
    sessionId: z.string().optional(),
});

const PostApproveSchema = z.object({
    approved: z.boolean(),
    reason: z.string().max(500).optional(),
});

// ── Route handlers ────────────────────────────────────────────────────────────

async function handlePostChat(req: http.IncomingMessage, res: http.ServerResponse, body: string, requestId: string): Promise<void> {
    const accountId = req.headers['x-cloudstick-account-id'] as string | undefined;
    const plan = req.headers['x-cloudstick-plan'] as string | undefined;

    if (!accountId) return json(res, 400, { error: 'Missing header: X-Cloudstick-Account-Id' });
    if (!plan || !VALID_PLANS.has(plan)) return json(res, 400, { error: 'Missing or invalid header: X-Cloudstick-Plan (starter|pro|business)' });
    if (!checkRateLimit(accountId, plan)) return json(res, 429, { error: 'RATE_LIMITED', message: `Too many requests. Limit: ${RATE_LIMITS[plan] ?? 10} req/min.` });

    let parsed: z.infer<typeof PostChatSchema>;
    try {
        parsed = PostChatSchema.parse(JSON.parse(body));
    } catch {
        return json(res, 400, { error: 'Invalid request body. Required: { message: string (1-4000 chars) }' });
    }

    const sessionId = `cloudstick:${accountId}`;
    const user = await upsertCloudstickUser(accountId, plan);

    const onReply: ReplyFn = async (text) => { await emitSSE(sessionId, 'chunk', { text }); };
    const onApproval: ApprovalFn = async ({ approvalId, command, targetHost, rationale }) => {
        await emitSSE(sessionId, 'approval_required', { approvalId, action: command, host: targetHost, rationale });
    };

    const msg: IncomingMessage = {
        sessionId,
        channel: 'cloudstick',
        userId: accountId,
        text: parsed.message,
        planTier: plan as PlanTier,
    };

    // ── Phase 2: concurrent session limit ────────────────────────────────────
    if (!await acquireSession(accountId, plan)) {
        return json(res, 429, {
            error: 'TOO_MANY_SESSIONS',
            message: 'You have reached the maximum number of concurrent sessions for your plan. Please wait for your current session to finish.',
        });
    }

    // ── Phase 4: monthly call cap ─────────────────────────────────────────────
    if (await isMonthlyCapReached(accountId, plan)) {
        await releaseSession(accountId);
        return json(res, 429, {
            error: 'MONTHLY_CAP_REACHED',
            message: 'You have reached your monthly LLM call limit. Please upgrade your plan or wait until next month.',
        });
    }

    // ── ARCH-4: per-session in-flight request limit ───────────────────────────
    if (!acquireSessionSlot(sessionId)) {
        await releaseSession(accountId);
        return json(res, 429, { error: 'SESSION_BUSY', message: 'Session busy, try again shortly' });
    }

    // Run agent loop in background — don't block the POST response
    const sessionTimeout = setTimeout(() => {
        console.warn('[gateway] Session', sessionId, 'exceeded 5-minute timeout — force closing bus');
        void emitSSE(sessionId, 'error', { message: 'Session timed out.' }).then(() => closeBus(sessionId));
    }, 5 * 60 * 1000);

    Promise.resolve(runWithCloudstickContext(user, () => runAgentLoop(msg, onReply, onApproval)))
        .then(async () => { clearTimeout(sessionTimeout); await emitSSE(sessionId, 'done', { text: '' }); await closeBus(sessionId); })
        .catch(async (err: Error) => {
            clearTimeout(sessionTimeout);
            logger.error('gateway_agent_loop_failed', err, { module: 'gateway', event: 'agent_loop_failed', requestId, sessionId, accountId });
            await emitSSE(sessionId, 'error', { message: 'An error occurred processing your request.' });
            await closeBus(sessionId);
        })
        .finally(async () => { await releaseSession(accountId); releaseSessionSlot(sessionId); });

    logger.info('gateway_chat_accepted', { module: 'gateway', event: 'chat_accepted', requestId, sessionId, accountId, plan });

    json(res, 202, {
        sessionId,
        streamUrl: `/api/chat/${encodeURIComponent(sessionId)}/stream`,
    });
}

function writeSSEEvent(res: http.ServerResponse, entry: ReplayEvent): void {
    res.write(`id: ${entry.id}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`);
}

async function handleStream(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...getCorsHeaders(),
    });
    res.write(':ok\n\n');

    const lastEventId = req.headers['last-event-id'] as string | undefined;

    if (isRedisConfigured()) {
        // ── Redis pub/sub (cluster-safe) ──────────────────────────────────────
        const buffered = await getRedisPublisher().lrange(`${REDIS_REPLAY}${sessionId}`, 0, -1);
        const events = buffered.map((s: string) => JSON.parse(s) as ReplayEvent);

        // Replay missed events on reconnect
        if (lastEventId) {
            const idx = events.findIndex((e: ReplayEvent) => e.id === lastEventId);
            const missed = idx === -1 ? events : events.slice(idx + 1);
            for (const entry of missed) {
                writeSSEEvent(res, entry);
                if (entry.event === 'done' || entry.event === 'error') {
                    res.end();
                    return;
                }
            }
        }

        const sub = createRedisSubscriber();
        await sub.subscribe(`${REDIS_CH}${sessionId}`);

        sub.on('message', (_ch: string, message: string) => {
            let entry: ReplayEvent;
            try { entry = JSON.parse(message) as ReplayEvent; }
            catch { return; }
            writeSSEEvent(res, entry);
            if (entry.event === 'done' || entry.event === 'error') {
                res.end();
                sub.disconnect();
            }
        });

        req.on('close', () => { sub.disconnect(); });
        return;
    }

    // ── In-memory fallback ────────────────────────────────────────────────────
    if (lastEventId) {
        const buffered = replayBuffer.get(sessionId) ?? [];
        const idx = buffered.findIndex(e => e.id === lastEventId);
        const missed = idx === -1 ? buffered : buffered.slice(idx + 1);
        for (const entry of missed) {
            writeSSEEvent(res, entry);
            if (entry.event === 'done' || entry.event === 'error') {
                res.end();
                return;
            }
        }
    }

    const bus = getBus(sessionId);
    const onEvent = (entry: ReplayEvent) => {
        writeSSEEvent(res, entry);
        if (entry.event === 'done' || entry.event === 'error') res.end();
    };
    const onClose = () => res.end();
    bus.on('sse', onEvent);
    bus.once('close', onClose);
    req.on('close', () => { bus.off('sse', onEvent); bus.off('close', onClose); });
}

async function handleApprove(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string, body: string, requestId: string): Promise<void> {
    const accountId = req.headers['x-cloudstick-account-id'] as string | undefined;

    // SECURITY: Require accountId header — empty string is not a valid tenant identity
    if (!accountId) {
        return json(res, 401, { error: 'Missing header: X-Cloudstick-Account-Id' });
    }

    // SECURITY: Verify the caller owns this session.
    // Sessions for the HTTP gateway are always keyed as "cloudstick:{accountId}".
    // Reject any attempt to approve/reject a session belonging to a different tenant.
    const expectedSessionId = `cloudstick:${accountId}`;
    if (sessionId !== expectedSessionId) {
        return json(res, 403, { error: 'Forbidden' });
    }

    const ApproveBodySchema = z.object({
        approvalId: z.number().int().positive(),
        decision: z.enum(['approve', 'reject']),
        reason: z.string().max(500).optional(),
    });
    let parsed: z.infer<typeof ApproveBodySchema>;
    try {
        parsed = ApproveBodySchema.parse(JSON.parse(body));
    } catch {
        return json(res, 400, { error: 'Invalid request body. Required: { approvalId: number, decision: "approve"|"reject" }' });
    }
    const { approvalId, decision, reason } = parsed;

    const onReply: ReplyFn = async (text) => { await emitSSE(sessionId, 'chunk', { text }); };
    const onApproval: ApprovalFn = async ({ approvalId: id, command, targetHost, rationale }) => {
        await emitSSE(sessionId, 'approval_required', { approvalId: id, action: command, host: targetHost, rationale });
    };

    const cloudstickUser = await getUserByCloudstickAccountId(accountId);
    const approvalTimeout = setTimeout(() => {
        logger.warn('gateway_approval_resume_timeout', { module: 'gateway', event: 'approval_resume_timeout', requestId, sessionId, accountId, approvalId });
        void emitSSE(sessionId, 'error', { message: 'Approval processing timed out.' }).then(() => closeBus(sessionId));
    }, 5 * 60 * 1000);

    Promise.resolve(runWithCloudstickContext(cloudstickUser, () => resumeApprovedSession(
        approvalId,
        decision === 'approve',
        accountId,
        onReply,
        onApproval,
        typeof reason === 'string' ? reason : undefined,
    )))
        .then(async () => { clearTimeout(approvalTimeout); await emitSSE(sessionId, 'done', { text: '' }); await closeBus(sessionId); })
        .catch(async (err: Error) => {
            clearTimeout(approvalTimeout);
            logger.error('gateway_approval_resume_failed', err, { module: 'gateway', event: 'approval_resume_failed', requestId, sessionId, accountId, approvalId });
            await emitSSE(sessionId, 'error', { message: 'An error occurred processing the approval.' });
            await closeBus(sessionId);
        });

    logger.info('gateway_approval_accepted', { module: 'gateway', event: 'approval_accepted', requestId, sessionId, accountId, approvalId, decision });
    json(res, 202, { ok: true, status: 'accepted' });
}

async function handleSlackLink(req: http.IncomingMessage, res: http.ServerResponse, body: string, requestId: string): Promise<void> {
    const accountId = req.headers['x-cloudstick-account-id'] as string | undefined;
    if (!accountId) return json(res, 400, { error: 'Missing header: X-Cloudstick-Account-Id' });

    let parsed: { slackUserId?: unknown; slackWorkspaceId?: unknown };
    try { parsed = JSON.parse(body); }
    catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    if (typeof parsed.slackUserId !== 'string' || !parsed.slackUserId) {
        return json(res, 400, { error: 'Required: slackUserId (string)' });
    }

    try {
        await linkSlackToCloudstickUser(
            accountId,
            parsed.slackUserId,
            typeof parsed.slackWorkspaceId === 'string' ? parsed.slackWorkspaceId : null,
        );
    } catch (err) {
        if (err instanceof Error && err.message === 'SLACK_ALREADY_LINKED') {
            return json(res, 409, { error: 'This Slack user is already linked to a different account.' });
        }
        throw err;
    }
    logger.info('gateway_slack_linked', { module: 'gateway', event: 'slack_linked', requestId, accountId, slackUserId: parsed.slackUserId });
    json(res, 200, { linked: true });
}

async function handleGetUsage(req: http.IncomingMessage, res: http.ServerResponse, accountId: string): Promise<void> {
    const headerAccountId = req.headers['x-cloudstick-account-id'] as string | undefined;
    if (!headerAccountId) return json(res, 401, { error: 'Missing header: X-Cloudstick-Account-Id' });
    if (headerAccountId !== accountId) return json(res, 403, { error: 'Forbidden' });

    const urlObj = new URL(req.url ?? '', 'http://localhost');
    const periodParam = urlObj.searchParams.get('period');

    let periodTs: string;
    if (periodParam) {
        if (!/^\d{4}-\d{2}$/.test(periodParam)) {
            return json(res, 400, { error: 'Invalid period format. Use YYYY-MM.' });
        }
        periodTs = `${periodParam}-01`;
    } else {
        const now = new Date();
        periodTs = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    const period = periodTs.slice(0, 7);

    if (!isDBConfigured()) {
        return json(res, 200, { accountId, period, llmCalls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, serverActions: 0 });
    }

    try {
        const pool = getPool();
        const { rows } = await pool.query<{
            llm_calls: string; tokens_in: string; tokens_out: string;
            cost_usd: string; server_actions: string;
        }>(
            `SELECT
               COUNT(*) AS llm_calls,
               COALESCE(SUM(tokens_in), 0) AS tokens_in,
               COALESCE(SUM(tokens_out), 0) AS tokens_out,
               COALESCE(SUM(cost_usd), 0) AS cost_usd,
               COUNT(*) FILTER (WHERE tool_name IS NOT NULL) AS server_actions
             FROM usage_log
             WHERE account_id = $1
               AND date_trunc('month', created_at) = date_trunc('month', $2::timestamptz)`,
            [accountId, periodTs],
        );
        const row = rows[0];
        return json(res, 200, {
            accountId,
            period,
            llmCalls: parseInt(row?.llm_calls ?? '0', 10),
            tokensIn: parseInt(row?.tokens_in ?? '0', 10),
            tokensOut: parseInt(row?.tokens_out ?? '0', 10),
            costUsd: parseFloat(row?.cost_usd ?? '0'),
            serverActions: parseInt(row?.server_actions ?? '0', 10),
        });
    } catch (err) {
        logger.error('gateway_usage_query_failed', err, { module: 'gateway', event: 'usage_query_failed', accountId });
        return json(res, 500, { error: 'Failed to fetch usage data.' });
    }
}

// ── Main gateway handler factory ──────────────────────────────────────────────

export function createGatewayHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
    return async (req, res) => {
        const requestId = getHeader(req, 'x-request-id') ?? randomUUID();
        // ── CORS preflight ────────────────────────────────────────────────────
        if (req.method === 'OPTIONS') {
            const cors = getCorsHeaders();
            if (Object.keys(cors).length > 0) {
                res.writeHead(204, cors);
            } else {
                res.writeHead(204);
            }
            res.end();
            return;
        }

        let body = '';
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            try {
                body = await readBody(req);
            } catch (err) {
                logger.warn('gateway_body_read_failed', { module: 'gateway', event: 'body_read_failed', requestId, error: err instanceof Error ? err.message : String(err) });
                return json(res, 413, { error: 'Request body too large' });
            }
        }

        const auth = verifyGatewayAuth(req, body, requestId);
        if (!auth.ok) {
            return json(res, auth.status, { error: auth.error });
        }

        const url = req.url ?? '';
        const method = req.method ?? '';

        if (method === 'POST' && url === '/api/chat') {
            return handlePostChat(req, res, body, requestId);
        }

        const streamMatch = url.match(/^\/api\/chat\/([^/]+)\/stream$/);
        if (method === 'GET' && streamMatch) {
            const streamSessionId = decodeURIComponent(streamMatch[1]);
            const streamAccountId = req.headers['x-cloudstick-account-id'] as string | undefined;
            // SECURITY: Require accountId header and verify session ownership before
            // allowing any caller to subscribe to an SSE stream.
            if (!streamAccountId) {
                return json(res, 401, { error: 'Missing header: X-Cloudstick-Account-Id' });
            }
            if (streamSessionId !== `cloudstick:${streamAccountId}`) {
                return json(res, 403, { error: 'Forbidden' });
            }
            return handleStream(req, res, streamSessionId);
        }

        const approveMatch = url.match(/^\/api\/chat\/([^/]+)\/approve$/);
        if (method === 'POST' && approveMatch) {
            return handleApprove(req, res, decodeURIComponent(approveMatch[1]), body, requestId);
        }

        if (method === 'POST' && url === '/api/slack/link') {
            return handleSlackLink(req, res, body, requestId);
        }

        const usageMatch = url.match(/^\/api\/usage\/([^/]+)$/);
        if (method === 'GET' && usageMatch) {
            return handleGetUsage(req, res, decodeURIComponent(usageMatch[1]));
        }

        json(res, 404, { error: 'Not found' });
    };
}
