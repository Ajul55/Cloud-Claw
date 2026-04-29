# Cloudstick Integration — Developer Guide

This document is for the **Cloudstick development team**. It covers everything your engineers need to build to connect the Cloudstick dashboard to Cloud-Claw.

> **Scope:** This guide covers the **gateway API** — how Cloudstick's backend calls Cloud-Claw (chat, streaming, approvals, usage). It does not cover the Cloudstick REST API v2 that Cloud-Claw uses internally to manage servers and websites; that is documented in `v2-migration-tracker.md`.

---

## The Big Picture

Cloud-Claw sits on a private server. It never talks to end users directly. **Cloudstick's backend is the only thing that talks to it.**

```
Cloudstick Dashboard (user's browser)
        │
        │  user types a message
        ▼
Cloudstick Backend (your server)
        │
        │  signs the request and calls Cloud-Claw
        ▼
Cloud-Claw (private — only your backend can reach it)
```

Your team builds the bridge. Cloud-Claw handles all the AI, server diagnostics, and approval logic.

---

## How to Authenticate Every Request

> **This changed.** The old approach (sending the key as a plain header) is gone. Every request must now be **signed**.

### What changed and why

Previously the guide said: send `X-CloudClaw-Key: <secret>` as a header. That is no longer how it works.

Now, your backend signs each request using **HMAC-SHA256**. This proves the request came from you and hasn't been tampered with. It also includes a timestamp so old/replayed requests are automatically rejected.

### The three steps to sign a request

**Step 1 — Get the current time**
```
timestamp = new Date().toISOString()
// e.g. "2026-04-27T10:30:00.000Z"
```

**Step 2 — Build the message to sign**
```
payload = METHOD + "\n" + PATH + "\n" + timestamp + "\n" + rawBody

// Example for POST /api/chat:
payload = "POST\n/api/chat\n2026-04-27T10:30:00.000Z\n{\"message\":\"nginx is down\"}"

// Example for GET requests (no body — use empty string):
payload = "GET\n/api/usage/acc_123\n2026-04-27T10:30:00.000Z\n"
```

**Step 3 — Create the HMAC and send the headers**
```
signature = HMAC-SHA256(key: CLOUDSTICK_GATEWAY_KEY, message: payload)
```

> The key (`CLOUDSTICK_GATEWAY_KEY`) is a 64-character hex string. Use it as raw bytes — decode from hex before passing to HMAC.

**Send these headers on every request:**
```
X-Cloudstick-Account-Id: acc_123          ← your internal user/account ID
X-Cloudstick-Plan: starter                ← "starter", "pro", or "business"
X-Cloudclaw-Timestamp: 2026-04-27T10:30:00.000Z
X-Cloudclaw-Signature: sha256=<64-char hex>
```

> **Important:** Read the plan from your database, not from the user's browser. Cloud-Claw trusts whatever plan you send — if you send `business` for a starter user, they get business-tier limits.

### Quick Node.js example
```js
const crypto = require('crypto');

function signRequest(method, path, body, gatewayKeyHex) {
  const timestamp = new Date().toISOString();
  const payload = `${method}\n${path}\n${timestamp}\n${body}`;
  const signature = crypto
    .createHmac('sha256', Buffer.from(gatewayKeyHex, 'hex'))
    .update(payload)
    .digest('hex');
  return { timestamp, signature: `sha256=${signature}` };
}
```

---

## What happens if the signature is wrong?

Cloud-Claw checks:
- Are both `X-Cloudclaw-Timestamp` and `X-Cloudclaw-Signature` present? If not → **401**
- Is the timestamp within 5 minutes of now? If not → **401** (prevents replay attacks)
- Does the signature match? If not → **401**

If your backend clock is drifting by more than 5 minutes, requests will start failing. Keep your server clock synced (NTP).

---

## API Reference

### POST /api/chat — Send a message

**Request headers:** All four required headers (see above)

**Request body:**
```json
{ "message": "nginx is throwing 502 errors" }
```
- `message` must be between 1 and **4000 characters**

**Response (202 Accepted):**
```json
{ "sessionId": "cloudstick:acc_123", "streamUrl": "/api/chat/cloudstick:acc_123/stream" }
```

The response comes back immediately. The AI starts working in the background. Open the `streamUrl` to receive the response as it types.

**Possible errors:**
| Status | Error code | What it means |
|---|---|---|
| 400 | — | Missing `X-Cloudstick-Account-Id` or invalid plan header |
| 400 | — | Message is empty or longer than 4000 characters |
| 401 | — | Bad or missing signature / timestamp |
| 429 | `RATE_LIMITED` | Too many requests this minute (see rate limits below) |
| 429 | `TOO_MANY_SESSIONS` | User already has the max concurrent sessions for their plan |
| 429 | `MONTHLY_CAP_REACHED` | User has hit their monthly AI call limit |

---

### GET /api/chat/:sessionId/stream — Receive the live response (SSE)

This is a **Server-Sent Events** stream. Your backend keeps this connection open and forwards each event to the user's browser.

**Required headers:** `X-Cloudstick-Account-Id` + the two signature headers

> Cloud-Claw now checks that the `X-Cloudstick-Account-Id` matches the session — a user cannot eavesdrop on someone else's session.

**Events:**

| Event | Example payload | What to do |
|---|---|---|
| `chunk` | `{ "text": "Checking nginx..." }` | Append text to the chat window |
| `approval_required` | `{ "approvalId": 42, "action": "fix_nginx_config", "host": "prod-1", "rationale": "..." }` | Show Approve and Reject buttons |
| `done` | `{ "text": "" }` | AI finished — close the stream, re-enable the input |
| `error` | `{ "message": "..." }` | Something went wrong — show an error message |

**Each event also has an `id:` field.** Use this for reconnection (see below).

**Example stream:**
```
id: cloudstick:acc_123:1
event: chunk
data: {"text":"Checking nginx configuration on prod-1..."}

id: cloudstick:acc_123:2
event: chunk
data: {"text":" Found a syntax error on line 42."}

id: cloudstick:acc_123:3
event: approval_required
data: {"approvalId":7,"action":"fix_nginx_config","host":"prod-1","rationale":"Fixing the upstream block syntax error"}

id: cloudstick:acc_123:4
event: done
data: {"text":""}
```

**Reconnecting after a drop:**  
Send the `Last-Event-Id` header with the last `id` you received. Cloud-Claw will replay any events you missed (kept for up to 5 minutes):
```
Last-Event-Id: cloudstick:acc_123:2
```

---

### POST /api/chat/:sessionId/approve — Submit an approval decision

When the user clicks Approve or Reject on an `approval_required` event.

**Required headers:** `X-Cloudstick-Account-Id` + the two signature headers

**Request body:**
```json
{ "approvalId": 7, "decision": "approve" }
```
Or to reject with a reason:
```json
{ "approvalId": 7, "decision": "reject", "reason": "Not the right time" }
```

**Response (202 Accepted):**
```json
{ "ok": true, "status": "accepted" }
```

After an approval, more `chunk` events will arrive on the still-open stream as the AI continues.

---

### POST /api/slack/link — Connect a user's Slack account

Call this once after a user completes the Slack OAuth flow in your dashboard settings.

**Required headers:** `X-Cloudstick-Account-Id` + the two signature headers

**Request body:**
```json
{ "slackUserId": "U12345ABC", "slackWorkspaceId": "T09876XYZ" }
```

**Response:** `200 { "linked": true }`

After this, messages from Slack and from the dashboard share the same conversation history.

**Error responses:**
- `409` — This Slack user ID is already linked to a different account

---

### GET /api/usage/:accountId — Check usage for billing

> **New endpoint.** Use this to show users how many AI calls they've made this month (for billing dashboards or plan upgrade prompts).

**Required headers:** `X-Cloudstick-Account-Id` (must match `:accountId` in the URL) + the two signature headers

**Optional query parameter:** `?period=2026-04` (defaults to the current month)

**Response:**
```json
{
  "accountId": "acc_123",
  "period": "2026-04",
  "llmCalls": 47,
  "tokensIn": 12400,
  "tokensOut": 8300,
  "costUsd": 0.23,
  "serverActions": 12
}
```

| Field | What it means |
|---|---|
| `llmCalls` | How many times the AI was called this month |
| `tokensIn` | Words/tokens sent to the AI |
| `tokensOut` | Words/tokens the AI wrote back |
| `costUsd` | Our cost (you can use this to check against your billing) |
| `serverActions` | How many times the AI ran a command on a server |

---

## Rate Limits

Cloud-Claw enforces rate limits **per account** based on plan:

| Plan | Max requests per minute |
|---|---|
| Starter | 10 |
| Pro | 30 |
| Business | 60 |

If the limit is hit, you get:
```json
{ "error": "RATE_LIMITED", "message": "Too many requests. Limit: 10 req/min." }
```

Show the user a friendly message and retry after 60 seconds.

---

## What Your Team Needs to Build

| # | What to build | Who builds it |
|---|---|---|
| 1 | Store `CLOUDSTICK_GATEWAY_KEY` (64-char hex) securely on your server — never in frontend code | Backend |
| 2 | A signing helper that generates `X-Cloudclaw-Timestamp` and `X-Cloudclaw-Signature` for every request | Backend |
| 3 | Backend proxy that forwards signed requests to Cloud-Claw with the right headers | Backend |
| 4 | Chat widget UI that streams responses and shows Approve/Reject buttons | Frontend |
| 5 | Plan check before calling Cloud-Claw (block users not on a qualifying plan) | Backend |
| 6 | Handle 429 errors gracefully (rate limit, session busy, monthly cap) | Frontend + Backend |
| 7 | "Connect Slack" settings page + Slack OAuth flow | Frontend + Backend |
| 8 | After Slack OAuth, call `POST /api/slack/link` with the user's Slack ID | Backend |
| 9 | *(Optional)* Call `GET /api/usage/:accountId` to show usage stats on billing pages | Backend |

---

## What You Do NOT Need to Build

- Any AI logic
- Session management
- Server diagnostics or fix tools
- Human-in-the-loop approval logic
- Slack bot (Cloud-Claw handles the Slack bot side)

---

## Chat Widget — Frontend Checklist

The widget in your dashboard needs to:

- [ ] Show a text input where the user types their message (max 4000 characters)
- [ ] Send the message to **your backend** (not directly to Cloud-Claw — your backend holds the signing key)
- [ ] Open the `streamUrl` and display chunks as they arrive, word by word
- [ ] When an `approval_required` event arrives, show an **Approve** and **Reject** button
- [ ] When the user clicks Approve or Reject, POST to `/api/chat/:sessionId/approve` via your backend
- [ ] On `done` or `error` event, close the stream and re-enable the input box
- [ ] If the stream disconnects unexpectedly, retry connecting to the same `streamUrl` after 2–3 seconds, sending `Last-Event-Id` with the last event ID you received
- [ ] Show a friendly message if a 429 rate-limit error comes back

---

## Backend Proxy — Step-by-Step Flow

```
1. User sends message from the chat widget to your backend
2. Your backend checks the user's plan (block if not on a qualifying plan)
3. Your backend signs the request (timestamp + HMAC-SHA256 signature)
4. Your backend POSTs to Cloud-Claw /api/chat with all required headers
5. Cloud-Claw returns { sessionId, streamUrl } — store sessionId for this conversation
6. Your backend opens the streamUrl (with signed headers) and relays each SSE event to the user's browser
7. When user clicks Approve/Reject, your backend signs and POSTs to /api/chat/:sessionId/approve
```

---

## Environment Variable to Set

| Variable | Description |
|---|---|
| `CLOUDSTICK_GATEWAY_KEY` | 64-character hex string — the shared signing secret. Generate once and share securely with Cloud-Claw. |

Generate a key:
```bash
openssl rand -hex 32
```
