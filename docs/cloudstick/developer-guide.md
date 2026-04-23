# Cloudstick Integration — Developer Guide

This document is for the **Cloudstick development team**. It covers everything your engineers need to build to connect the Cloudstick dashboard to Cloud-Claw.

---

## The Big Picture

Cloud-Claw is ready. It is waiting at a private URL your backend will call. Your team needs to build **the bridge between your users and Cloud-Claw**.

```
Cloudstick Dashboard (browser)
        │
        │  your frontend sends message to your backend
        ▼
Cloudstick Backend
        │
        │  POST /api/chat          ← forward the user's message
        │  GET  /api/chat/:id/stream  ← relay the live AI response
        │  Header: X-CloudClaw-Key: <shared secret>
        ▼
Cloud-Claw (private — never exposed to the browser)
```

---

## Authentication Headers

Every request your backend sends to Cloud-Claw must include these three headers:

```
X-CloudClaw-Key: <the shared secret>
X-Cloudstick-Account-Id: <your internal user/account ID>
X-Cloudstick-Plan: starter        ← or "pro" or "business"
```

> **Important:** Read the plan from your database, not from the user's browser. Cloud-Claw trusts whatever plan you send — if you send `business` for a starter user, they get business-tier limits.

---

## API Reference

### POST /api/chat — Send a message

**Request:**
```json
{ "message": "nginx is throwing 502" }
```

**Response:**
```json
{ "sessionId": "cloudstick:acc_123", "streamUrl": "/api/chat/cloudstick:acc_123/stream" }
```

The response comes back immediately (202 Accepted). The AI starts working in the background. Open the `streamUrl` to receive the response as it arrives.

---

### GET /api/chat/:sessionId/stream — Receive the live response (SSE)

This is a Server-Sent Events stream. Keep it open and read events as they arrive:

| Event | Payload | What it means |
|---|---|---|
| `chunk` | `{ "text": "Checking nginx..." }` | A piece of the AI's response — append to the chat window |
| `approval_required` | `{ "approvalId": 42, "action": "fix_nginx_config", "host": "prod-1", "rationale": "..." }` | AI wants to make a change — show Approve/Reject buttons |
| `done` | `{ "text": "" }` | AI finished — close the stream |
| `error` | `{ "message": "..." }` | Something went wrong — show an error message |

**Example stream output:**
```
event: chunk
data: {"text":"Checking nginx configuration on prod-1..."}

event: chunk
data: {"text":" Found a syntax error on line 42."}

event: approval_required
data: {"approvalId":7,"action":"fix_nginx_config","host":"prod-1","rationale":"Fixing the upstream block syntax error"}

event: done
data: {"text":""}
```

---

### POST /api/chat/:sessionId/approve — Submit an approval decision

When the user clicks Approve or Reject on an `approval_required` event:

**Request:**
```json
{ "approvalId": 7, "decision": "approve" }
```

Or for a rejection with a reason:
```json
{ "approvalId": 7, "decision": "reject", "reason": "Not the right time" }
```

**Response:** `200 { "ok": true }`

After an approval, more `chunk` events will arrive on the still-open stream as the AI continues.

---

### POST /api/slack/link — Connect a user's Slack account

Call this once after a user completes the Slack OAuth flow in your dashboard settings:

**Request:**
```json
{ "slackUserId": "U12345ABC", "slackWorkspaceId": "T09876XYZ" }
```

**Response:** `200 { "linked": true }`

After this call, messages the user sends from Slack will share the same conversation history as the dashboard.

**Error responses:**
- `409` — This Slack user ID is already linked to a different account

---

## What Your Team Needs to Build

| # | What to build | Who builds it |
|---|---|---|
| 1 | Store `CLOUDSTICK_GATEWAY_KEY` securely on your server | Backend |
| 2 | Backend proxy that forwards messages to Cloud-Claw with the right headers | Backend |
| 3 | Chat widget UI that streams responses and shows Approve/Reject buttons | Frontend |
| 4 | Plan check before calling Cloud-Claw (block users not on a qualifying plan) | Backend |
| 5 | "Connect Slack" settings page + Slack OAuth flow | Frontend + Backend |
| 6 | After Slack OAuth, call `POST /api/slack/link` with the user's Slack ID | Backend |

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

- [ ] Show a text input where the user types their message
- [ ] Send the message to **your backend** (not directly to Cloud-Claw — your backend holds the secret key)
- [ ] Open the `streamUrl` and display chunks as they arrive, word by word
- [ ] When an `approval_required` event arrives, show an **Approve** and **Reject** button
- [ ] When the user clicks Approve or Reject, POST to `/api/chat/:sessionId/approve` via your backend
- [ ] On `done` or `error` event, close the stream and re-enable the input box
- [ ] If the stream disconnects unexpectedly, retry connecting to the same `streamUrl` after 2–3 seconds

---

## Backend Proxy — Step-by-Step Flow

```
1. User sends message from the chat widget to your backend
2. Your backend checks the user's plan (block if not on a qualifying plan)
3. Your backend POSTs to Cloud-Claw /api/chat with the three required headers
4. Cloud-Claw returns { sessionId, streamUrl } — store sessionId for this conversation
5. Your backend opens the streamUrl and relays each SSE event to the user's browser
6. When user clicks Approve/Reject, your backend POSTs to /api/chat/:sessionId/approve
```
