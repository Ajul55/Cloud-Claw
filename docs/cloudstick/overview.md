# Cloudstick + Cloud-Claw: What We Built

Think of **Cloud-Claw** as a smart assistant that can look at your servers, spot problems, and fix them. It already worked over Slack and Telegram. What we just built is a **private door** that lets Cloudstick's system talk to it directly.

---

## What Was Built

### A Private Doorway (HTTP Gateway)

A set of URLs (called an API) that Cloudstick's backend can call:

| What it does | How it works |
|---|---|
| **Send a message** | Cloudstick calls us with a user's question ("nginx is down") |
| **Get a live response** | We stream the AI's answer back word-by-word in real time |
| **Approve a dangerous action** | If the AI wants to change something on a server, the user gets an Approve/Reject button |
| **Link a Slack account** | A user can connect their Slack to their Cloudstick account so both use the same conversation history |

### A Lock on the Door (Security)

Cloudstick's backend holds a secret signing key (64 hex characters, called `CLOUDSTICK_GATEWAY_KEY`). Every request is signed with HMAC-SHA256 using the method, path, timestamp, and raw body. If the signature is wrong, missing, or too old, we reject the request immediately. **This key must never be shared with or visible to end users.**

### User Accounts (Auto-Created)

When a Cloudstick business user chats for the first time, we automatically create an account for them on our side. We also store which plan they are on (Starter, Pro, or Business) so we can apply the right limits.

### Speed Limits by Plan

Each plan gets a different number of server actions per conversation:

| Plan | Max server actions per chat |
|---|---|
| Starter | 10 |
| Pro | 30 |
| Business | 50 |

If a user hits their limit, the AI stops and summarises what it found so far.

### Shared Conversation (Slack + Dashboard)

A Cloudstick business user who connects their Slack account will share the **same conversation history** whether they chat from the dashboard or from Slack. The AI remembers the full context either way.

---

## What Is Ready for Production?

Everything above is built and tested. To go live, only two things are needed:

1. **Run the database migration** — a script that adds 5 new columns to our existing database table (takes about 1 second).
2. **Set the environment variable** — add `CLOUDSTICK_GATEWAY_KEY=<64-char secret>` to the server config and restart Cloud-Claw.

After that, the gateway is live on the same port we already use for health checks (port 9000).

---

## Security Model

The gateway is designed for **server-to-server communication only** — Cloudstick's backend calls Cloud-Claw's backend. End users never talk to Cloud-Claw directly.

| Protection | How it works |
|---|---|
| **HMAC signature** | Every request must include `X-CloudClaw-Timestamp` and `X-CloudClaw-Signature`. Bad or stale signatures get 401. |
| **Session isolation** | Sessions are always keyed to the account ID. A user cannot access another account's session. |
| **Usage isolation** | Usage reads require the URL account ID to match `X-Cloudstick-Account-Id`. |
| **Body size limit** | Requests larger than 50 KB are rejected — prevents memory flood attacks. |
| **Stream timeout** | If the AI takes longer than 5 minutes, the session is automatically closed. |
| **Error scrubbing** | Internal error details (database messages, stack traces) are never sent to the API caller. |

**What Cloudstick is responsible for:**
- Storing the gateway signing key only on your backend server (never in frontend code or browser)
- Sending the correct plan tier for each user — Cloud-Claw enforces limits based on what you report
- Plan-gating users before calling Cloud-Claw (block users not on a qualifying plan)
