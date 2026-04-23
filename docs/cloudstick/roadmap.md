# Cloud-Claw + Cloudstick — Roadmap

What we built is a solid **Version 1**. This document tracks what comes next to make it production-grade and scalable.

---

## ⚠️ Pre-Launch Fix Required (Do This Before Going Live)

**The problem:** Cloud-Claw currently runs as 2 Node.js workers sharing one port (PM2 cluster mode). The live-streaming system stores each session's event channel in the worker's own memory. If a user's "send message" request lands on Worker 1 but their "receive stream" request lands on Worker 2, the stream hangs silently — the wrong worker answers.

**The fix (5 minutes):** In `ecosystem.config.cjs`, change:
```js
instances: 2  →  instances: 1
```

**The permanent fix** is Phase 5 (Redis pub/sub), which lets multiple workers share the event bus.

---

## Phase 1 — Completed ✅

- Private HTTP gateway with authentication
- Real-time streaming (SSE)
- Auto user creation and plan tracking
- Slack linking and shared sessions
- Plan-tier speed limits (Starter: 10, Pro: 30, Business: 50 server actions)
- Security hardening: body size limit, session isolation, error scrubbing, 5-minute bus timeout

---

## Phase 2 — Concurrent Session Limits

**What it is:** Right now, if 100 Cloudstick users all start chatting at the same moment, all 100 sessions run simultaneously. Each plan should have a cap on how many active sessions can run at once. If a user hits the cap, they get a clear "please wait" message.

**Why it matters:** Without this, a single Pro account could open 50 browser tabs and use 50× the resources.

**What needs to be built:**
- A counter tracking how many sessions are actively running per account
- Return `429 Too Many Requests` with a clear message when the limit is reached
- Automatically decrement the counter when a session finishes or times out

**Proposed limits:**

| Plan | Max concurrent sessions |
|---|---|
| Starter | 1 |
| Pro | 3 |
| Business | 10 |

---

## Phase 3 — Crash Recovery and Stream Reconnect

**What it is:** If Cloud-Claw restarts mid-conversation (e.g. during a deployment), the user's open SSE stream disconnects. The client should be able to reconnect and pick up where things left off.

**Why it matters:** A crash mid-task loses the stream. In production, users will notice.

**What needs to be built:**
- Reconnect logic on the Cloudstick frontend — retry the stream URL after 2–3 seconds if the connection drops
- A "replay last event" mechanism so users don't see a blank screen on reconnect

---

## Phase 4 — Usage Tracking Per Account

**What it is:** Track how many AI calls, token usage, and server actions each Cloudstick account uses per month.

**Why it matters:** Without this, you cannot charge per usage or spot accounts using far more than they pay for.

**What needs to be built:**
- Log each Cloud-Claw session to the existing `usage_log` table (partially done)
- Build a report endpoint Cloudstick can call to get usage per account per billing period
- Set hard monthly caps per plan if needed

**Cost estimate (MiniMax 2.5, 20 servers troubleshooting daily):**
~$13–20/month in API costs. The biggest variable is how much log output the AI reads — large log files inflate input token counts quickly. After the first week, check:
```sql
SELECT SUM(prompt_tokens), SUM(cost_usd) FROM usage_log;
```

---

## Phase 5 — Horizontal Scaling + Job Queue

**What it is:** Run multiple Cloud-Claw servers behind a load balancer. This phase also adds a job queue so in-progress diagnoses survive a server restart.

**Why it matters:** A single machine has a ceiling. When Cloudstick has hundreds of active users, one server will not be enough. Without a job queue, a server restart during a live diagnosis silently loses that session.

**What needs to be built:**
- Add **Redis** to the infrastructure (one Redis instance serves both purposes below)
- Move the SSE event bus from in-process memory to **Redis pub/sub** — any Cloud-Claw worker can send events to any open stream. This also re-enables the 2-worker PM2 setup
- Add **BullMQ** (runs on the same Redis) as a job queue — each chat session becomes a persisted job that survives restarts and retries failed LLM calls automatically

**Note on the job queue:** A queue is not needed now — Node.js async handles 20–50 concurrent sessions easily without one. The reason to add it alongside Redis is that BullMQ runs on Redis — once Redis is in, the queue comes at almost no extra cost and gives you crash recovery and retry logic for free.

---

## Phase 6 — Monitoring and Alerts

**What it is:** Visibility into how the system is behaving in production.

**Why it matters:** You will not know something is wrong unless you are watching.

**What needs to be built:**
- Structured logging (currently logs to console — needs shipping to a log aggregator)
- A dashboard showing active sessions, approval queue depth, error rate
- Alerts when the error rate spikes or the approval queue grows stale
- Uptime monitoring on `/health` (UptimeRobot free tier is sufficient to start)

---

## Priority Order

| # | What | Effort | When |
|---|---|---|---|
| **Pre-launch** | Drop PM2 to 1 worker (`instances: 1` in `ecosystem.config.cjs`) | 5 minutes | **Right now — blocks streaming** |
| Phase 2 | Concurrent session limits (429 when at cap) | 1–2 days | Before public launch |
| Phase 3 | Crash recovery / SSE reconnect | 2–3 days | Before public launch |
| Phase 4 | Usage tracking + billing report endpoint | 2–3 days | Needed for billing |
| Phase 5 | Redis (SSE pub/sub + BullMQ job queue) + 2nd worker | 1–2 weeks | When user count exceeds ~50 concurrent |
| Phase 6 | Monitoring + alerts | 1 week | Alongside Phase 4–5 |
