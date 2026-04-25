import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createHmac } from 'crypto';

// ── Mocks ────────────────────────────────────────────────────────────────────
const GATEWAY_KEY = 'a'.repeat(64);

vi.mock('../config/env.js', () => ({
    env: {
        CLOUDSTICK_GATEWAY_KEY: GATEWAY_KEY,
        CLOUDSTICK_GATEWAY_SIGNATURE_TOLERANCE_SECONDS: 300,
    }
}));

vi.mock('../services/user_service.js', () => ({
    getUserByCloudstickAccountId: vi.fn(),
    upsertCloudstickUser: vi.fn().mockResolvedValue({
        id: 1, platform: 'cloudstick', platform_id: 'acc_test',
        cloudstick_account_id: 'acc_test', plan_tier: 'pro',
        cloudstick_api_key: null, cloudstick_api_secret: null,
        cloudstick_user_id: null, ssh_private_key: null,
        ssh_public_key: null, setup_at: null, updated_at: new Date(),
        plan_updated_at: null, slack_user_id: null, slack_workspace_id: null,
    }),
    linkSlackToCloudstickUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agents/loop.js', () => ({
    runAgentLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hitl/resume.js', () => ({
    resumeApprovedSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/cloudstick_context.js', () => ({
    runWithCloudstickContext: vi.fn((_user: unknown, fn: () => unknown) => fn()),
}));

// ── Test server ───────────────────────────────────────────────────────────────
let server: http.Server;
let port: number;

const VALID_HEADERS = {
    'x-cloudstick-account-id': 'acc_test',
    'x-cloudstick-plan': 'pro',
    'content-type': 'application/json',
};

function signedHeaders(method: string, path: string, headers: Record<string, string>, body = ''): Record<string, string> {
    const timestamp = new Date().toISOString();
    const payload = `${method}\n${path}\n${timestamp}\n${body}`;
    const signature = createHmac('sha256', Buffer.from(GATEWAY_KEY, 'hex')).update(payload).digest('hex');
    return {
        ...headers,
        'x-cloudclaw-timestamp': timestamp,
        'x-cloudclaw-signature': signature,
    };
}

function request(method: string, path: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

beforeAll(async () => {
    const { createGatewayHandler } = await import('./http_gateway.js');
    server = http.createServer(async (req, res) => { await createGatewayHandler()(req, res); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('API key validation', () => {
    it('returns 401 when HMAC signature is missing', async () => {
        const { status } = await request('POST', '/api/chat', { 'content-type': 'application/json' }, '{}');
        expect(status).toBe(401);
    });

    it('returns 401 when HMAC signature is wrong', async () => {
        const { status } = await request(
            'POST',
            '/api/chat',
            {
                ...VALID_HEADERS,
                'x-cloudclaw-timestamp': new Date().toISOString(),
                'x-cloudclaw-signature': 'b'.repeat(64),
            },
            '{}'
        );
        expect(status).toBe(401);
    });
});

describe('POST /api/chat', () => {
    it('returns 400 when message is missing', async () => {
        const body = JSON.stringify({});
        const { status } = await request('POST', '/api/chat', signedHeaders('POST', '/api/chat', VALID_HEADERS, body), body);
        expect(status).toBe(400);
    });

    it('returns 400 when plan header is invalid', async () => {
        const body = JSON.stringify({ message: 'hi' });
        const headers = { ...VALID_HEADERS, 'x-cloudstick-plan': 'enterprise' };
        const { status } = await request('POST', '/api/chat', signedHeaders('POST', '/api/chat', headers, body), body);
        expect(status).toBe(400);
    });

    it('returns 202 with sessionId and streamUrl', async () => {
        const body = JSON.stringify({ message: 'check nginx' });
        const { status, body: responseBody } = await request('POST', '/api/chat', signedHeaders('POST', '/api/chat', VALID_HEADERS, body), body);
        expect(status).toBe(202);
        const parsed = JSON.parse(responseBody);
        expect(parsed.sessionId).toBe('cloudstick:acc_test');
        expect(parsed.streamUrl).toContain('/api/chat/');
        expect(parsed.streamUrl).toContain('/stream');
    });
});

describe('POST /api/slack/link', () => {
    it('returns 400 when slackUserId is missing', async () => {
        const body = JSON.stringify({});
        const { status } = await request('POST', '/api/slack/link', signedHeaders('POST', '/api/slack/link', VALID_HEADERS, body), body);
        expect(status).toBe(400);
    });

    it('returns 200 with linked:true on success', async () => {
        const body = JSON.stringify({ slackUserId: 'U12345', slackWorkspaceId: 'T09876' });
        const { status, body: responseBody } = await request(
            'POST', '/api/slack/link', signedHeaders('POST', '/api/slack/link', VALID_HEADERS, body),
            body
        );
        expect(status).toBe(200);
        expect(JSON.parse(responseBody).linked).toBe(true);
    });
});

describe('POST /api/chat/:sessionId/approve', () => {
    it('returns 400 when decision is missing', async () => {
        const body = JSON.stringify({ approvalId: 1 });
        const { status } = await request(
            'POST', '/api/chat/cloudstick:acc_test/approve', signedHeaders('POST', '/api/chat/cloudstick:acc_test/approve', VALID_HEADERS, body),
            body
        );
        expect(status).toBe(400);
    });

    it('returns 202 immediately on valid approve', async () => {
        const body = JSON.stringify({ approvalId: 1, decision: 'approve' });
        const { status } = await request(
            'POST', '/api/chat/cloudstick:acc_test/approve', signedHeaders('POST', '/api/chat/cloudstick:acc_test/approve', VALID_HEADERS, body),
            body
        );
        expect(status).toBe(202);
    });
});

describe('GET /api/usage/:accountId', () => {
    it('returns 403 when header account does not match route account', async () => {
        const path = '/api/usage/other_account';
        const { status } = await request('GET', path, signedHeaders('GET', path, VALID_HEADERS));
        expect(status).toBe(403);
    });
});

describe('unknown routes', () => {
    it('returns 404', async () => {
        const { status } = await request('GET', '/api/unknown', signedHeaders('GET', '/api/unknown', VALID_HEADERS));
        expect(status).toBe(404);
    });
});
