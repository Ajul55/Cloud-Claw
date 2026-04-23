import http from 'http';
import { EventEmitter } from 'events';
import { env } from '../config/env.js';
import { upsertCloudstickUser, linkSlackToCloudstickUser } from '../services/user_service.js';
import { runAgentLoop } from '../agents/loop.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { runWithCloudstickContext } from '../api/cloudstick_context.js';
import { acquireSession, releaseSession, isMonthlyCapReached } from '../services/session_limiter.js';
import { getPool, isDBConfigured } from '../database/db.js';
import type { ReplyFn, ApprovalFn, IncomingMessage } from '../tools/types.js';

type PlanTier = 'starter' | 'pro' | 'business';
const VALID_PLANS = new Set<string>(['starter', 'pro', 'business']);

// Per-session SSE event bus
const sessionBus = new Map<string, EventEmitter>();

// ── Phase 3: replay buffer ─────────────────────────────────────────────────────
// Stores the last MAX_REPLAY events per session so reconnecting clients can
// catch up without missing chunks. Keyed by sessionId, cleared 30s after close.
const MAX_REPLAY = 50;

interface ReplayEvent {
    id: string;
    event: string;
    data: object;
}

const replayBuffer = new Map<string, ReplayEvent[]>();
const sessionSeq = new Map<string, number>();

function nextEventId(sessionId: string): string {
    const seq = (sessionSeq.get(sessionId) ?? 0) + 1;
    sessionSeq.set(sessionId, seq);
    return `${sessionId}:${seq}`;
}

function appendReplay(sessionId: string, entry: ReplayEvent): void {
    const buf = replayBuffer.get(sessionId) ?? [];
    buf.push(entry);
    if (buf.length > MAX_REPLAY) buf.shift();
    replayBuffer.set(sessionId, buf);
}
// ──────────────────────────────────────────────────────────────────────────────

function getBus(sessionId: string): EventEmitter {
    if (!sessionBus.has(sessionId)) {
        const emitter = new EventEmitter();
        emitter.setMaxListeners(5);
        sessionBus.set(sessionId, emitter);
    }
    return sessionBus.get(sessionId)!;
}

function emitSSE(sessionId: string, event: string, data: object): void {
    const id = nextEventId(sessionId);
    const entry: ReplayEvent = { id, event, data };
    appendReplay(sessionId, entry);
    getBus(sessionId).emit('sse', entry);
}

function closeBus(sessionId: string): void {
    getBus(sessionId).emit('close');
    sessionBus.delete(sessionId);
    sessionSeq.delete(sessionId);
    // Keep replay buffer alive for 30 s so reconnecting clients can catch up
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

function json(res: http.ServerResponse, status: number, body: object): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handlePostChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const accountId = req.headers['x-cloudstick-account-id'] as string | undefined;
    const plan = req.headers['x-cloudstick-plan'] as string | undefined;

    if (!accountId) return json(res, 400, { error: 'Missing header: X-Cloudstick-Account-Id' });
    if (!plan || !VALID_PLANS.has(plan)) return json(res, 400, { error: 'Missing or invalid header: X-Cloudstick-Plan (starter|pro|business)' });

    let parsed: { message?: string };
    try { parsed = JSON.parse(await readBody(req)); }
    catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    if (!parsed.message?.trim()) return json(res, 400, { error: 'Required field: message' });

    const sessionId = `cloudstick:${accountId}`;
    const user = await upsertCloudstickUser(accountId, plan);

    const onReply: ReplyFn = async (text) => emitSSE(sessionId, 'chunk', { text });
    const onApproval: ApprovalFn = async ({ approvalId, command, targetHost, rationale }) =>
        emitSSE(sessionId, 'approval_required', { approvalId, action: command, host: targetHost, rationale });

    const msg: IncomingMessage = {
        sessionId,
        channel: 'cloudstick',
        userId: accountId,
        text: parsed.message.trim(),
        planTier: plan as PlanTier,
    };

    // ── Phase 2: concurrent session limit ────────────────────────────────────
    if (!acquireSession(accountId, plan)) {
        return json(res, 429, {
            error: 'TOO_MANY_SESSIONS',
            message: 'You have reached the maximum number of concurrent sessions for your plan. Please wait for your current session to finish.',
        });
    }

    // ── Phase 4: monthly call cap ─────────────────────────────────────────────
    if (await isMonthlyCapReached(accountId, plan)) {
        releaseSession(accountId);
        return json(res, 429, {
            error: 'MONTHLY_CAP_REACHED',
            message: 'You have reached your monthly LLM call limit. Please upgrade your plan or wait until next month.',
        });
    }

    // Run agent loop in background — don't block the POST response
    const sessionTimeout = setTimeout(() => {
        console.warn('[gateway] Session', sessionId, 'exceeded 5-minute timeout — force closing bus');
        emitSSE(sessionId, 'error', { message: 'Session timed out.' });
        closeBus(sessionId);
    }, 5 * 60 * 1000);

    Promise.resolve(runWithCloudstickContext(user, () => runAgentLoop(msg, onReply, onApproval)))
        .then(() => { clearTimeout(sessionTimeout); emitSSE(sessionId, 'done', { text: '' }); closeBus(sessionId); })
        .catch((err: Error) => {
            clearTimeout(sessionTimeout);
            console.error('[gateway] Agent loop error for session', sessionId, ':', err);
            emitSSE(sessionId, 'error', { message: 'An error occurred processing your request.' });
            closeBus(sessionId);
        })
        .finally(() => { releaseSession(accountId); });

    json(res, 202, {
        sessionId,
        streamUrl: `/api/chat/${encodeURIComponent(sessionId)}/stream`,
    });
}

function writeSSEEvent(res: http.ServerResponse, entry: ReplayEvent): void {
    res.write(`id: ${entry.id}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`);
}

function handleStream(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    // ── Phase 3: replay missed events on reconnect ─────────────────────────────
    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId) {
        const buffered = replayBuffer.get(sessionId) ?? [];
        // Find the index after the last event the client received
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
    // ──────────────────────────────────────────────────────────────────────────

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

async function handleApprove(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): Promise<void> {
    const accountId = req.headers['x-cloudstick-account-id'] as string | undefined;

    let parsed: { approvalId?: unknown; decision?: unknown; reason?: unknown };
    try { parsed = JSON.parse(await readBody(req)); }
    catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    const { approvalId, decision, reason } = parsed;
    if (typeof approvalId !== 'number' || (decision !== 'approve' && decision !== 'reject')) {
        return json(res, 400, { error: 'Required: approvalId (number), decision ("approve"|"reject")' });
    }

    const onReply: ReplyFn = async (text) => emitSSE(sessionId, 'chunk', { text });
    const onApproval: ApprovalFn = async ({ approvalId: id, command, targetHost, rationale }) =>
        emitSSE(sessionId, 'approval_required', { approvalId: id, action: command, host: targetHost, rationale });

    await resumeApprovedSession(
        approvalId,
        decision === 'approve',
        accountId ?? '',
        onReply,
        onApproval,
        typeof reason === 'string' ? reason : undefined,
    );

    if (decision === 'approve') { emitSSE(sessionId, 'done', { text: '' }); closeBus(sessionId); }
    json(res, 200, { ok: true });
}

async function handleSlackLink(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const accountId = req.headers['x-cloudstick-account-id'] as string | undefined;
    if (!accountId) return json(res, 400, { error: 'Missing header: X-Cloudstick-Account-Id' });

    let parsed: { slackUserId?: unknown; slackWorkspaceId?: unknown };
    try { parsed = JSON.parse(await readBody(req)); }
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
    json(res, 200, { linked: true });
}

async function handleGetUsage(req: http.IncomingMessage, res: http.ServerResponse, accountId: string): Promise<void> {
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
        console.error('[gateway] Usage query failed:', err);
        return json(res, 500, { error: 'Failed to fetch usage data.' });
    }
}

// ── Main gateway handler factory ──────────────────────────────────────────────

export function createGatewayHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
    return async (req, res) => {
        if (req.headers['x-cloudclaw-key'] !== env.CLOUDSTICK_GATEWAY_KEY) {
            return json(res, 401, { error: 'Unauthorized' });
        }

        const url = req.url ?? '';
        const method = req.method ?? '';

        if (method === 'POST' && url === '/api/chat') {
            return handlePostChat(req, res);
        }

        const streamMatch = url.match(/^\/api\/chat\/([^/]+)\/stream$/);
        if (method === 'GET' && streamMatch) {
            return handleStream(req, res, decodeURIComponent(streamMatch[1]));
        }

        const approveMatch = url.match(/^\/api\/chat\/([^/]+)\/approve$/);
        if (method === 'POST' && approveMatch) {
            return handleApprove(req, res, decodeURIComponent(approveMatch[1]));
        }

        if (method === 'POST' && url === '/api/slack/link') {
            return handleSlackLink(req, res);
        }

        const usageMatch = url.match(/^\/api\/usage\/([^/]+)$/);
        if (method === 'GET' && usageMatch) {
            return handleGetUsage(req, res, decodeURIComponent(usageMatch[1]));
        }

        json(res, 404, { error: 'Not found' });
    };
}
