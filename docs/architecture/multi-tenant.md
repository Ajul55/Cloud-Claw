# Multi-Tenant Architecture

This document describes how Cloud-Claw handles multiple users, each with their own Cloudstick account, SSH keys, and credentials — all isolated from one another.

---

## The Problem It Solves

Cloud-Claw originally used a single shared set of Cloudstick credentials hardcoded in `.env`:

```
CLOUDSTICK_API_KEY=cs_live_...
CLOUDSTICK_API_SECRET=eyJhbGci...
CLOUDSTICK_USER_ID=48
```

This meant all users shared the same Cloudstick account, with no per-user isolation. SSH keys were also shared and hardcoded.

---

## How It Works Now

**Each user has their own Cloudstick credentials** stored in a `users` database table. On every incoming message, the system looks up the user and sets their credentials as the active context for that request — then clears it when the request finishes.

```
Message arrives
  → Look up user by platform ID (Slack UID, Telegram ID, or Cloudstick account ID)
  → Set that user's credentials as request-scoped context
  → Agent loop runs — all Cloudstick API calls use that user's key/secret
  → Context cleared at end of request
```

---

## Database: `users` Table

```sql
CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  platform              TEXT NOT NULL,         -- 'slack', 'telegram', or 'cloudstick'
  platform_id           TEXT NOT NULL,         -- Slack UID, Telegram ID, or Cloudstick account ID
  cloudstick_account_id TEXT UNIQUE,           -- Cloudstick business account ID
  cloudstick_api_key    TEXT,                  -- AES-256-GCM encrypted at rest
  cloudstick_api_secret TEXT,                  -- AES-256-GCM encrypted at rest
  cloudstick_user_id    TEXT,                  -- extracted automatically from JWT in api_secret
  slack_user_id         TEXT UNIQUE,           -- set when user links Slack via /api/slack/link
  slack_workspace_id    TEXT,
  plan_tier             TEXT DEFAULT 'starter',
  plan_updated_at       TIMESTAMPTZ,
  ssh_private_key       TEXT,                  -- AES-256-GCM encrypted
  ssh_public_key        TEXT,
  setup_at              TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform, platform_id)
);
```

---

## Key Files

| File | What it does |
|---|---|
| `src/services/user_service.ts` | CRUD for the `users` table — get, create, update, link Slack |
| `src/api/cloudstick_context.ts` | Request-scoped user context (set/get/clear per message) |
| `src/utils/crypto.ts` | AES-256-GCM encryption for SSH keys and API credentials |
| `src/api/cloudstick_client.ts` | Cloudstick REST client — reads from request context, falls back to env vars |
| `src/api/multi_cloudstick_client.ts` | Per-user client cache (used when managing multiple accounts) |

---

## Request Context (How Credentials Flow)

`src/api/cloudstick_context.ts` is a module-level singleton set at the start of each request:

```typescript
// Set at the start of runAgentLoop()
setCloudstickUser(user);

// All Cloudstick API calls inside the loop do:
const ctx = getCloudstickUser();
const effectiveKey = ctx?.cloudstick_api_key ?? env.CLOUDSTICK_API_KEY;

// Cleared at the end of runAgentLoop()
setCloudstickUser(null);
```

This means credentials never leak between concurrent sessions — each request sets and clears its own context.

> **Note on concurrency:** This module-level singleton is safe for the current single-worker deployment. With multiple workers it remains safe because each OS process has its own memory. It would only become unsafe in a true multi-threaded runtime, which Node.js is not.

---

## Credential Encryption

SSH private keys and Cloudstick API credentials are stored **AES-256-GCM encrypted** in the database. The encryption key comes from the `ENCRYPTION_KEY` environment variable (32-byte hex, 64 characters).

```bash
# Generate a key
openssl rand -hex 32
# Add to .env: ENCRYPTION_KEY=<output>
```

The format stored in the database is: `iv_hex:tag_hex:ciphertext_hex`

---

## Cloudstick User ID — Auto-Extracted from JWT

The Cloudstick API secret is a JWT token. The payload contains `user_id`. Users only need to run:

```
/setup <api_key> <api_secret>
```

Cloud-Claw extracts `user_id` from the JWT payload automatically — no need to provide it separately.

---

## How a New User Gets Set Up (Slack/Telegram)

1. User runs `/setup cs_live_xxx eyJhbGci...`
   - API key + API secret stored in `users` table (encrypted)
   - `user_id` auto-extracted from JWT in the API secret
2. User runs `/setkey <private_key> <public_key>`
   - Private key encrypted with AES-256-GCM, stored in `users` table
3. All subsequent messages use that user's credentials automatically

---

## How Cloudstick Business Users Are Created

When a Cloudstick business user chats via the HTTP gateway for the first time, their account is auto-provisioned:

```typescript
// Called by the HTTP gateway on every POST /api/chat
await upsertCloudstickUser(accountId, planTier);
// Uses ON CONFLICT (cloudstick_account_id) DO UPDATE — safe under concurrent requests
```

---

## Backward Compatibility

All Cloudstick API tools fall back to environment variables if no user context is set:

```typescript
const effectiveKey = ctx?.cloudstick_api_key ?? env.CLOUDSTICK_API_KEY ?? '';
```

Existing single-tenant deployments (where credentials are in `.env`) continue to work without any changes.

---

## Database Setup

```bash
# 1. Generate encryption key
openssl rand -hex 32
# Add to .env: ENCRYPTION_KEY=<output>

# 2. Run the schema
psql $DATABASE_URL -f src/database/schema.sql

# 3. Restart the app
```

---

## Tests

`src/utils/crypto.test.ts` — covers:
- AES-256-GCM encrypt/decrypt round-trip
- Different ciphertexts for same plaintext (random IV)
- Tampered ciphertext detection
- JWT `user_id` extraction (valid and invalid tokens)
