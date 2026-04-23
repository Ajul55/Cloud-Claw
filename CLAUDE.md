# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

---

## Project Purpose

Cloud-Claw is an AIOps hub — an autonomous server diagnostics and remediation agent delivered via Slack and Telegram bots. Pilots (operators) send natural-language messages; the agent SSHs into registered servers, diagnoses problems, and proposes or executes fixes. Destructive actions require human approval (HITL) before execution.

---

## Commands

```bash
npm run dev          # tsx watch — hot-reload dev server
npm run build        # tsc compile to dist/
npm run start        # build + run dist/src/index.js
npm run typecheck    # tsc --noEmit (no output)
npm run db:init      # psql $DATABASE_URL -f src/database/schema.sql

# Run a single test file
npx vitest run src/agents/tool_guard.test.ts

# PM2 production cluster (2 workers)
pm2 start ecosystem.config.cjs --env production
pm2 reload ecosystem.config.cjs   # zero-downtime restart
```

The project uses ESM (`"type": "module"`). All imports must use `.js` extensions even for `.ts` source files.

---

## Architecture

### Entry Point & Boot Sequence (`src/index.ts`)

1. Validate env (Zod schema in `src/config/env.ts`)
2. Connect PostgreSQL (`src/database/db.ts`) — optional; runs memoryless without `DATABASE_URL`
3. Start health server on port 9000 (`src/health.ts`)
4. Start Telegram bot (`src/interfaces/telegram.ts`) — optional
5. Start Slack Socket Mode app (`src/interfaces/slack.ts`) — primary interface
6. Schedule cron jobs: stale approval expiry (5 min), session timeout (10 min), fix_memory TTL cleanup (3 AM daily)
7. Start Sentinel heartbeat scheduler (`src/sentinel/scheduler.ts`)

### Agent Loop (`src/agents/loop.ts`)

The core LLM ↔ Tool ↔ HITL cycle. Entry point is `runAgentLoop()`. Each incoming message drives up to 15 iterations. The loop implements the **4-Layer Guard Architecture**:

```
Pilot input
  → [Layer 1] classifyIntent()       — LLM semantic routing + hardcoded audit override
  → Agent iterations
      → [Layer 2] preToolGuard()     — sequence enforcer, "earn the fix", rate limiter
      → tool.execute()               — SSH / API call
      → [Layer 3] postToolGuard()    — injection detection + data masking
  → [Layer 4] checkForHallucination() — receipt-based output auditor
  → Pilot output
```

**Layer 1 — Intent Classifier** (`src/agents/intent_classifier.ts`): Single LLM call returns a typed `Intent` object (requiresTool, toolHint, targetServer, domains, isAudit, etc.). Hardcoded regex runs after and can only make results *more* restrictive — security gates are never prediction-only.

**Layer 2 — Pre-Tool Guard** (`src/agents/tool_guard.ts` → `preToolGuard()`): Deterministic rules — no LLM involved:
- "Earn the Fix": `fix_nginx_config` is blocked unless a `diagnose_nginx` receipt exists in the current session
- Audit lock: all write tools blocked when `isAudit === true`
- No fan-out writes: write tools cannot target `server_label = 'all'`
- SSH rate limit: max 30 SSH calls per session
- Command blocklist: SSH command args checked against `src/security/command_filter.ts`

**Layer 3 — Post-Tool Guard** (`src/agents/tool_guard.ts` → `postToolGuard()`): Sanitizes SSH output before it enters the LLM context window — scans for prompt injection patterns and masks credentials (wp-config.php passwords, `.env` KEY=VALUE, private key blocks, DB connection strings).

**Layer 4 — Hallucination Guard** (`src/agents/hallucination_guard.ts`): Uses `Map<string, ToolReceipt>` (not just a `Set<string>`) — tracks whether each tool *succeeded*, not just whether it ran. Receipts are serialized into the `sessions.receipts` JSONB column so HITL resume doesn't lose them.

### HITL Approval Flow (`src/hitl/`)

Tier-3 tool calls (destructive fixes) pause the loop and write a row to `approval_queue`. The pilot replies `/approve <id>` or `/reject <id>`. `resume.ts` reconstructs the session from DB, restores receipts, and re-enters `runAgentLoop()` with the tool result pre-filled.

### Tools (`src/tools/`)

50+ tools registered in `src/tools/tool_registry.ts`. Every tool exports an object matching the `Tool` interface (`src/tools/types.ts`). Tool categories:
- **SSH diagnostics**: `diagnose_nginx`, `diagnose_services`, `diagnose_domain`, `check_ssl`, `repair_mysql`, etc.
- **SSH write/fix**: `fix_nginx_config`, `fix_wordpress`, `cleanup_disk`, `execute_ssh_write`, `create_nginx_vhost`
- **Cloudstick API**: `src/tools/cloudstick/` — PHP, firewall, services, website settings, file manager, supervisor, email
- **Cloudflare**: `cloudflare_cache_purge`, `manage_cloudflare_dns`
- **SRE tooling**: `sre_search` (web search), `fix_memory_search` (semantic past-fix lookup)

To add a new tool: implement it, add to `tool_registry.ts`, add a case in `getToolApprovalRequest()` if it's a write tool, and add to `WRITE_TOOLS` Set in `loop.ts`.

### LLM Provider (`src/llm/provider.ts`)

Provider-agnostic via OpenAI-compatible SDK. Supports `openai`, `anthropic` (via LiteLLM proxy), `groq`, `minimax`. Configured via `LLM_PROVIDER` + `LLM_MODEL` env vars. Provider can be switched at runtime with `setGlobalLLMOverride()`.

### Database (`src/database/`)

PostgreSQL with pgvector extension. Key tables:
- `sessions` — conversation messages + tool receipts (JSONB), per `platform:user_id`
- `approval_queue` — pending HITL approvals
- `servers` — registered SSH targets with label, IP, ssh_user, ssh_port
- `fix_memory` — past fix embeddings (vector(1536)) for semantic search via Voyage AI
- `causality_map` — discovered WordPress stack topology per client/domain
- `usage_log` — LLM token usage and cost tracking
- `users` — per-pilot Cloudstick credentials (API key/secret encrypted AES-256-GCM) and SSH keys

### Fix Memory (`src/memory/fix_memory.ts`)

Stores problem/fix pairs as Voyage AI embeddings in `fix_memory` table. `searchFixes()` does cosine similarity search so the LLM sees relevant past solutions at session start. Embeddings use `voyage-code-2` model.

### Slash Commands (`src/commands/slash_handler.ts`)

`/setup`, `/status`, `/sessions`, `/nodes`, `/usage`, `/clear`, `/approve <id>`, `/reject <id> [reason]`, `/model <provider> <model>`, `/ssh <key>`

### Multi-Tenancy (`src/services/user_service.ts`)

Each Slack/Telegram user can register their own Cloudstick API credentials via `/setup`. SSH private keys are stored AES-256-GCM encrypted (key from `ENCRYPTION_KEY` env var). The agent resolves per-user credentials in `runWithCloudstickContext()` (`src/api/cloudstick_context.ts`).

### Cloudstick Integration (`src/api/`)

`cloudstick_client.ts` — REST client wrapping the Cloudstick hosting panel API. `multi_cloudstick_client.ts` — multi-tenant variant. WebSocket URL defaults to `CLOUDSTICK_API_BASE` with protocol swap unless `CLOUDSTICK_WS_BASE` is set.

---

## Key Invariants

- **"Earn the Fix"**: No write tool runs without a corresponding read/diagnose receipt in the current session. This is enforced deterministically in `preToolGuard()`, not by the LLM.
- **Audit lock**: When `isAudit === true`, all `WRITE_TOOLS` are blocked regardless of LLM intent.
- **Security gates are deterministic**: `isAudit` may start as an LLM classification, but hardcoded regex always runs afterward and can only escalate — never downgrade — the restriction.
- **Data masking before LLM context**: `postToolGuard()` must run before SSH output enters the messages array or the sessions table. Credentials must never reach LLM context.
- **Receipts persist across HITL**: `sessions.receipts` JSONB must be hydrated back into the `Map<string, ToolReceipt>` on resume — otherwise the hallucination guard is blind for the resumed session.
