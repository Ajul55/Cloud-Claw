# Phase 6 — Monitoring & Alerts Design

**Date:** 2026-04-24
**Scope:** Ops alerting via Slack webhook, dashboard health metrics, memory limit bump, UptimeRobot setup.

---

## 1. Quick Fixes

### Memory limit bump
In `ecosystem.config.cjs`, change `max_memory_restart` from `512M` → `1024M`.
Rationale: each active LLM session uses ~50–100 MB. At 10+ concurrent sessions the current limit causes unnecessary restarts.

### UptimeRobot (manual setup)
Configure UptimeRobot free tier to ping `GET /health` every 5 minutes.
- Returns `200` when healthy, `503` when DB is disconnected.
- UptimeRobot sends email/SMS on non-200. No code changes required.
- Document setup steps in `docs/cloudstick/ops-runbook.md`.

---

## 2. Health Endpoint Additions

`GET /health` (`src/health.ts`) gains two new fields:

```json
{
  "status": "ok",
  "db": "connected",
  "uptime": 3600,
  "memory": "245MB",
  "activeSessions": 3,
  "pendingApprovals": 0
}
```

- `activeSessions` — read from `getActiveSessions` totalled across all accounts, or a new `getTotalActiveSessions()` export from `session_limiter.ts`.
- `pendingApprovals` — DB query `SELECT COUNT(*) FROM approval_queue WHERE status = 'pending'`. Omitted (returns 0) when DB is not configured.

---

## 3. Ops Alert System

### New file: `src/telemetry/ops_alerts.ts`

Single responsibility: format and deliver ops alerts to a private Slack channel via an Incoming Webhook. Completely separate from the user-facing Slack bot (`SLACK_BOT_TOKEN`).

**Environment variable:** `SLACK_OPS_WEBHOOK_URL` (optional — alerting is silently skipped if unset, app boots normally without it).

**Exported API:**
```ts
sendOpsAlert(title: string, message: string, severity: 'warning' | 'critical'): Promise<void>
startAlertScheduler(): void
```

**`sendOpsAlert`:** POSTs a Slack Block Kit message to `SLACK_OPS_WEBHOOK_URL` using Node's native `https` module. No new dependencies. Color-codes by severity (yellow = warning, red = critical).

**`startAlertScheduler`:** Registers a `node-cron` job running every 5 minutes. Checks four conditions:

| Condition | Threshold | Severity | Message |
|---|---|---|---|
| Memory high | RSS > 800 MB | warning | "Memory at XMB — approaching restart threshold (1024MB)" |
| DB unreachable | `SELECT 1` fails | critical | "Database connection lost — all sessions will fail" |
| LLM API failing | Consecutive failure counter ≥ 3 | critical | "LLM API returning X consecutive errors — check provider status" |
| Recent crash | `process.uptime()` < 300s on cron tick | warning | "Cloud-Claw restarted X minutes ago — check PM2 logs" |

### LLM failure counter

New module: `src/telemetry/llm_health.ts`

Exports:
```ts
recordLlmSuccess(): void
recordLlmFailure(): void
getConsecutiveLlmFailures(): number
```

In-memory counter. `recordLlmSuccess()` resets to 0. `recordLlmFailure()` increments. Called from `src/agents/loop.ts` around the LLM API call (`openai.chat.completions.create`, line ~784).

Alert scheduler reads `getConsecutiveLlmFailures()` — fires alert when ≥ 3.

### Wiring in `src/index.ts`

`startAlertScheduler()` called once at startup alongside `startApprovalWorker()`. Logs a startup message if `SLACK_OPS_WEBHOOK_URL` is not set so ops knows alerting is inactive.

---

## 4. Dashboard Additions

### Backend: `/api/stats` response

`src/dashboard/queries.ts` — `StatsResult` gains a `system` field:

```ts
system: {
  activeSessions: number;   // from session_limiter
  memoryMb: number;         // process.memoryUsage().rss / 1024 / 1024
  uptimeSeconds: number;    // process.uptime()
  llmConsecutiveErrors: number; // from llm_health counter
}
```

These are process-level values, not DB queries — they are always available regardless of DB state.

### Frontend: System Health strip

New component: `dashboard/src/components/SystemHealthStrip.tsx`

Four stat cards rendered above the existing burn rate chart in `App.tsx`:

| Card | Value | Turns red when |
|---|---|---|
| Active Sessions | live count | > 20 |
| Memory | X MB | > 800 MB |
| Uptime | Xh Xm | < 10 min |
| LLM Errors | consecutive count | > 0 |

The strip reuses the existing `StatCard` component. No changes to any existing dashboard components.

---

## 5. Files Changed

| File | Change |
|---|---|
| `ecosystem.config.cjs` | `max_memory_restart: '512M'` → `'1024M'` |
| `src/health.ts` | Add `activeSessions` + `pendingApprovals` to response |
| `src/services/session_limiter.ts` | Export `getTotalActiveSessions()` |
| `src/telemetry/llm_health.ts` | **New** — LLM failure counter |
| `src/telemetry/ops_alerts.ts` | **New** — Slack webhook alert sender + scheduler |
| `src/agents/loop.ts` | Call `recordLlmSuccess/Failure` around API calls (~line 784) |
| `src/config/env.ts` | Add `SLACK_OPS_WEBHOOK_URL` (optional) |
| `src/index.ts` | Call `startAlertScheduler()` at startup |
| `src/dashboard/queries.ts` | Add `system` field to `StatsResult` and `fetchStats` |
| `dashboard/src/components/SystemHealthStrip.tsx` | **New** — 4 health stat cards |
| `dashboard/src/App.tsx` | Mount `SystemHealthStrip` above burn rate chart |

---

## 6. Out of Scope

- Log shipping to external aggregator (Datadog, Logtail) — the structured logger already outputs JSON; pipe stdout to any aggregator with no code changes when ready.
- Email alerts — add later if Slack webhook misses are a concern.
- Approval queue stale alerts — approvals are user-driven; session timeout handles cleanup.
