# Cloudstick Chatbot Integration — Design Spec

**Date:** 2026-04-23
**Status:** Approved
**Authors:** Cloud-Claw team

---

## Problem & Goal

Cloud-Claw is being offered to Cloudstick business users as a commercial AIOps service. Users need to interact with the AI agent through two channels: (1) an embedded chatbot widget inside the Cloudstick dashboard, and (2) Slack. Cloudstick developers own the frontend widget and backend proxy — Cloud-Claw exposes a private HTTP API they call on behalf of users.

---

## Architecture Decision

**Cloudstick's backend proxies all chat to Cloud-Claw.**

Cloudstick is the identity provider and plan gatekeeper. It knows the user's plan tier and checks it *before* calling Cloud-Claw. Cloud-Claw is never publicly exposed — only Cloudstick's backend holds the `CLOUDSTICK_GATEWAY_KEY`. Both the dashboard and Slack channels share the same session per Cloudstick account.

```
Cloudstick Dashboard (browser)
        │
        │  (Cloudstick frontend — their responsibility)
        ▼
Cloudstick Backend
        │
        │  POST /api/chat                ← user message + account ID + plan tier
        │  GET  /api/chat/:id/stream     ← SSE stream — agent responses
        │  Header: X-CloudClaw-Key: <static secret>
        ▼
Cloud-Claw HTTP API  (private — not public-facing)
        │
        ├── Validates API key
        ├── Creates/resumes session: "cloudstick:<account_id>"
        ├── Stores plan tier on session
        └── runAgentLoop() — same loop used by Slack/Telegram
                ├── SSH → managed servers
                ├── Cloudstick API → hosting panel
                └── Streams responses via SSE

─────────────────────────────────────────────────
Slack (same session infrastructure)

Cloudstick dashboard "Connect Slack" settings page
  → Slack OAuth flow (Cloudstick backend handles)
  → POST /api/slack/link to Cloud-Claw with slackUserId

Slack message arrives at Cloud-Claw
  → look up cloudstick_account_id by slack_user_id
  → sessionId = "cloudstick:<account_id>"  ← same session as dashboard
```

---

## API Contract

### Authentication

Every request from Cloudstick's backend must include:

```
X-CloudClaw-Key: <shared static secret>        (env: CLOUDSTICK_GATEWAY_KEY)
X-Cloudstick-Account-Id: <account_id>          (Cloudstick's internal user/account ID)
X-Cloudstick-Plan: starter | pro | business    (plan tier — used for rate limiting)
```

Missing or invalid key → `401 Unauthorized`. Missing plan or account ID → `400 Bad Request`.

---

### POST /api/chat — Send a message

```
POST /api/chat
Content-Type: application/json

{
  "message": "nginx is throwing 502 on production",
  "sessionId": "cloudstick:acc_123"   // optional — omit to use "cloudstick:<account_id>" (default)
}
```

```
202 Accepted
{
  "sessionId": "cloudstick:acc_123456",
  "streamUrl": "/api/chat/cloudstick:acc_123456/stream"
}
```

Cloudstick backend immediately opens the `streamUrl` as an SSE connection after receiving this response.

---

### GET /api/chat/:sessionId/stream — Receive agent response (SSE)

```
GET /api/chat/cloudstick:acc_123456/stream
Accept: text/event-stream
```

Event types:

| Event | Payload | Action |
|---|---|---|
| `chunk` | `{ "text": "Checking nginx..." }` | Append text to chat bubble |
| `approval_required` | `{ "approvalId": "apr_789", "action": "fix_nginx_config", "host": "prod-01", "rationale": "Restart with corrected upstream block" }` | Show Approve / Reject buttons |
| `done` | `{ "text": "Complete response text." }` | Close stream, mark message finished |
| `error` | `{ "message": "Rate limit exceeded" }` | Show error in widget |

---

### POST /api/chat/:sessionId/approve — Submit HITL decision

```
POST /api/chat/cloudstick:acc_123456/approve
Content-Type: application/json

{
  "approvalId": "apr_789",
  "decision": "approve",      // or "reject"
  "reason": "optional text"   // required when decision = "reject"
}
```

```
200 OK
```

After approval, the agent loop resumes and emits further `chunk` events on the open SSE stream.

---

### POST /api/slack/link — Link a Slack user to a Cloudstick account

Called once from Cloudstick's backend after the user completes the Slack OAuth flow.

```
POST /api/slack/link
Content-Type: application/json

{
  "slackUserId": "U12345ABC",
  "slackWorkspaceId": "T09876XYZ"
}
```

```
200 OK
{ "linked": true }
```

---

### GET /health — Health check (existing, unchanged)

```
200 OK  { "status": "ok", "db": "connected", "uptime": 12345 }
503     { "status": "error", "db": "disconnected" }
```

---

## Plan Tier Limits (enforced by Cloud-Claw)

| Plan | Max active agent sessions* | SSH calls/session | Write tools |
|---|---|---|---|
| starter | 1 | 10 | HITL always required |
| pro | 3 | 30 | HITL always required |
| business | 10 | 50 | HITL always required |

\* "Active agent session" = an open SSE stream with a running agent loop. A second `POST /api/chat` while at the limit returns `429 Too Many Requests` immediately (no stream opened). SSH call limit violations are delivered as an `error` SSE event mid-stream.

HITL approval is always required for Tier-3 (destructive) actions regardless of plan. Plan only affects throughput limits.

---

## Database Changes

### New environment variable

```env
CLOUDSTICK_GATEWAY_KEY=   # 64-char hex — shared secret with Cloudstick backend
```

### DB migration — `users` table additions

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS cloudstick_account_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'starter';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_workspace_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_cloudstick_account_idx
    ON users (cloudstick_account_id)
    WHERE cloudstick_account_id IS NOT NULL;
```

### Session keying

- Format: `cloudstick:<account_id>` — e.g. `cloudstick:acc_123456`
- `channel` column: `'cloudstick'` (no schema change needed — column is plain `TEXT`)
- Slack messages from a linked user resolve to the same session as dashboard messages

### Request flow (per chat message)

```
POST /api/chat arrives
  → validate X-CloudClaw-Key (compare HMAC-safe against CLOUDSTICK_GATEWAY_KEY)
  → extract account_id from X-Cloudstick-Account-Id
  → extract plan from X-Cloudstick-Plan
  → getUserByCloudstickAccountId(account_id)
      → not found: INSERT new user row with cloudstick_account_id + plan_tier
      → found, plan changed: UPDATE plan_tier + plan_updated_at
  → sessionId = "cloudstick:" + account_id
  → upsertSession(sessionId, channel='cloudstick', userId=account_id)
  → runWithCloudstickContext(user, () => runAgentLoop(...))
```

---

## Responsibility Split

### Cloud-Claw builds

**Piece 1 — HTTP Gateway** *(ships first — unblocks Cloudstick devs)*
- New file: `src/interfaces/http_gateway.ts`
- Extend `src/health.ts` into a lightweight router
- Endpoints: `POST /api/chat`, `GET /api/chat/:id/stream`, `POST /api/chat/:id/approve`
- Middleware: API key validation, account ID + plan header extraction

**Piece 2 — User provisioning**
- `src/services/user_service.ts`: add `getUserByCloudstickAccountId()`, auto-create + plan-tier update
- DB migration script for new columns
- `src/config/env.ts`: add `CLOUDSTICK_GATEWAY_KEY`

**Piece 3 — Slack linking + multi-tenant Slack**
- `POST /api/slack/link` in gateway
- `src/interfaces/slack.ts`: remove single `SLACK_USER_ID` whitelist, replace with DB lookup → `cloudstick_account_id`

**Piece 4 — Plan-tier rate limiting**
- `src/agents/tool_guard.ts`: read `plan_tier` from session, enforce SSH call limits per plan

### Cloudstick developers build (handoff spec)

| Task | Detail |
|---|---|
| **Chat widget UI** | Renders streaming SSE `chunk` events as text. Shows Approve/Reject buttons on `approval_required`. |
| **Backend proxy** | Forwards user messages to `POST /api/chat`. Opens SSE stream and relays events to browser. |
| **Auth headers** | Attach `X-CloudClaw-Key`, `X-Cloudstick-Account-Id`, `X-Cloudstick-Plan` on every request. |
| **Plan gating** | Check user's plan *before* calling Cloud-Claw. Return a clear error if not on a qualifying plan. |
| **Slack OAuth page** | Dashboard settings → "Connect Slack" button → Slack OAuth → `POST /api/slack/link`. |
| **Environment config** | Store `CLOUDSTICK_GATEWAY_KEY` securely server-side. Never expose to browser. |

---

## Files Touched (Cloud-Claw side)

| File | Change |
|---|---|
| `src/interfaces/http_gateway.ts` | **New** — HTTP API, SSE streaming, HITL approve endpoint |
| `src/health.ts` | Extend to mount gateway routes alongside `/health` |
| `src/services/user_service.ts` | Add `getUserByCloudstickAccountId()`, plan tier upsert |
| `src/database/schema.sql` | 4 new columns + index on `users` table |
| `src/interfaces/slack.ts` | Remove single-user whitelist, add multi-tenant DB lookup |
| `src/agents/tool_guard.ts` | Plan-tier SSH call rate limits in `preToolGuard()` |
| `src/config/env.ts` | Add `CLOUDSTICK_GATEWAY_KEY` to Zod schema |
| `src/index.ts` | Mount HTTP gateway on startup |

**Untouched:** `loop.ts`, `hallucination_guard.ts`, all tools, HITL resume logic — agent core is unchanged.

---

## Build Sequence

| Week | Cloud-Claw | Cloudstick Devs |
|---|---|---|
| 1 | Piece 1: HTTP gateway + SSE stream | Start widget against live endpoint |
| 2 | Piece 2: User provisioning + DB migration | Backend proxy + auth headers |
| 3 | Piece 3: Slack linking + multi-tenant Slack | Slack OAuth settings page |
| 4 | Piece 4: Plan-tier rate limiting | Integration testing end-to-end |

---

## Verification Checklist

- `POST /api/chat` with valid headers → `202` + `streamUrl`
- `GET /api/chat/:id/stream` → SSE `chunk` events arrive as agent runs
- `POST /api/chat/:id/approve` with `decision: "approve"` → agent resumes, further chunks arrive
- `POST /api/slack/link` → Slack user ID stored against Cloudstick account in DB
- Slack message from linked user → resolves to same `cloudstick:acc_xxx` session
- Invalid/missing `X-CloudClaw-Key` → `401`
- Missing `X-Cloudstick-Account-Id` or `X-Cloudstick-Plan` → `400`
- SSH calls exceeding plan limit → blocked by `preToolGuard()` with clear error event on SSE stream
- Second dashboard request while at max concurrent sessions → `429 Too Many Requests`
