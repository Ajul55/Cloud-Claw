# Cloud-Claw + Cloudstick — Roadmap

What we built is a solid **Version 1**. This document tracks what comes next to make it production-grade and scalable.

---

## ✅ Pre-Launch Fix — Done

PM2 runs 1 worker (`instances: 1` in `ecosystem.config.cjs`). Memory restart threshold bumped to **1024 MB** (was 512 MB) to give headroom for 10+ concurrent sessions.

**The permanent multi-worker fix** is Phase 5 (Redis pub/sub) — defer until 100+ concurrent active sessions.

---

## Phase 1 — Completed ✅

- Private HTTP gateway with authentication
- HMAC-SHA256 gateway request signing (raw shared-secret bearer header removed)
- Real-time streaming (SSE)
- Auto user creation and plan tracking
- Slack linking and shared sessions
- Plan-tier speed limits (Starter: 10, Pro: 30, Business: 50 server actions)
- Security hardening: body size limit, session isolation, usage endpoint tenant lock, error scrubbing, 5-minute bus timeout
- Approval endpoint returns `202 Accepted` immediately and resumes execution in the background

---

## Phase 2 — Completed ✅

Per-account concurrent session limits. Returns `429 Too Many Requests` when at cap. Counter decrements automatically when a session finishes or times out.

| Plan | Max concurrent sessions |
|---|---|
| Starter | 1 |
| Pro | 3 |
| Business | 10 |

---

## Phase 3 — Completed ✅

SSE reconnect with replay buffer. If Cloud-Claw restarts mid-conversation the client reconnects and replays the last 50 events via `Last-Event-ID`. No lost output on deployment.

---

## Phase 4 — Completed ✅

Usage tracking per account. Every LLM call logged to `usage_log` (tokens in/out, cost, tool name, account ID). Monthly call caps enforced per plan (Starter: 100, Pro: 1000, Business: 10000). Report endpoint: `GET /api/usage/:accountId?period=YYYY-MM`.

---

## Phase 5 — Deferred (not needed yet)

**Trigger:** When sustained concurrent active sessions exceed ~100.

**What it is:** Replace the in-process SSE event bus and session limiter with Redis pub/sub + Redis atomic counters. Allows multiple PM2 workers (or multiple servers) to share state. PostgreSQL LISTEN/NOTIFY is the no-new-infrastructure alternative at lower scale.

**Decision log (2026-04-24):** At current and near-future scale (300–400 registered users, ~20–50 concurrent sessions peak), single-worker Node.js handles load without issue. Phase 5 adds operational complexity for no current benefit. Revisit when monitoring (Phase 6) shows sustained sessions approaching 100.

---

## Phase 6 — Completed ✅

Ops monitoring, alerting, and dashboard health metrics. Built 2026-04-24.

**What was built:**

- **PM2 memory limit** bumped to 1024 MB (was 512 MB)
- **LLM health counter** (`src/telemetry/llm_health.ts`) — tracks consecutive API failures, resets on success
- **Ops alert scheduler** (`src/telemetry/ops_alerts.ts`) — 5-minute cron, posts to a private Slack Incoming Webhook (`SLACK_OPS_WEBHOOK_URL`). Completely separate from the user-facing Slack bot. Four alert conditions:
  - Memory > 800 MB → warning
  - Database unreachable → critical
  - 3+ consecutive LLM API failures → critical
  - Process uptime < 5 min (recent crash) → warning
- **`/health` endpoint** gains `activeSessions` and `pendingApprovals` fields
- **Dashboard stats API** (`/api/stats`) gains a `system` field: `{ activeSessions, memoryMb, uptimeSeconds, llmConsecutiveErrors }`
- **Dashboard UI** — new System Health strip above the burn-rate chart: 4 cards (Active Sessions, Memory, Uptime, LLM Errors) that turn red when thresholds are breached

**Still to do (out of scope for Phase 6):**
- Ship structured logs to an external aggregator (Datadog, Logtail) — the logger already outputs JSON, just pipe stdout when ready
- Alert storm suppression — add a `lastAlertedAt` cooldown if the same alert fires repeatedly
- UptimeRobot setup — free external monitor on `/health`, 5-minute interval (manual, see below)

**UptimeRobot setup (5 minutes, manual):**
1. Create free account at uptimerobot.com
2. Add monitor: HTTP(s), URL `https://<your-server>:9000/health`, interval 5 min
3. Add email/SMS alert contact

**Slack ops channel setup (5 minutes, manual):**
1. Create private `#cloudclaw-ops` channel in your ops Slack workspace
2. Create a Slack app → Incoming Webhooks → add to `#cloudclaw-ops`
3. Add webhook URL to `.env`: `SLACK_OPS_WEBHOOK_URL=https://hooks.slack.com/services/...`

---

## Priority Order

| # | What | Status |
|---|---|---|
| Pre-launch | PM2 single worker + memory limit | ✅ Done |
| Phase 2 | Concurrent session limits | ✅ Done |
| Phase 3 | Crash recovery / SSE reconnect | ✅ Done |
| Phase 4 | Usage tracking + billing report endpoint | ✅ Done |
| Phase 6 | Monitoring + ops alerts | ✅ Done |
| Phase 5 | Redis pub/sub + multi-worker | Deferred — trigger at 100+ concurrent sessions |
