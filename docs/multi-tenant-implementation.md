# Multi-Tenant Cloud-Claw Implementation — 2026-03-24

## What Was Built

A complete **multi-tenant architecture** for Cloud-Claw so each Slack/Telegram user manages their own Cloudstick account, with credentials stored per-user in the database — not hardcoded in `.env`.

---

## Problem

Cloud-Claw originally used a single shared set of Cloudstick credentials for all users:
```
CLOUDSTICK_API_KEY=cs_live_...
CLOUDSTICK_API_SECRET=eyJhbGci...
CLOUDSTICK_USER_ID=48
```

Every Cloudstick API call hardcoded `env.CLOUDSTICK_USER_ID`. This meant:
- All users shared the same Cloudstick account
- No per-user credential isolation
- SSH keys were also shared/hardcoded

---

## Solution

**Each user has their own Cloudstick account credentials** stored in a new `users` table. On every message, the system looks up the Slack/Telegram user and sets their credentials as the active context for that request.

---

## Changes Made (File by File)

### 1. `src/database/schema.sql` — Added `users` table

```sql
CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  platform              TEXT NOT NULL,           -- 'slack' or 'telegram'
  platform_id           TEXT NOT NULL UNIQUE,   -- Slack UID or Telegram numeric ID
  cloudstick_api_key    TEXT,
  cloudstick_api_secret TEXT,
  cloudstick_user_id    TEXT,                    -- extracted from JWT
  ssh_private_key       TEXT,                    -- AES-256-GCM encrypted
  ssh_public_key        TEXT,
  setup_at             TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform, platform_id)
);
CREATE INDEX IF NOT EXISTS users_platform_idx ON users (platform);
CREATE INDEX IF NOT EXISTS users_platform_id_idx ON users (platform_id);
```

This was added at the bottom of the existing schema (line 119+).

---

### 2. `src/config/env.ts` — Added `ENCRYPTION_KEY`

```typescript
ENCRYPTION_KEY: z.string().optional(),
```

This is a 32-byte hex key (64 hex chars) used for AES-256-GCM encryption. Generated with `openssl rand -hex 32`. Must be set in `.env`.

---

### 3. `src/utils/crypto.ts` — New file

**AES-256-GCM encryption/decryption** for SSH private keys at rest:

```typescript
export function encrypt(plaintext: string): string {
  // Returns: iv_hex:tag_hex:ciphertext_hex
}

export function decrypt(ciphertext: string): string {
  // Reverses encrypt()
}

export function decodeCloudstickJwtUserId(jwtSecret: string): string {
  // Parses the JWT payload from Cloudstick API secret, extracts user_id
  // The Cloudstick API secret is a JWT (ES256 signed) containing {user_id: 48, ...}
  // No signature verification needed — the API server handles that
}
```

Key insight: The `CLOUDSTICK_API_SECRET` is a JWT token. The payload contains `user_id`. Users only need to provide API key + API secret — user_id is auto-extracted. This simplified `/setup` to just 2 arguments.

---

### 4. `src/services/user_service.ts` — New file

Full CRUD for the `users` table:

```typescript
export interface CloudclawUser {
  id, platform, platform_id,
  cloudstick_api_key, cloudstick_api_secret, cloudstick_user_id,
  ssh_private_key, ssh_public_key, setup_at, updated_at
}

export async function getUserByPlatformId(platform, platformId): Promise<CloudclawUser | null>
export async function setUserCloudstickCredentials(platform, platformId, apiKey, apiSecret, userId)
export async function setUserSshKey(platform, platformId, privateKey, publicKey) // encrypts automatically
export function getDecryptedSshKey(user): string | null
export function hasCloudstickCredentials(user): boolean
```

Uses `upsertUser()` pattern — updates existing user or inserts new one.

---

### 5. `src/api/cloudstick_context.ts` — New file

**Request-scoped user context** — module-level singleton:

```typescript
let _currentUser: CloudclawUser | null = null;

export function setCloudstickUser(user: CloudclawUser | null): void {
  _currentUser = user;
}

export function getCloudstickUser(): CloudclawUser | null {
  return _currentUser;
}
```

This is the "glue" between the incoming message (user identity) and all Cloudstick API calls. Set once at the start of `runAgentLoop()`, cleared at the end.

---

### 6. `src/api/cloudstick_client.ts` — Refactored

**Before:**
```typescript
constructor() {
  this.apiKey = env.CLOUDSTICK_API_KEY;
  this.apiSecret = env.CLOUDSTICK_API_SECRET;
}

public async request<T>(config) {
  // Uses this.apiKey / this.apiSecret directly
}
```

**After:**
```typescript
export interface CloudstickClientOptions {
  apiKey?: string;
  apiSecret?: string;
  baseURL?: string;
}

constructor(options: CloudstickClientOptions = {}) {
  this.apiKey = options.apiKey ?? env.CLOUDSTICK_API_KEY ?? '';
  this.apiSecret = options.apiSecret ?? env.CLOUDSTICK_API_SECRET ?? '';
}

public async request<T>(config) {
  // Checks getCloudstickUser() context FIRST
  const ctx = getCloudstickUser();
  const effectiveKey = ctx?.cloudstick_api_key ?? this.apiKey;
  const effectiveSecret = ctx?.cloudstick_api_secret ?? this.apiSecret;
  // ... uses effectiveKey/effectiveSecret for auth
}
```

Backward compatible — if no user context is set, falls back to env vars (existing single-tenant deployments keep working).

Also changed `updateDatabaseUser()` from `PUT` to `PATCH` (bug fix from code review).

---

### 7. `src/api/multi_cloudstick_client.ts` — New file

Per-user `CloudstickApiClient` cache. Not strictly required (since `CloudstickApiClient.request()` now checks context), but provides a cleaner API for future use:

```typescript
export class MultiCloudstickApiClient {
  private clients = new Map<string, CloudstickApiClient>();

  getClient(user: CloudclawUser): CloudstickApiClient {
    // Creates + caches a client per platform_id
    // Throws if user has no credentials
  }

  invalidate(userPlatformId: string): void {
    this.clients.delete(userPlatformId);
  }
}
```

---

### 8. `src/agents/loop.ts` — Set per-user context

At the start of `runAgentLoop()`:
```typescript
// 1b. Multi-tenant: set per-user Cloudstick credentials for this request
try {
  const user = await getUserByPlatformId(message.channel, message.userId);
  if (user && hasCloudstickCredentials(user)) {
    setCloudstickUser(user);
  } else {
    setCloudstickUser(null);
  }
} catch (err) {
  console.warn('[loop] User credential lookup failed (non-fatal):', err);
  setCloudstickUser(null);
}
```

At the end of `runAgentLoop()`:
```typescript
setCloudstickUser(null);
```

---

### 9. All Cloudstick API Tool Files — Updated `userId()`

Six files were updated to use the request-scoped context instead of `env.CLOUDSTICK_USER_ID`:

- `src/tools/manage_system_users.ts`
- `src/tools/manage_database_users.ts`
- `src/tools/manage_databases.ts`
- `src/tools/manage_cron_jobs.ts`
- `src/tools/ssl_api_tools.ts`
- `src/tools/switch_php_api.ts`

**Pattern used in all 6 files:**
```typescript
const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();
```

Also updated:
- `src/tools/get_cloudstick_servers.ts`
- `src/tools/get_cloudstick_account_details.ts`
- `src/tools/check_cloudstick_connection.ts`

These use `getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID` (no throw — read-only tools gracefully degrade).

---

### 10. `src/utils/ssh.ts` — Per-user SSH key support

**New function:**
```typescript
export async function loadUserSshKey(
  platform: 'slack' | 'telegram',
  platformId: string
): Promise<{ privateKey: Buffer; publicKey: string } | null> {
  const user = await getUserByPlatformId(platform, platformId);
  if (!user) return null;
  const decrypted = getDecryptedSshKey(user);
  if (!decrypted || !user.ssh_public_key) return null;
  return { privateKey: Buffer.from(decrypted), publicKey: user.ssh_public_key };
}
```

**Updated `executeSSHCommand()` and `sshExec()`** to accept optional `privateKey: Buffer` parameter:
```typescript
async function executeSSHCommand(
  host, command,
  options: { user?: string; port?: number; timeoutMs?: number; privateKey?: Buffer } = {}
) {
  const key = options.privateKey ?? SSH_PRIVATE_KEY; // fallback to env
  // ...
}
```

The `env.SSH_PRIVATE_KEY_PATH` fallback is preserved for backward compatibility.

---

### 11. `src/commands/slash_handler.ts` — Complete rewrite

**New signature:**
```typescript
export async function handleSlashCommand(
  command: string,
  platform: 'slack' | 'telegram',  // NEW
  userId: string,                    // was second param, now third
  replyFn: ReplyFn
): Promise<boolean>
```

**New `/setup` command** (2 args — user_id auto-extracted from JWT):
```
/setup <api_key> <api_secret>
```

**New `/setkey` command** (encrypted SSH key storage):
```
/setkey <private_key> <public_key>
```

**Updated `/nodes`** — now passes platform+userId, sets Cloudstick context, queries Cloudstick API directly (not the stale `servers` table):
```typescript
async function handleNodes(platform, userId, replyFn) {
  const user = await getUserByPlatformId(platform, userId);
  setCloudstickUser(user);
  try {
    const rows = await getAllServers(); // calls Cloudstick API
    // ... display
  } finally {
    setCloudstickUser(null);
  }
}
```

**Updated interfaces** to use new 3-param signature:
- `src/interfaces/slack.ts:94` → `handleSlashCommand(cleanText, 'slack', user, onReply)`
- `src/interfaces/telegram.ts:67` → `handleSlashCommand(text, 'telegram', userId, onReply)`

---

### 12. `src/utils/server_registry.ts` — Removed FALLBACK_SERVERS, queries Cloudstick API

**Removed:**
```typescript
export const FALLBACK_SERVERS: ServerNode[] = [
  { id: 1, label: 'production', ip: '139.84.130.63', ... },
  { id: 2, label: 'test', ip: '65.20.82.177', ... },
];
```

**`getAllServers()` now calls Cloudstick API:**
```typescript
export async function getAllServers(): Promise<ServerNode[]> {
  const user = getCloudstickUser();
  if (!user?.cloudstick_user_id) return [];

  try {
    const client = getCloudstickClient();
    const response = await client.listServersByUser(user.cloudstick_user_id);
    const servers = response?.message?.servers ?? [];
    return servers.map(s => ({
      id: typeof s.id === 'string' ? parseInt(s.id, 10) : s.id ?? 0,
      label: s.label ?? s.host_name ?? 'unknown',
      ip: s.ip ?? s.server_ip ?? '',
      sshUser: 'root',
      sshPort: 22,
      active: s.is_active !== false,
    }));
  } catch (err) {
    console.warn('[server_registry] Cloudstick API failed:', err);
    return [];
  }
}
```

This fixes the bug where `/nodes` showed stale hardcoded IPs (production/65.20.82.177) instead of querying Cloudstick.

---

### 13. `src/config/system_prompt.ts` — API-First Hierarchy

Updated to emphasize Cloudstick API as primary, SSH as troubleshooting fallback:
- Section 1 rewritten with API-First hierarchy
- SSL Operations marked as "API Only"
- T-1 troubleshooting workflow checks API first
- All backticks escaped (fixing template literal parsing issue)
- Section 7 reorganized: API tools listed first, SSH tools second

---

### 14. Bug Fixes Applied

From prior code review session:
- `delete_cron_job` — added missing `getApprovalRequest` for HITL consistency
- `deleteDatabase` — added missing `serverId` to tool
- `ssl_type` param removed from `issueSSLTool` schema (dead code)
- `updateDatabaseUser` changed from `PUT` to `PATCH`
- `userId()` now throws if unset (was silent empty string)
- 4 tools got `getApprovalRequest` added: `changeSystemUserPasswordTool`, `deleteSystemUserTool`, `changeDatabaseUserPasswordTool`, `deleteDatabaseUserTool`

---

### 15. New Tests

`src/utils/crypto.test.ts` — 8 tests:
- AES-256-GCM encrypt/decrypt round-trip
- Random IV produces different ciphertexts
- Tampered ciphertext detection
- JWT user_id extraction (valid token)
- JWT user_id extraction from actual env JWT (user_id=48)
- Missing user_id in payload → throws
- Malformed token (not 3 parts) → throws
- Invalid base64 payload → throws

---

## How to Set Up a New User

1. User runs `/setup cs_live_xxx eyJhbGci...`
   - API key + API secret stored in `users` table
   - user_id auto-extracted from JWT in API secret
2. User runs `/setkey <private_key> <public_key>`
   - Private key encrypted with AES-256-GCM, stored in `users` table
3. All subsequent messages use that user's credentials automatically

---

## Database Setup Required

When deploying to a new environment:

```bash
# 1. Generate encryption key
openssl rand -hex 32
# Add to .env: ENCRYPTION_KEY=<output>

# 2. Run the full schema
psql <DATABASE_URL> -f src/database/schema.sql

# 3. Restart the app
```

---

## Files Created

| File | Purpose |
|------|---------|
| `src/utils/crypto.ts` | AES-256-GCM + JWT decode |
| `src/services/user_service.ts` | User CRUD |
| `src/api/cloudstick_context.ts` | Request-scoped context |
| `src/api/multi_cloudstick_client.ts` | Per-user client cache |
| `src/utils/crypto.test.ts` | Tests |
| `docs/multi-tenant-implementation.md` | This document |

## Files Modified

| File | Change |
|------|--------|
| `src/database/schema.sql` | Added `users` table + indexes |
| `src/config/env.ts` | Added `ENCRYPTION_KEY` |
| `src/api/cloudstick_client.ts` | Per-user credential override in `request()` |
| `src/agents/loop.ts` | Set/clear per-user Cloudstick context |
| `src/utils/ssh.ts` | `loadUserSshKey()`, `privateKey` param |
| `src/commands/slash_handler.ts` | New signature, `/setup`, `/setkey`, updated `/nodes` |
| `src/interfaces/slack.ts` | New 3-param `handleSlashCommand` signature |
| `src/interfaces/telegram.ts` | New 3-param `handleSlashCommand` signature |
| `src/utils/server_registry.ts` | Removed FALLBACK_SERVERS, Cloudstick API query |
| `src/config/system_prompt.ts` | API-First hierarchy |
| `src/tools/manage_system_users.ts` | `userId()` context |
| `src/tools/manage_database_users.ts` | `userId()` context + `getApprovalRequest` |
| `src/tools/manage_databases.ts` | `userId()` context |
| `src/tools/manage_cron_jobs.ts` | `userId()` context |
| `src/tools/ssl_api_tools.ts` | `userId()` context, removed dead `ssl_type` |
| `src/tools/switch_php_api.ts` | `userId()` context |
| `src/tools/get_cloudstick_servers.ts` | `effectiveUserId` context |
| `src/tools/get_cloudstick_account_details.ts` | `effectiveUserId` context |
| `src/tools/check_cloudstick_connection.ts` | `effectiveUserId` context |

## Verification

```bash
# Compile
npx tsc --noEmit

# Tests (70 passing)
npx vitest run

# Manual testing
# 1. /setup cs_live_xxx eyJhbGci... → should say "User ID: 48"
# 2. /nodes → should query Cloudstick API (empty if no servers configured)
# 3. /setkey <key> <pub> → should say "SSH key configured"
```
