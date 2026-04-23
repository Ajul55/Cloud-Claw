import http from 'http';
import { EventEmitter } from 'events';
import { env } from '../config/env.js';
import { upsertCloudstickUser, linkSlackToCloudstickUser } from '../services/user_service.js';
import { runAgentLoop } from '../agents/loop.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { runWithCloudstickContext } from '../api/cloudstick_context.js';
import type { ReplyFn, ApprovalFn, IncomingMessage } from '../tools/types.js';

type PlanTier = 'starter' | 'pro' | 'business';
const VALID_PLANS = new Set<string>(['starter', 'pro', 'business']);

// Per-session SSE event bus
const sessionBus = new Map<string, EventEmitter>();

function getBus(sessionId: string): EventEmitter {
    if (!sessionBus.has(sessionId)) {
        const emitter = new EventEmitter();
        emitter.setMaxListeners(5);
        sessionBus.set(sessionId, emitter);
    }
    return sessionBus.get(sessionId)!;
}

function emitSSE(sessionId: string, event: string, data: object): void {
    getBus(sessionId).emit('sse', { event, data });
}

function closeBus(sessionId: string): void {
    getBus(sessionId).emit('close');
    sessionBus.delete(sessionId);
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
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

    let parsed: { message?: string; sessionId?: string };
    try { parsed = JSON.parse(await readBody(req)); }
    catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    if (!parsed.message?.trim()) return json(res, 400, { error: 'Required field: message' });

    const sessionId = parsed.sessionId ?? `cloudstick:${accountId}`;
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

    // Run agent loop in background — don't block the POST response
    Promise.resolve(runWithCloudstickContext(user, () => runAgentLoop(msg, onReply, onApproval)))
        .then(() => { emitSSE(sessionId, 'done', { text: '' }); closeBus(sessionId); })
        .catch((err: Error) => { emitSSE(sessionId, 'error', { message: err.message }); closeBus(sessionId); });

    json(res, 202, {
        sessionId,
        streamUrl: `/api/chat/${encodeURIComponent(sessionId)}/stream`,
    });
}

function handleStream(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    const bus = getBus(sessionId);

    const onEvent = ({ event, data }: { event: string; data: object }) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (event === 'done' || event === 'error') res.end();
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

    await linkSlackToCloudstickUser(
        accountId,
        parsed.slackUserId,
        typeof parsed.slackWorkspaceId === 'string' ? parsed.slackWorkspaceId : null,
    );
    json(res, 200, { linked: true });
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

        json(res, 404, { error: 'Not found' });
    };
}
