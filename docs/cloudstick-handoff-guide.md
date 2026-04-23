# Cloudstick + Cloud-Claw: Plain English Guide

---

## Part 1 — What We Just Built (The Simple Version)

Think of **Cloud-Claw** as a smart assistant that can look at your servers, spot problems, and fix them. It already worked over Slack and Telegram. What we just built is a **door** that lets Cloudstick's system talk to it directly.

Here is what was built, in plain words:

---

### 1. A Private Doorway (HTTP Gateway)

We created a set of URLs (called an API) that Cloudstick's backend can call:

| What it does | How it works |
|---|---|
| **Send a message** | Cloudstick calls us with a user's question ("nginx is down") |
| **Get a live response** | We stream the AI's answer back word-by-word in real time |
| **Approve a dangerous action** | If the AI wants to change something on a server, the user gets an Approve/Reject button |
| **Link a Slack account** | A user can connect their Slack to their Cloudstick account so both use the same conversation history |

---

### 2. A Lock on the Door (Security)

Cloudstick's backend holds a secret password (64 characters, called `CLOUDSTICK_GATEWAY_KEY`). Every message they send must include this password. If it is wrong or missing, we reject the request immediately. **This password must never be shared with or visible to end users.**

---

### 3. User Accounts (Auto-Created)

When a Cloudstick business user chats for the first time, we automatically create an account for them on our side. We also store which plan they are on (Starter, Pro, or Business) so we can apply the right limits.

---

### 4. Speed Limits by Plan

Each plan gets a different number of server actions per conversation:

| Plan | Max server actions per chat |
|---|---|
| Starter | 10 |
| Pro | 30 |
| Business | 50 |

If a user hits their limit, the AI stops and summarises what it found so far.

---

### 5. Shared Conversation (Slack + Dashboard)

A Cloudstick business user who connects their Slack account will share the **same conversation history** whether they chat from the dashboard or from Slack. The AI remembers the full context either way.

---

### 6. What Is Ready for Production?

Everything above is built and tested. To go live, only two things are needed:

1. **Run the database migration** — a script that adds 5 new columns to our existing database table (takes about 1 second).
2. **Set the environment variable** — add `CLOUDSTICK_GATEWAY_KEY=<64-char secret>` to the server config and restart Cloud-Claw.

After that, the gateway is live on the same port we already use for health checks (port 9000).

---

### 7. Security Model

The gateway is designed for **server-to-server communication only** — Cloudstick's backend calls Cloud-Claw's backend. The security model relies on:

| Protection | How it works |
|---|---|
| **Shared secret** | Every request must include the 64-char `CLOUDSTICK_GATEWAY_KEY` header. No key = instant 401. |
| **Session isolation** | Sessions are always keyed as `cloudstick:<account_id>`. A user cannot access another account's session. |
| **Body size limit** | Requests larger than 50 KB are rejected — prevents memory flood attacks. |
| **Stream timeout** | If the AI takes longer than 5 minutes, the session is automatically closed. |
| **Error scrubbing** | Internal error details (database messages, stack traces) are never sent to the API caller. |

**What Cloudstick is responsible for:**
- Storing the gateway key only on your backend server (never in frontend code or browser)
- Sending the correct plan tier for each user — Cloud-Claw enforces limits based on what you report
- Plan-gating users before calling Cloud-Claw (block users not on a qualifying plan)

**What Cloud-Claw protects against:**
- Unauthenticated access (401 on every request without the key)
- Session cross-contamination between accounts
- Memory exhaustion from oversized requests or hung sessions
- Internal infrastructure details leaking to callers

---

## Part 2 — What Cloudstick Devs Need to Build

This is the message you can share directly with the Cloudstick development team.

---

### The Big Picture

Cloud-Claw is ready. It is waiting at a private URL your backend will call. Your team needs to build **the bridge between your users and Cloud-Claw**. Here is everything your team needs to do:

---

### Task 1 — Store the Shared Secret Safely

We will give you one secret key (`CLOUDSTICK_GATEWAY_KEY`, 64 characters). Store it **only on your backend server**, never in your frontend code or browser. Every request your backend sends to Cloud-Claw must include this key in a header.

---

### Task 2 — Build a Backend Proxy

When a user sends a message from the chat widget:

1. Your backend receives it
2. Your backend checks if the user is on a qualifying plan (this is your check, not ours)
3. Your backend forwards the message to Cloud-Claw with these three headers:

```
X-CloudClaw-Key: <the shared secret>
X-Cloudstick-Account-Id: <your internal user/account ID>
X-Cloudstick-Plan: starter   ← or "pro" or "business"
```

4. Cloud-Claw replies with a `streamUrl`
5. Your backend opens that URL and relays the live stream back to the user's browser

---

### Task 3 — Build the Chat Widget (Frontend)

The widget in your dashboard needs to:

- Show a text input box where the user types their message
- Send the message to **your backend** (not directly to Cloud-Claw — your backend holds the secret)
- Display the AI's response as it arrives, word by word (we stream it)
- When the AI wants to do something risky (like restart a service), show an **Approve** and **Reject** button
- When the user clicks Approve or Reject, tell your backend, which then tells Cloud-Claw

---

### Task 4 — Build a "Connect Slack" Settings Page

In your dashboard settings, add a **"Connect Slack"** button. When a user clicks it:

1. Start a standard Slack OAuth flow (Slack Login)
2. After the user authorises it, you get their Slack User ID
3. Send us a one-time call:

```
POST /api/slack/link
with: { slackUserId: "U12345", slackWorkspaceId: "T09876" }
```

After that, if the same user sends a message from Slack, their conversation history is shared with the dashboard automatically.

---

### Summary Table for Cloudstick Devs

| # | What to build | Who does it |
|---|---|---|
| 1 | Store `CLOUDSTICK_GATEWAY_KEY` securely on your server | Cloudstick backend |
| 2 | Backend proxy that forwards messages to Cloud-Claw with the right headers | Cloudstick backend |
| 3 | Chat widget UI that streams responses and shows Approve/Reject buttons | Cloudstick frontend |
| 4 | Plan check before calling Cloud-Claw (block users not on a qualifying plan) | Cloudstick backend |
| 5 | "Connect Slack" settings page + Slack OAuth flow | Cloudstick frontend + backend |
| 6 | After Slack OAuth, call `POST /api/slack/link` with the user's Slack ID | Cloudstick backend |

---

### What You Do NOT Need to Worry About

Cloudstick does **not** need to build:
- Any AI logic
- Session management
- Server diagnostics or fix tools
- Human-in-the-loop approval logic
- Slack bot (we handle the Slack bot side)

All of that is already inside Cloud-Claw.

---

### Important Notes on the Plan Tier Header

When your backend calls Cloud-Claw, you send `X-Cloudstick-Plan: starter` (or pro or business). **Cloud-Claw trusts this value completely** — it uses it to set the AI's action limits for that session.

This means:
- ✅ If you send the correct plan, the right limits apply
- ⚠️ If you accidentally send `business` for a starter user, they get business-tier limits
- ⚠️ You are responsible for sending the correct plan tier on every request

**Recommendation:** Read the plan from your database (not from the user's browser) before calling Cloud-Claw.

---

## Part 3 — Phases We Still Need for a Fully Scalable AI Agent

What we built is a solid **Version 1**. Here are the phases that would make it production-grade at scale:

---

### ⚠️ Pre-Launch Fix Required — PM2 Workers (Do This Before Going Live)

**The problem:** Cloud-Claw currently runs as 2 Node.js workers on the same server sharing one port (PM2 cluster mode). The live-streaming system (SSE) stores each session's event channel in the worker's own memory. If a user's "send message" request lands on Worker 1 but their "receive stream" request lands on Worker 2, the stream hangs silently — Worker 2 has no channel for that session.

**The fix (5 minutes):** In `ecosystem.config.cjs`, change `instances: 2` to `instances: 1` until the Redis upgrade (Phase 5) is done.

**The permanent fix** is Phase 5 below (Redis pub/sub).

---

### Phase 1 — What We Just Finished ✅

- Private HTTP gateway with authentication
- Real-time streaming (SSE)
- Auto user creation and plan tracking
- Slack linking and shared sessions
- Plan-tier speed limits
- Security hardening: body size limit, session isolation, error scrubbing, bus timeout

---

### Phase 2 — Concurrent Session Limits (Next Priority)

**What it is:** Right now, if 100 Cloudstick users all start chatting at the same moment, all 100 sessions run simultaneously. The spec says each plan has a cap on how many active sessions can run at once (Starter: 1, Pro: 3, Business: 10). If a user hits the cap, they should get a clear "please wait" message instead of starting a new session.

**Why it matters:** Without this, a single Pro account could open 50 browser tabs and use 50× the resources.

**What needs to be built:**
- A counter that tracks how many sessions are actively running per account
- Return `429 Too Many Requests` when the limit is reached
- Automatically decrement the counter when a session finishes
- Gateway-level request throttle: limit each account to N concurrent active sessions (not just SSH calls)

---

### Phase 3 — Reliability and Crash Recovery

**What it is:** If Cloud-Claw restarts mid-conversation (e.g. during a deployment), the user's open SSE stream disconnects. The client should be able to reconnect and pick up where things left off.

**Why it matters:** Right now a crash mid-task loses the stream. In production, users will notice.

**What needs to be built:**
- Reconnect logic on the Cloudstick frontend (retry the stream URL after a pause)
- A "replay last event" mechanism so users don't see a blank screen on reconnect

---

### Phase 4 — Usage Tracking Per Cloudstick Account

**What it is:** Track how many AI calls, token usage, and server actions each Cloudstick account uses per month. This feeds into billing and abuse detection.

**Why it matters:** Without this, you cannot charge per usage or spot accounts that are using far more than they pay for.

**What needs to be built:**
- Log each Cloud-Claw session to a usage table (already partially done — we have a `usage_log` table)
- Build a report endpoint Cloudstick can call to get usage per account per billing period
- Set hard monthly caps per plan if needed

---

### Phase 5 — Horizontal Scaling + Job Queue (Running Multiple Copies)

**What it is:** Right now Cloud-Claw runs as a single Node.js worker. If traffic grows large, you need to run more copies across multiple servers. This phase also adds a proper job queue so in-progress diagnoses survive a server restart.

**Why it matters:** A single machine has a ceiling. When Cloudstick has thousands of active users, one server will not be enough. Without a job queue, any server restart during a live diagnosis silently loses that session.

**What needs to be built:**
- Add Redis to the infrastructure (one Redis instance serves both purposes below)
- Move the SSE event bus from in-process memory to Redis pub/sub, so any Cloud-Claw worker can send events to any open stream — this also re-enables the 2-worker PM2 setup
- Add BullMQ (runs on the same Redis) as a job queue: each chat session becomes a persisted job that survives restarts and retries failed LLM calls automatically
- Ensure session locking works correctly when multiple workers handle requests for the same account

**Note on job queues:** A queue is not needed now (Node.js async handles 20–50 concurrent sessions easily without one). The reason to add it alongside Redis is that BullMQ runs on Redis — once Redis is in, the queue comes at almost no extra cost and gives you crash recovery and retry logic for free.

---

### Phase 6 — Monitoring and Alerts

**What it is:** Visibility into how the system is behaving in production — errors, slow responses, rate limit hits, approval queue backlogs.

**Why it matters:** You will not know something is wrong unless you are watching.

**What needs to be built:**
- Structured logging (we already log to console — needs shipping to a log aggregator)
- A dashboard showing active sessions, approval queue depth, error rate
- Alerts when the error rate spikes or the approval queue grows stale

---

### Priority Order

| # | What | Effort | When |
|---|---|---|---|
| **Pre-launch** | Drop PM2 to 1 worker (`instances: 1` in ecosystem.config.cjs) | 5 minutes | **Right now — blocks streaming** |
| Phase 2 | Concurrent session limits (429 when at cap) | 1–2 days | Before public launch |
| Phase 3 | Crash recovery / SSE reconnect | 2–3 days | Before public launch |
| Phase 4 | Usage tracking + billing report endpoint | 2–3 days | Needed for billing |
| Phase 5 | Redis (SSE pub/sub + BullMQ job queue) + 2nd worker | 1–2 weeks | When user count grows beyond ~50 concurrent |
| Phase 6 | Monitoring + alerts | 1 week | Run alongside Phase 4–5 |

**Cost guidance (MiniMax 2.5, 20 servers troubleshooting daily):** Estimated $13–20/month in API costs. The biggest variable is how much log output the AI reads per session — large log files inflate input token counts quickly. Check `SELECT SUM(prompt_tokens), SUM(cost_usd) FROM usage_log` after the first week to get a real number.
