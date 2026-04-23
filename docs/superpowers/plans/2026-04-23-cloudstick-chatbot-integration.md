# Cloudstick Chatbot Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Cloud-Claw as a private HTTP API so Cloudstick's backend can proxy chat messages from the dashboard widget and Slack, with per-account sessions, SSE streaming, and plan-tier rate limits.

**Architecture:** Cloudstick's backend authenticates with a static gateway key and passes account ID + plan tier as headers. Cloud-Claw creates/resumes a `cloudstick:<account_id>` session and runs the existing agent loop, streaming responses via Server-Sent Events. Slack messages from linked users resolve to the same session.

**Tech Stack:** Node.js `http` module (no framework), Vitest, PostgreSQL (pg pool via `src/database/db.ts`), EventEmitter (SSE bus), existing `runAgentLoop` + `resumeApprovedSession`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/database/migrations/004_cloudstick_gateway.sql` | **Create** | New columns + unique constraints on `users` table |
| `src/config/env.ts` | **Modify** | Add `CLOUDSTICK_GATEWAY_KEY` to Zod schema |
| `src/tools/types.ts` | **Modify** | Add `'cloudstick'` to `IncomingMessage.channel`; add `planTier` field |
| `src/services/user_service.ts` | **Modify** | `CloudclawUser` type + 4 new functions |
| `src/services/user_service.test.ts` | **Create** | Tests for the 4 new service functions (mock DB) |
| `src/interfaces/http_gateway.ts` | **Create** | All 4 HTTP endpoints + SSE bus |
| `src/interfaces/http_gateway.test.ts` | **Create** | Route-level tests using real HTTP server on test port |
| `src/health.ts` | **Modify** | Delegate `/api/` paths to gateway handler |
| `src/index.ts` | **Modify** | Pass gateway handler into `startHealthServer` |
| `src/interfaces/slack.ts` | **Modify** | Multi-tenant lookup — Cloudstick-linked users bypass whitelist |
| `src/agents/loop.ts` | **Modify** | Plan-tier SSH call limits (replace hardcoded `30`) |

**Untouched:** `loop.ts` agent core, `hallucination_guard.ts`, all tools, `hitl/resume.ts`.

---

## Task 1: DB Migration + Env Config

**Files:**
- Create: `src/database/migrations/004_cloudstick_gateway.sql`
- Modify: `src/config/env.ts`

- [ ] **Step 1.1: Create migration file**

```sql
-- src/database/migrations/004_cloudstick_gateway.sql
-- Cloudstick gateway integration: per-account identity + plan tier

ALTER TABLE users ADD COLUMN IF NOT EXISTS cloudstick_account_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_user_id          TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_workspace_id     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier              TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at        TIMESTAMPTZ;
```

- [ ] **Step 1.2: Run the migration against your local DB**

```bash
psql $DATABASE_URL -f src/database/migrations/004_cloudstick_gateway.sql
```

Expected: `ALTER TABLE` × 5, no errors.

- [ ] **Step 1.3: Add `CLOUDSTICK_GATEWAY_KEY` to the Zod schema**

In `src/config/env.ts`, after the `ENCRYPTION_KEY` line, add:

```typescript
    // Cloudstick gateway shared secret — 64-char hex
    CLOUDSTICK_GATEWAY_KEY: z.string().length(64).optional(),
```

- [ ] **Step 1.4: Add placeholder to `.env`**

```env
# ── Cloudstick Gateway ────────────────────────────────────────────────────────
CLOUDSTICK_GATEWAY_KEY=   # 64-char hex — generate with: openssl rand -hex 32
```

- [ ] **Step 1.5: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/database/migrations/004_cloudstick_gateway.sql src/config/env.ts .env
git commit -m "feat(gateway): add DB migration and CLOUDSTICK_GATEWAY_KEY env var"
```

---

## Task 2: User Service — New Functions

**Files:**
- Modify: `src/services/user_service.ts`
- Create: `src/services/user_service.test.ts`

- [ ] **Step 2.1: Extend `CloudclawUser` interface**

In `src/services/user_service.ts`, replace the existing `CloudclawUser` interface with:

```typescript
export interface CloudclawUser {
    id: number;
    platform: 'slack' | 'telegram' | 'cloudstick';
    platform_id: string;
    cloudstick_api_key: string | null;
    cloudstick_api_secret: string | null;
    cloudstick_user_id: string | null;
    ssh_private_key: string | null;
    ssh_public_key: string | null;
    setup_at: Date | null;
    updated_at: Date;
    // Cloudstick gateway fields (added by migration 004)
    cloudstick_account_id: string | null;
    plan_tier: string | null;
    plan_updated_at: Date | null;
    slack_user_id: string | null;
    slack_workspace_id: string | null;
}
```

- [ ] **Step 2.2: Write the failing tests first**

Create `src/services/user_service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB pool before importing user_service
vi.mock('../database/db.js', () => ({
    isDBConfigured: vi.fn(() => true),
    getPool: vi.fn(() => mockPool),
}));

const mockPool = { query: vi.fn() };

// Import after mock is set up
const { getUserByCloudstickAccountId, upsertCloudstickUser, getUserBySlackUserId, linkSlackToCloudstickUser } =
    await import('./user_service.js');

const fakeUser = {
    id: 1, platform: 'cloudstick', platform_id: 'acc_123',
    cloudstick_account_id: 'acc_123', plan_tier: 'pro',
    plan_updated_at: new Date(), slack_user_id: null,
    slack_workspace_id: null, cloudstick_api_key: null,
    cloudstick_api_secret: null, cloudstick_user_id: null,
    ssh_private_key: null, ssh_public_key: null,
    setup_at: null, updated_at: new Date(),
};

beforeEach(() => { mockPool.query.mockReset(); });

describe('getUserByCloudstickAccountId', () => {
    it('returns user when found', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [fakeUser] });
        const result = await getUserByCloudstickAccountId('acc_123');
        expect(result).toEqual(fakeUser);
        expect(mockPool.query).toHaveBeenCalledWith(
            expect.stringContaining('cloudstick_account_id'),
            ['acc_123']
        );
    });

    it('returns null when not found', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        const result = await getUserByCloudstickAccountId('unknown');
        expect(result).toBeNull();
    });
});

describe('upsertCloudstickUser', () => {
    it('returns the upserted row', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [fakeUser] });
        const result = await upsertCloudstickUser('acc_123', 'pro');
        expect(result.cloudstick_account_id).toBe('acc_123');
        expect(result.plan_tier).toBe('pro');
    });
});

describe('getUserBySlackUserId', () => {
    it('returns user linked to that Slack ID', async () => {
        const withSlack = { ...fakeUser, slack_user_id: 'U12345' };
        mockPool.query.mockResolvedValueOnce({ rows: [withSlack] });
        const result = await getUserBySlackUserId('U12345');
        expect(result?.slack_user_id).toBe('U12345');
    });

    it('returns null when no user is linked', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        const result = await getUserBySlackUserId('U_nobody');
        expect(result).toBeNull();
    });
});

describe('linkSlackToCloudstickUser', () => {
    it('calls UPDATE with correct params', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        await linkSlackToCloudstickUser('acc_123', 'U12345', 'T09876');
        expect(mockPool.query).toHaveBeenCalledWith(
            expect.stringContaining('slack_user_id'),
            ['acc_123', 'U12345', 'T09876']
        );
    });
});
```

- [ ] **Step 2.3: Run to confirm tests fail**

```bash
npx vitest run src/services/user_service.test.ts
```

Expected: FAIL — functions not defined.

- [ ] **Step 2.4: Add the four new functions to `src/services/user_service.ts`**

Append before the final export or at the end of the file:

```typescript
export async function getUserByCloudstickAccountId(accountId: string): Promise<CloudclawUser | null> {
    if (!isDBConfigured()) return null;
    const pool = getPool();
    const { rows } = await pool.query(
        'SELECT * FROM users WHERE cloudstick_account_id = $1',
        [accountId]
    );
    return (rows[0] as unknown as CloudclawUser) ?? null;
}

export async function upsertCloudstickUser(accountId: string, planTier: string): Promise<CloudclawUser> {
    const pool = getPool();
    const { rows } = await pool.query(`
        INSERT INTO users (platform, platform_id, cloudstick_account_id, plan_tier, plan_updated_at)
        VALUES ('cloudstick', $1, $1, $2, NOW())
        ON CONFLICT (cloudstick_account_id) DO UPDATE SET
            plan_tier = EXCLUDED.plan_tier,
            plan_updated_at = CASE
                WHEN users.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier THEN NOW()
                ELSE users.plan_updated_at
            END
        RETURNING *
    `, [accountId, planTier]);
    return rows[0] as unknown as CloudclawUser;
}

export async function getUserBySlackUserId(slackUserId: string): Promise<CloudclawUser | null> {
    if (!isDBConfigured()) return null;
    const pool = getPool();
    const { rows } = await pool.query(
        'SELECT * FROM users WHERE slack_user_id = $1',
        [slackUserId]
    );
    return (rows[0] as unknown as CloudclawUser) ?? null;
}

export async function linkSlackToCloudstickUser(
    cloudstickAccountId: string,
    slackUserId: string,
    slackWorkspaceId: string | null,
): Promise<void> {
    const pool = getPool();
    await pool.query(
        `UPDATE users SET slack_user_id = $2, slack_workspace_id = $3
         WHERE cloudstick_account_id = $1`,
        [cloudstickAccountId, slackUserId, slackWorkspaceId]
    );
}
```

- [ ] **Step 2.5: Run tests — expect pass**

```bash
npx vitest run src/services/user_service.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 2.6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2.7: Commit**

```bash
git add src/services/user_service.ts src/services/user_service.test.ts
git commit -m "feat(gateway): add Cloudstick user provisioning functions"
```

---

## Task 3: Update `IncomingMessage` Type

**Files:**
- Modify: `src/tools/types.ts`

- [ ] **Step 3.1: Extend `IncomingMessage`**

In `src/tools/types.ts`, replace the `IncomingMessage` interface (lines 43–59) with:

```typescript
export interface IncomingMessage {
    /** Unique session key, e.g. "telegram:123456789" or "cloudstick:acc_123" */
    sessionId: string;
    channel: 'telegram' | 'slack' | 'cloudstick';
    userId: string;
    text: string;
    /** Concrete reply target (Slack channel ID, Telegram chat ID) */
    replyTarget?: string;
    /** Tools that were executed during HITL resume before re-entering the loop. */
    resumedTools?: string[];
    /** Set to true when the user clicked "Proceed" on the clarification button card. */
    isProceedClarification?: boolean;
    /** Plan tier for Cloudstick business users — drives SSH call rate limits. */
    planTier?: 'starter' | 'pro' | 'business';
}
```

- [ ] **Step 3.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors (new optional field, fully backward compatible).

- [ ] **Step 3.3: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat(gateway): add planTier and cloudstick channel to IncomingMessage"
```

---

## Task 4: HTTP Gateway — All Endpoints

**Files:**
- Create: `src/interfaces/http_gateway.ts`
- Create: `src/interfaces/http_gateway.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `src/interfaces/http_gateway.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../config/env.js', () => ({
    env: { CLOUDSTICK_GATEWAY_KEY: 'a'.repeat(64) }
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
    'x-cloudclaw-key': 'a'.repeat(64),
    'x-cloudstick-account-id': 'acc_test',
    'x-cloudstick-plan': 'pro',
    'content-type': 'application/json',
};

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
    it('returns 401 when key is missing', async () => {
        const { status } = await request('POST', '/api/chat', { 'content-type': 'application/json' }, '{}');
        expect(status).toBe(401);
    });

    it('returns 401 when key is wrong', async () => {
        const { status } = await request('POST', '/api/chat', { 'x-cloudclaw-key': 'bad', 'content-type': 'application/json' }, '{}');
        expect(status).toBe(401);
    });
});

describe('POST /api/chat', () => {
    it('returns 400 when message is missing', async () => {
        const { status } = await request('POST', '/api/chat', VALID_HEADERS, JSON.stringify({}));
        expect(status).toBe(400);
    });

    it('returns 400 when plan header is invalid', async () => {
        const headers = { ...VALID_HEADERS, 'x-cloudstick-plan': 'enterprise' };
        const { status } = await request('POST', '/api/chat', headers, JSON.stringify({ message: 'hi' }));
        expect(status).toBe(400);
    });

    it('returns 202 with sessionId and streamUrl', async () => {
        const { status, body } = await request('POST', '/api/chat', VALID_HEADERS, JSON.stringify({ message: 'check nginx' }));
        expect(status).toBe(202);
        const parsed = JSON.parse(body);
        expect(parsed.sessionId).toBe('cloudstick:acc_test');
        expect(parsed.streamUrl).toContain('/api/chat/');
        expect(parsed.streamUrl).toContain('/stream');
    });
});

describe('POST /api/slack/link', () => {
    it('returns 400 when slackUserId is missing', async () => {
        const { status } = await request('POST', '/api/slack/link', VALID_HEADERS, JSON.stringify({}));
        expect(status).toBe(400);
    });

    it('returns 200 with linked:true on success', async () => {
        const { status, body } = await request(
            'POST', '/api/slack/link', VALID_HEADERS,
            JSON.stringify({ slackUserId: 'U12345', slackWorkspaceId: 'T09876' })
        );
        expect(status).toBe(200);
        expect(JSON.parse(body).linked).toBe(true);
    });
});

describe('POST /api/chat/:sessionId/approve', () => {
    it('returns 400 when decision is missing', async () => {
        const { status } = await request(
            'POST', '/api/chat/cloudstick:acc_test/approve', VALID_HEADERS,
            JSON.stringify({ approvalId: 1 })
        );
        expect(status).toBe(400);
    });

    it('returns 200 on valid approve', async () => {
        const { status } = await request(
            'POST', '/api/chat/cloudstick:acc_test/approve', VALID_HEADERS,
            JSON.stringify({ approvalId: 1, decision: 'approve' })
        );
        expect(status).toBe(200);
    });
});

describe('unknown routes', () => {
    it('returns 404', async () => {
        const { status } = await request('GET', '/api/unknown', VALID_HEADERS);
        expect(status).toBe(404);
    });
});
```

- [ ] **Step 4.2: Run tests — confirm they fail**

```bash
npx vitest run src/interfaces/http_gateway.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `src/interfaces/http_gateway.ts`**

```typescript
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

// Per-session SSE event bus — EventEmitter per sessionId
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
    runWithCloudstickContext(user, () => runAgentLoop(msg, onReply, onApproval))
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
    res.write(':ok\n\n'); // Initial flush to confirm connection

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
        // Validate shared secret on all /api/ routes
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
```

- [ ] **Step 4.4: Run tests — expect pass**

```bash
npx vitest run src/interfaces/http_gateway.test.ts
```

Expected: 11 tests PASS.

- [ ] **Step 4.5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4.6: Commit**

```bash
git add src/interfaces/http_gateway.ts src/interfaces/http_gateway.test.ts
git commit -m "feat(gateway): implement HTTP gateway — POST /api/chat, SSE stream, approve, slack/link"
```

---

## Task 5: Mount Gateway in Health Server

**Files:**
- Modify: `src/health.ts`
- Modify: `src/index.ts`

- [ ] **Step 5.1: Extend `startHealthServer` to accept a gateway handler**

Replace `src/health.ts` entirely with:

```typescript
import http from 'http';
import { getPool, isDBConfigured } from './database/db.js';

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

export function startHealthServer(port = 9000, gatewayHandler?: RequestHandler): void {
    const server = http.createServer(async (req, res) => {
        // Delegate /api/ paths to the gateway handler if present
        if (gatewayHandler && req.url?.startsWith('/api/')) {
            try {
                await gatewayHandler(req, res);
            } catch (err) {
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
            }
            return;
        }

        if (req.url !== '/health') {
            res.writeHead(404);
            res.end();
            return;
        }

        const headers = { 'Content-Type': 'application/json' };

        if (!isDBConfigured()) {
            res.writeHead(503, headers);
            res.end(JSON.stringify({
                status: 'degraded',
                db: 'not_configured',
                uptime: process.uptime(),
                pid: process.pid,
            }));
            return;
        }

        try {
            await getPool().query('SELECT 1');
            res.writeHead(200, headers);
            res.end(JSON.stringify({
                status: 'ok',
                db: 'connected',
                uptime: Math.round(process.uptime()),
                pid: process.pid,
                memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
            }));
        } catch {
            res.writeHead(503, headers);
            res.end(JSON.stringify({
                status: 'error',
                db: 'disconnected',
                uptime: Math.round(process.uptime()),
                pid: process.pid,
            }));
        }
    });

    server.listen(port, () => {
        console.log(`[health] Listening on :${port}/health`);
        if (gatewayHandler) console.log(`[health] Gateway mounted on :${port}/api/`);
    });

    server.unref();
}
```

- [ ] **Step 5.2: Wire gateway into `src/index.ts`**

Find the line in `src/index.ts` that calls `startHealthServer(9000)` (or similar). Replace it with:

```typescript
import { createGatewayHandler } from './interfaces/http_gateway.js';
// ...
startHealthServer(9000, createGatewayHandler());
```

The import should go with the other interface imports near the top of the file.

- [ ] **Step 5.3: Typecheck + run existing tests**

```bash
npm run typecheck && npx vitest run
```

Expected: all existing tests still pass, no type errors.

- [ ] **Step 5.4: Commit**

```bash
git add src/health.ts src/index.ts
git commit -m "feat(gateway): mount HTTP gateway on port 9000 /api/ — health server extended"
```

---

## Task 6: Multi-Tenant Slack

**Files:**
- Modify: `src/interfaces/slack.ts`

- [ ] **Step 6.1: Add import at top of `src/interfaces/slack.ts`**

Add to the existing imports:

```typescript
import { getUserBySlackUserId } from '../services/user_service.js';
import { runWithCloudstickContext } from '../api/cloudstick_context.js';
```

- [ ] **Step 6.2: Replace the whitelist guard in `handleMessage`**

Find in `handleMessage` (around line 53):
```typescript
        if (env.SLACK_USER_ID && env.SLACK_USER_ID.startsWith('U') && user !== env.SLACK_USER_ID) {
            console.log(`[slack] Ignoring message from non-whitelisted user ${user}`);
            return;
        }
        const sessionId = `slack:${user}`;
```

Replace with:
```typescript
        // Try to find a Cloudstick business user linked to this Slack user ID
        const cloudstickUser = await getUserBySlackUserId(user);

        if (!cloudstickUser) {
            // Fall back to legacy single-user whitelist for non-Cloudstick users
            if (env.SLACK_USER_ID && env.SLACK_USER_ID.startsWith('U') && user !== env.SLACK_USER_ID) {
                console.log(`[slack] Ignoring message from non-whitelisted user ${user}`);
                return;
            }
        }

        const sessionId = cloudstickUser
            ? `cloudstick:${cloudstickUser.cloudstick_account_id}`
            : `slack:${user}`;
```

- [ ] **Step 6.3: Wrap agent loop with Cloudstick context when user is a business user**

Find the `runAgentLoop` call inside `handleMessage`. Wrap it so that if `cloudstickUser` is set, the call runs inside `runWithCloudstickContext`:

```typescript
        const runLoop = () => runAgentLoop(
            { sessionId, channel: cloudstickUser ? 'cloudstick' : 'slack', userId: user, text: loopText, replyTarget: channel },
            replyFn,
            approvalFn,
            indicator,
        );

        if (cloudstickUser) {
            await runWithCloudstickContext(cloudstickUser, runLoop);
        } else {
            await runLoop();
        }
```

> **Note:** The exact variable names (`loopText`, `replyFn`, `approvalFn`, `indicator`) depend on what the `handleMessage` function already uses. Read the function body carefully before applying this change and adapt to match the existing names.

- [ ] **Step 6.4: Typecheck + run tests**

```bash
npm run typecheck && npx vitest run
```

Expected: all tests pass, no type errors.

- [ ] **Step 6.5: Commit**

```bash
git add src/interfaces/slack.ts
git commit -m "feat(gateway): multi-tenant Slack — Cloudstick-linked users bypass whitelist, share session"
```

---

## Task 7: Plan-Tier SSH Rate Limits

**Files:**
- Modify: `src/agents/loop.ts`

- [ ] **Step 7.1: Add the plan limits map near the top of the loop file**

Find where `const SSH_TOOLS = new Set(...)` is declared (line ~99). Just below it, add:

```typescript
const SSH_CALL_LIMITS: Record<string, number> = {
    starter: 10,
    pro: 30,
    business: 50,
};
```

- [ ] **Step 7.2: Make SSH call limit dynamic**

The limit is checked in two places. Search for `sshCallCount >= 30` — it appears at lines ~1230 and ~1494.

At the top of `_runAgentLoopCore` (or wherever `message` is in scope), add:

```typescript
    const sshCallLimit = SSH_CALL_LIMITS[message.planTier ?? 'pro'] ?? 30;
```

Then replace both occurrences of `>= 30` with `>= sshCallLimit`.

Also update the two blocked messages to include the actual limit:
```typescript
// Line ~1234 — replace the content string:
content: `BLOCKED: SSH rate limit reached for this session (${sshCallLimit} tool executions). Summarize findings and stop.`,

// Line ~1498 — replace similarly:
content: `BLOCKED: SSH rate limit reached for this session (${sshCallLimit} tool executions).`,
```

- [ ] **Step 7.3: Verify tests pass**

```bash
npx vitest run && npm run typecheck
```

Expected: all tests pass, no type errors. Existing tests use `planTier` = undefined → defaults to `'pro'` → limit = 30 → behavior unchanged.

- [ ] **Step 7.4: Commit**

```bash
git add src/agents/loop.ts
git commit -m "feat(gateway): plan-tier SSH call limits — starter:10, pro:30, business:50"
```

---

## Verification Checklist

Run these to confirm the full integration works:

```bash
# 1. All tests pass
npx vitest run

# 2. TypeScript compiles clean
npm run typecheck

# 3. Manual smoke test — generate a gateway key first
export CLOUDSTICK_GATEWAY_KEY=$(openssl rand -hex 32)
npm run dev &

# 4. Health still works
curl http://localhost:9000/health

# 5. Missing key → 401
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9000/api/chat \
  -H "content-type: application/json" -d '{"message":"test"}'
# Expected: 401

# 6. Valid POST /api/chat → 202 + streamUrl
curl -s -X POST http://localhost:9000/api/chat \
  -H "X-CloudClaw-Key: $CLOUDSTICK_GATEWAY_KEY" \
  -H "X-Cloudstick-Account-Id: acc_smoketest" \
  -H "X-Cloudstick-Plan: pro" \
  -H "Content-Type: application/json" \
  -d '{"message":"is nginx running?"}' | jq .
# Expected: { "sessionId": "cloudstick:acc_smoketest", "streamUrl": "..." }

# 7. SSE stream (in a second terminal)
SESSION=cloudstick:acc_smoketest
curl -N http://localhost:9000/api/chat/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SESSION'))")/stream \
  -H "X-CloudClaw-Key: $CLOUDSTICK_GATEWAY_KEY" \
  -H "X-Cloudstick-Account-Id: acc_smoketest" \
  -H "X-Cloudstick-Plan: pro"
# Expected: SSE events arrive as agent runs

# 8. Slack link
curl -s -X POST http://localhost:9000/api/slack/link \
  -H "X-CloudClaw-Key: $CLOUDSTICK_GATEWAY_KEY" \
  -H "X-Cloudstick-Account-Id: acc_smoketest" \
  -H "X-Cloudstick-Plan: pro" \
  -H "Content-Type: application/json" \
  -d '{"slackUserId":"U12345","slackWorkspaceId":"T09876"}' | jq .
# Expected: { "linked": true }
```
