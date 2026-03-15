# Cloud-Claw v3.0 — 4-Layer Guard Architecture

> **Context**: Designed after deep research session on agentic hallucination detection, input parsing fragility, and prompt injection via SSH output.

---

## 🎯 The Problem This Solves

The current `loop.ts` has two classes of bugs that will cause production failures at scale:

1. **Input parsing is regex-based** — 7+ fragile regex patterns that miss natural language intent ("my website won't load" doesn't match any pattern), fire on wrong inputs (`v2.0` matched as a domain), and cannot understand context.
2. **Output verification is incomplete** — the `executedTools` Set tracks *whether* a tool ran, not *whether it succeeded*. The LLM can claim "fix applied" after a failed `fix_nginx_config` and the guard won't catch it.

Additionally: **fake `role: 'user'` messages** are injected into the conversation history at Line 406 (hallucination guard) and Line 599 (auto-chain). This poisons the context window and makes resumed sessions schizophrenic.

---

## 🏗️ The 4-Layer Architecture

```
PILOT INPUT
    ↓
[LAYER 1] classifyIntent()        — LLM semantic routing
    + hardcoded audit override    — deterministic security
    ↓
AGENT LOOP
    ↓
[LAYER 2] preToolGuard()          — before SSH fires
    ↓
  tool.execute()
    ↓
[LAYER 3] postToolGuard()         — after SSH returns
    ↓
[LAYER 4] checkForHallucination() — before LLM reply sent
    ↓
PILOT OUTPUT
```

---

## 🛡️ Layer 1 — Input Gate (Intent Classifier)

**File**: `src/agents/intent_classifier.ts`

**What it replaces**: All regex at the top of `loop.ts`:

- `requiresTool` regex (misses "my website won't load")
- `requiresDomainDiagnosis` (two conflicting regexes)
- `extractDomains()` (matches IPs, version strings)
- `requiresNginx` regex
- `shouldPauseForClarification` regex
- `isAllServersRequest()` in server_registry.ts

**How it works**: Single LLM call at session start, returns strongly-typed `Intent` object:

```tsx
interface Intent {
  requiresTool: boolean;
  toolHint: 'diagnose_nginx' | 'diagnose_domain' | 'cloudflare_cache_purge'
            | 'diagnose_services' | 'execute_ssh_command' | 'none';
  isAudit: boolean;            // LLM opinion — overridden by hardcoded regex
  targetServer: 'production' | 'test' | 'all' | 'unknown';
  domains: string[];           // real hostnames only — never IPs or versions
  isApprovalResponse: boolean; // yes / proceed / reject etc
  needsClarification: boolean;
  confidence: number;
}
```

**The Security Override (Critical)**:

Even if the LLM says `isAudit: false`, hardcoded regex runs after and can only make the result *more* restrictive, never less:

```tsx
const AUDIT_OVERRIDE_PATTERNS = [
  /\b(audit|health\s*check|full\s*check|scan|inspect|review)\b/i,
  /\b(what's going on|check everything|any issues|full report)\b/i,
];
// If regex fires → isAudit = true regardless of LLM output
// Security gate is NEVER prediction-based
```

**Trade-offs**:

- +300–500ms latency per session start
- +1 API call per message
- Eliminates entire class of routing bugs at scale

---

## 🚧 Layer 2 — Tool Pre-Guard (Sequence Enforcer)

**File**: `src/agents/tool_guard.ts` → `preToolGuard()`

**What it does**: Validates LLM's tool call request *before* SSH connection opens.

**Rules enforced (deterministic, no LLM)**:

| Rule | Logic |
| --- | --- |
| **Earn the Fix** | `fix_nginx_config` blocked unless `diagnose_nginx` receipt exists |
| **Earn the Repair** | `repair_mysql` (repair) blocked unless diagnostic receipt exists |
| **Audit Lock** | Any `WRITE_TOOLS` member blocked if `isAudit === true` |
| **No Fan-out Writes** | Write tools with `server_label = 'all'` blocked — must target one server |
| **SSH Rate Limit** | Max 30 SSH calls per session — blocks runaway loops |
| **Command Blocklist** | `execute_ssh_write` / `execute_ssh_command` args checked against `command_filter.ts` |

**The "Earn the Fix" rule** is the most important. It prevents the #1 cause of AIOps production incidents: the LLM skipping diagnosis and jumping straight to a fix it hasn't earned the right to propose.

---

## 🧼 Layer 3 — Tool Post-Guard (IPS + Data Masker)

**File**: `src/agents/tool_guard.ts` → `postToolGuard()`

**What it does**: Sanitizes SSH output *before* it enters the LLM context window.

### Injection Protection

Scans for prompt injection patterns in server output (logs, cron files, nginx configs):

```
- "ignore previous instructions"
- LLM tool call syntax (<minimax:tool_call>, functions.execute_ssh_command)
- Persona hijacking ("you are now a different AI")
- Curl/wget pipe to bash payloads
- Base64 decode to bash
```

If `severity: 'alert'` → replaces with `[INJECTION BLOCKED]` + notifies Pilot

If `severity: 'strip'` → silently removes

### Data Masking (Critical — Do Now)

Prevents credentials from entering LLM context window AND being stored in PostgreSQL sessions table:

```
- WordPress DB_PASSWORD, DB_USER in wp-config.php
- .env style KEY=VALUE patterns (any key containing PASSWORD/SECRET/TOKEN)
- Private key blocks (-----BEGIN ... PRIVATE KEY-----)
- Database connection strings (mysql://user:pass@host)
```

> ⚠️ **Without this, every `cat wp-config.php` stores a live database password in the sessions table forever.**
> 

---

## 🕵️ Layer 4 — Output Gate (Receipt Auditor)

**File**: `src/agents/hallucination_guard.ts`

**What it replaces**: The `executedTools: Set<string>` in `loop.ts`

**The upgrade**: `Set<string>` tracked whether a tool *ran*. The new `Map<string, ToolReceipt>` tracks whether it *succeeded*.

```tsx
interface ToolReceipt {
  toolName: string;
  success: boolean;        // MUST be true for hallucination guard to pass
  host: string;
  timestamp: number;
  outputHash: string;      // hash of first 200 chars — proof of real output
}
```

**Why this matters**: A failed `fix_nginx_config` (nginx -t still fails after edit) followed by "Nginx is now fixed" is still a hallucination. The old Set guard would pass this. The receipt guard catches it because `success === false`.

**Receipt persistence across HITL**: The Map must be serialized into the session DB alongside `messages`:

```tsx
await upsertSession({
  messages,
  receipts: Object.fromEntries(executionReceipts),  // Map → object for JSON storage
});
// On resume: restore Map from session.receipts
```

Without this, HITL resume resets the receipt map to empty and the guard goes blind.

---

## 🔧 Fake User Message Fix

Two places in current `loop.ts` inject fake `role: 'user'` messages. These must be changed to `role: 'system'`.

| Location | Current (Wrong) | Fix |
| --- | --- | --- |
| Line 406 — hallucination guard | `role: 'user'` "STOP. You reported..." | `role: 'system'` guard message |
| Line 599 — auto-chain | `role: 'user'` "diagnose_nginx found..." | Remove entirely — use direct tool execution |
| Internal syntax retry | `role: 'user'` "Do not output tool syntax..." | `role: 'system'` instruction |

**Auto-chain correct approach**: Instead of injecting a fake user message, store `pendingAutoChain` state and execute the tool directly in the next iteration — no LLM call needed, no fake messages.

---

## 📅 Implementation Roadmap

| Step | Task | File | Priority |
| --- | --- | --- | --- |
| **1** | Replace `Set<string>` with `Map<string, ToolReceipt>`  • DB persistence | `loop.ts`  • `db.ts` | 🔴 Do first |
| **2** | Data masking in postToolGuard — passwords out of sessions table | `tool_guard.ts` | 🔴 Do first |
| **3** | preToolGuard — sequence enforcer + audit lock + rate limiter | `tool_guard.ts` | 🟠 High |
| **4** | postToolGuard — injection detection + Pilot alert | `tool_guard.ts` | 🟠 High |
| **5** | Fix fake `role: 'user'` → `role: 'system'` at Line 406 + 599 | `loop.ts` | 🟠 High |
| **6** | Intent classifier — replace all input regex | `intent_classifier.ts` | 🟡 Medium |
| **7** | Reject feedback loop — store rejection reason in memory | `resume.ts` | 🟡 Medium |
| **8** | Unit tests for preToolGuard + checkForHallucination | `*.test.ts` | 🟡 Medium |

---

## 🧪 The Guard Cannot Trust Itself

Every layer (preToolGuard, postToolGuard, checkForHallucination) must be independently testable with **zero LLM calls, zero SSH connections**:

```bash
npx vitest run src/agents/tool_guard.test.ts
npx vitest run src/agents/hallucination_guard.test.ts
```

If a regex or sequence rule breaks in a deploy, CI catches it before it reaches 500 servers.

---

## 📌 Gaps Added Beyond Original Plan

These 4 gaps were identified during the research session and added to the plan:

1. **SSH Rate Limiter in Layer 2** — 30 SSH calls/session max. Without this, a circuit-breaker trip can open 50 SSH connections before anyone notices.
2. **Data Masking in Layer 3** — wp-config.php passwords are currently being stored in plaintext in the PostgreSQL sessions table. This is the most urgent security issue.
3. **Reject Feedback Loop** — when Pilot rejects, the rejection reason must be stored and injected into the next session on the same server. Closes the loop that causes the LLM to re-propose the same rejected fix.
4. **Receipt Map persistence across HITL** — the `Map<string, ToolReceipt>` lives in memory. Without serializing it into the session DB, HITL resume resets it and the hallucination guard goes blind for the second half of every resumed session.

---

## 🔬 Research Basis

- Industry consensus: combine LLM-based guardrails + deterministic rules + moderation layers. No single guardrail is sufficient.
- OpenAI Agents SDK formalises 3 guardrail types: input guardrails, output guardrails, tool guardrails (wrapping each tool call before and after).
- Security gates must be deterministic — `isAudit` cannot be an LLM prediction.
- Winning pattern: **probabilistic understanding** (LLM interprets intent) + **deterministic routing** (hard-coded logic controls execution flow).

---

## 🐛 New Bugs Found — Full Codebase Review (March 14, 2026)

Found by reading all 46 source files pasted in session. Each bug is traced to the exact file and line.

### 🔴 Critical

**BUG-C1 — `discovery_agent.ts` leaks DB credentials into sessions table**

File: `src/tools/discovery_agent.ts` lines ~95–105. Reads `wp-config.php` via SSH, puts `DB_NAME`, `DB_HOST` directly into `output`. That output enters LLM context and is stored permanently in PostgreSQL `sessions` JSONB column. Every discovery call on a WordPress site stores live DB credentials forever. Fix: wire `postToolGuard()` data masking before output hits messages.

**BUG-C2 — `fix_wordpress.ts` leaks `wp-config.php` contents**

File: `src/tools/fix_wordpress.ts`. Reads wp-config.php, full file contents including `DB_PASSWORD` can appear in output with no masking. Same impact and same fix as BUG-C1.

**BUG-C3 — `create_nginx_vhost.ts` has NO HITL gate — bypasses approval entirely**

File: `src/tools/create_nginx_vhost.ts`. Writes a new nginx vhost config using `base64 | tee` then reloads nginx. Has no `approvalTier: 3`, no entry in `getToolApprovalRequest()`, not in `WRITE_TOOLS` Set. Executes immediately with zero Pilot approval. LLM can create vhosts on production with no human in the loop. Fix: add `approvalTier: 3`, add case in `getToolApprovalRequest()`, add to `WRITE_TOOLS`.

**BUG-C4 — `command_filter.ts` `rm` regex broken — does not block `rm -r`**

File: `src/security/command_filter.ts` first entry of `BLOCKED_PATTERNS`. Current regex requires both `-r` and `-f` flags together. `rm -r /dir` and `rm --recursive /` are not caught. Fix: replace with `/\brm\b.*(\s-[a-zA-Z]*[rf][a-zA-Z]*|\s--recursive|\s--force)/i`

---

### 🟠 High

**BUG-H1 — `saveFix()` fires on read-only tools — pollutes fix memory**

File: `src/agents/loop.ts` — `SKIP_MEMORY_TOOLS` Set. Missing: `execute_ssh_command`, `diagnose_services`, `diagnose_domain`, `check_ssl`, `manage_php` (list), `repair_mysql` (diagnose). Every audit saves junk entries. Fix: switch to whitelist — only save for actual write tools: `fix_nginx_config`, `fix_wordpress`, `renew_ssl`, `manage_php` (switch), `repair_mysql` (repair), `cleanup_disk` (cleanup), `execute_ssh_write`, `cloudflare_cache_purge`.

**BUG-H2 — `resumedTools` seeds only ONE tool — hallucination guard blind on multi-HITL chains**

File: `src/hitl/resume.ts` bottom. `resumedTools: [toolName]` — only the last approved tool is seeded. In a multi-HITL chain all previously executed tools are lost from `executedTools`. Hallucination guard goes dark for entire prior history. Fix: walk messages array, recover all previously executed tool names, pass full list as `resumedTools`.

**BUG-H3 — `shouldPauseForClarification` fires on HITL resume — blocks tool calls after approval**

Files: `src/agents/loop.ts` + `src/hitl/resume.ts`. When `resume.ts` re-enters `runAgentLoop`, `priorConversationCount` is already >6. Clarification gate fires, sets `tool_choice: 'none'`, LLM refuses to continue checking services. Broad-query resumes stop working after first HITL fix. Fix: add `!message.resumedTools` guard to `shouldPauseForClarification`.

**BUG-H4 — MiniMax M2.5 missing from pricing — cost tracking returns $0 for all primary LLM calls**

File: `src/telemetry/usage_tracker.ts` — `PRICING` map. `MiniMax-M2.5` has no entry. Every call logs `cost_usd = 0.000000`. `/usage` slash command shows $0 spend. Fix: add `'MiniMax-M2.5': { in: 0.8, out: 0.8 }` and verify against current MiniMax pricing page.

---

### 🟡 Medium

**BUG-M1 — `sshExec` has no output size limit — large log files flood context window**

File: `src/utils/ssh.ts`. No truncation on SSH output. `cat /var/log/nginx/error.log` on a busy server returns 50MB+ into LLM context and sessions table. Fix: `if (output.length > 50_000) output = output.slice(0, 50_000) + '\n...[truncated at 50KB]'`

**BUG-M2 — Stale TODO in `loop.ts` says HITL is not operational**

File: `src/agents/loop.ts` final comment block. Says "This is the critical missing piece for HITL to be fully operational" — HITL IS fully operational. Misleads any new developer reading the code. Fix: delete the comment or replace with accurate note about what's actually still missing.

**BUG-M3 — `isAllServersRequest()` misses natural language variants**

File: `src/utils/server_registry.ts`. Regex `/\b(all servers|both servers|every server)\b/i` misses "all nodes", "every machine", "all of them". Will be eliminated when intent classifier (Layer 1) is built. No urgent action needed.
