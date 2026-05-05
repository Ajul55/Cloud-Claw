# Cloud-Claw

**Lean AIOps hub — autonomous server diagnostics and remediation via Slack and Telegram.**

Cloud-Claw is a Node.js bot that connects to your Slack workspace or Telegram account and acts as an on-call engineer for your Linux servers. You describe a problem in plain English; the agent SSHs into the relevant server, diagnoses the issue using a suite of purpose-built tools, and either applies a fix autonomously or holds the action for your approval before executing it.

---

## How it works

1. You send a message: *"nginx is down on the production server"*
2. Cloud-Claw classifies your intent, picks the right diagnostic tools, and SSHs into the server
3. The agent runs `diagnose_nginx`, reads error logs, identifies the config fault
4. If a fix is needed, it proposes `fix_nginx_config` — a Tier-3 (destructive) action that requires your `/approve` before it runs
5. You approve; the fix runs; the agent confirms nginx is healthy

All SSH output is sanitized for prompt injection and credential leaks before it enters the LLM context. Write operations cannot run unless a prior diagnostic tool has already been executed in the same session ("earn the fix" rule), enforced deterministically in code — not by the LLM.

---

## Features

- **Natural language interface** over Slack (Socket Mode — no public URL) or Telegram
- **50+ tools**: nginx/PHP/MySQL diagnostics and fixes, WordPress management, disk cleanup, SSL/TLS, Cloudflare cache, DNS, firewall (UFW/CSF), cron jobs, database users, and the full [Cloudstick](https://cloudstick.io) hosting panel API
- **Human-in-the-loop (HITL)**: Tier-3 (write) actions pause for `/approve` or `/reject`. Slack sends interactive Block Kit buttons; Telegram sends command prompts
- **4-layer guard architecture**: intent classification → pre-tool sequence enforcer → post-tool sanitizer → hallucination receipt auditor (see [Architecture](#architecture))
- **Semantic fix memory**: past problem/fix pairs stored as vector embeddings (Voyage AI + pgvector) and retrieved at session start
- **LLM provider-agnostic**: MiniMax M2.7, OpenAI, Anthropic (via LiteLLM proxy), or Groq — switchable at runtime
- **Multi-tenant**: each Slack/Telegram user registers their own Cloudstick credentials; SSH keys stored AES-256-GCM encrypted
- **Private Cloudstick gateway**: server-to-server HTTP/SSE integration signed with HMAC-SHA256, never a browser-exposed bearer key
- **SSH certificate auth**: optional CA-signed short-lived certificates instead of long-lived private keys
- **Single-worker PM2 runtime**: intentionally pinned to one process until the in-memory SSE bus is replaced by Redis/RabbitMQ

---

## Requirements

- Node.js 20+
- PostgreSQL 15+ with [pgvector](https://github.com/pgvector/pgvector) extension (optional but recommended)
- A Slack app with Socket Mode enabled **or** a Telegram bot token
- SSH access to your managed servers (key-based or certificate-based)

---

## Installation

```bash
git clone https://github.com/your-org/cloud-claw.git
cd cloud-claw
npm install
```

### Database setup

```bash
# Create the database and run the schema
createdb cloudclaw
DATABASE_URL=postgresql://localhost/cloudclaw npm run db:init
```

The schema creates the `vector` extension automatically. Your PostgreSQL user must have permission to run `CREATE EXTENSION`.

### Environment variables

Copy and fill in `.env`:

```env
# ── LLM ───────────────────────────────────────────────────────────────────────
LLM_PROVIDER=minimax          # openai | anthropic | groq | minimax
LLM_MODEL=MiniMax-M2.5
LLM_API_KEY=your_key_here
# LLM_BASE_URL=               # set for Anthropic via LiteLLM proxy

# Optional per-provider keys (override LLM_API_KEY for that provider)
# ANTHROPIC_API_KEY=
# GROQ_API_KEY=
# MINIMAX_API_KEY=

# ── Slack (primary interface) ─────────────────────────────────────────────────
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_USER_ID=U...            # only this user's messages are processed

# ── Telegram (optional) ───────────────────────────────────────────────────────
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_USER_ID=           # numeric — only this user's messages are processed

# ── Sentinel ─────────────────────────────────────────────────────────────────
# PILOT_CHAT_ID=              # Telegram chat ID or Slack channel ID for morning briefings

# ── Cloudstick ────────────────────────────────────────────────────────────────
CLOUDSTICK_API_BASE=https://api.cloudstick.io
# CLOUDSTICK_WS_BASE=         # set if WebSocket runs on a different host/port
CLOUDSTICK_API_KEY=
CLOUDSTICK_API_SECRET=
CLOUDSTICK_USER_ID=

# ── Cloudstick Gateway (optional private HTTP API) ───────────────────────────
# Generate with: openssl rand -hex 32
# Used as the HMAC-SHA256 signing key for X-CloudClaw-Signature.
CLOUDSTICK_GATEWAY_KEY=
CLOUDSTICK_GATEWAY_SIGNATURE_TOLERANCE_SECONDS=300

# ── Cloudflare ────────────────────────────────────────────────────────────────
# CLOUDFLARE_API_TOKEN=
# CLOUDFLARE_ZONE_ID=
# CLOUDFLARE_DOMAIN=

# ── SSH ───────────────────────────────────────────────────────────────────────
SSH_PRIVATE_KEY_PATH=/home/deploy/.ssh/cloud_agent_ed25519
SSH_USER=cloud-agent           # default SSH user for managed servers
# SSH_CA_KEY_PATH=             # path to CA private key (enables certificate auth)
ENCRYPTION_KEY=                # 64-char hex — used to encrypt per-user SSH keys at rest

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://localhost/cloudclaw

# ── Voyage AI (semantic fix memory) ──────────────────────────────────────────
# VOYAGE_API_KEY=
# VOYAGE_MODEL=voyage-code-2

# ── SRE Search (web search for runbooks) ──────────────────────────────────────
# SERPAPI_KEY=
```

---

## Running

### Development (hot-reload)

```bash
npm run dev
```

### Production (PM2, single worker)

```bash
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 logs cloudclaw
pm2 reload ecosystem.config.cjs   # zero-downtime restart
```

The PM2 config uses one worker on purpose. The HTTP gateway currently keeps SSE streams and replay buffers in process memory, so multi-worker routing can strand a stream on the wrong worker. Move the SSE bus and background approval jobs to Redis/RabbitMQ before raising `instances`.

### Healthcheck

A lightweight HTTP server listens on port `9000`:

```bash
curl http://localhost:9000/health
```

---

## Slack app setup

1. Create a new app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** under *Settings → Socket Mode* — generates your `SLACK_APP_TOKEN` (`xapp-…`)
3. Under *OAuth & Permissions*, add bot scopes: `chat:write`, `channels:read`, `im:history`, `app_mentions:read`
4. Under *Event Subscriptions → Subscribe to bot events*: `message.im`, `app_mention`
5. Install the app to your workspace — copy the `SLACK_BOT_TOKEN` (`xoxb-…`)
6. Invite the bot to the channel you intend to use

---

## Telegram bot setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copy the token into `TELEGRAM_BOT_TOKEN`
3. Send your bot a message, then set `TELEGRAM_USER_ID` to your numeric Telegram ID (get it from [@userinfobot](https://t.me/userinfobot))

---

## Usage

### Diagnostics

```
nginx is throwing 502 on the production server
check disk space on all nodes
is MySQL up?
run a full audit on the test server
```

### Fixes (require /approve)

```
fix the nginx config on production
renew the SSL cert for example.com
clean up disk space — it's at 95%
restart php-fpm on the web server
```

### Slash commands

| Command | Description |
|---|---|
| `/setup <api_key> <api_secret>` | Register your Cloudstick API credentials (user ID auto-extracted from JWT) |
| `/setkey <private_key> <public_key>` | Store your SSH private key (encrypted AES-256-GCM at rest) |
| `/nodes` | List managed servers |
| `/status` | Show active agent sessions and current LLM config |
| `/sessions` | Detailed session state (messages, iteration count) |
| `/usage` | Token usage and cost summary |
| `/approve <id>` | Approve a pending Tier-3 action |
| `/reject <id> [reason]` | Reject a pending action |
| `/clear` | Clear your current session context |
| `/model <provider> <model>` | Switch LLM at runtime (e.g. `/model openai gpt-4o`) |

---

## Architecture

### Agent loop

The core is `src/agents/loop.ts` — an LLM ↔ Tool ↔ HITL cycle with a 15-iteration guard. Each user message drives one loop invocation. Tool results feed back into the LLM context; Tier-3 results pause the loop and write to `approval_queue`.

### Cloudstick gateway shift

The private gateway no longer accepts a raw shared-secret bearer header. Cloudstick backend signs each request with HMAC-SHA256 using `CLOUDSTICK_GATEWAY_KEY`:

```
payload = METHOD + "\n" + PATH_WITH_QUERY + "\n" + TIMESTAMP + "\n" + RAW_BODY
X-CloudClaw-Timestamp: <ISO timestamp>
X-CloudClaw-Signature: sha256=<hex hmac>
```

Approval decisions now return `202 Accepted` immediately and continue the approved action in the background over the existing SSE stream. Usage reads are tenant-locked: `/api/usage/:accountId` only succeeds when `:accountId` matches `X-Cloudstick-Account-Id`.

Credential context precedence is explicit: if a request already has an `AsyncLocalStorage` Cloudstick context, the agent loop preserves it. Otherwise, Slack/Telegram users are looked up from `users`; if no scoped user exists, Cloudstick API calls fall back to environment credentials for single-tenant deployments.

### 4-layer guard architecture

```
Pilot input
  │
  ▼
[Layer 1] Intent Classifier (src/agents/intent_classifier.ts)
  One LLM call → typed Intent object (requiresTool, toolHint, isAudit,
  targetServer, domains …). Hardcoded regex runs after and can only
  make results more restrictive — security gates are never LLM-only.
  │
  ▼
Agent iterations (up to 15)
  │
  ▼
[Layer 2] Pre-Tool Guard (src/agents/tool_guard.ts → preToolGuard)
  Deterministic rules — no LLM involved:
  • "Earn the Fix": fix_nginx_config blocked unless diagnose_nginx
    receipt exists in the current session
  • Audit lock: all write tools blocked when isAudit === true
  • No fan-out writes: write tools cannot target server "all"
  • SSH rate limit: max 30 SSH calls per session
  • Command blocklist: checked against src/security/command_filter.ts
  │
  ▼
tool.execute()   ←─── SSH / Cloudstick API / Cloudflare API
  │
  ▼
[Layer 3] Post-Tool Guard (src/agents/tool_guard.ts → postToolGuard)
  Sanitizes SSH output before it enters LLM context:
  • Prompt injection detection ("ignore previous instructions", etc.)
  • Credential masking: wp-config.php passwords, .env KEY=VALUE,
    private key blocks, database connection strings
  │
  ▼
[Layer 4] Hallucination Guard (src/agents/hallucination_guard.ts)
  Map<string, ToolReceipt> tracks whether each tool succeeded (not
  just ran). "Fix applied" claims after a failed fix_nginx_config
  are caught and blocked. Host-aware: a write receipt on server-A
  does not suppress detection for claims about server-B. Receipts
  are persisted to sessions.receipts JSONB so HITL resume doesn't
  reset them.
  │
  ▼
Pilot output
```

### Database schema (key tables)

| Table | Purpose |
|---|---|
| `sessions` | Conversation messages + tool receipts per `platform:user_id` |
| `approval_queue` | Pending HITL approvals with encoded tool call args |
| `servers` | Registered SSH targets (label, IP, user, port) |
| `fix_memory` | Past fix embeddings (vector(1536)) for semantic retrieval |
| `causality_map` | Discovered WordPress stack topology per domain |
| `usage_log` | LLM token usage and USD cost per call |
| `users` | Per-pilot Cloudstick credentials and encrypted SSH keys |

### Adding a tool

1. Create `src/tools/my_tool.ts` exporting an object that satisfies the `Tool` interface (`src/tools/types.ts`)
2. Register it in `src/tools/tool_registry.ts`
3. If it is a write tool: add it to the `WRITE_TOOLS` Set in `loop.ts` and add a case in `getToolApprovalRequest()`

### SSH connection pooling

`src/utils/ssh.ts` maintains a per-host connection pool (max 2 connections, 60 s idle timeout) to avoid triggering fail2ban on busy servers with repeated rapid reconnects.

---

## Testing

Tests use [Vitest](https://vitest.dev/). Guards and security modules are fully testable without LLM calls or SSH connections.

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run src/agents/tool_guard.test.ts
npx vitest run src/agents/hallucination_guard.test.ts
npx vitest run src/security/command_filter.test.ts
```

---

## Security model

- **Command filter** (`src/security/command_filter.ts`): Three-lane classifier — hard block list (destructive commands, fork bombs, curl-pipe-bash), safe read-only binary whitelist, dual-purpose tool safe-subcommand allowlist. SSH write commands route to Lane 3 (emergency writes — require HITL).
- **SSH key injection blocked**: patterns like `echo ssh-ed25519 >> authorized_keys` are blocked at the command filter before any SSH session opens.
- **Sensitive path blocking**: `/etc/shadow`, `/etc/sudoers`, and private key files are blocked from being read.
- **Credential masking**: `postToolGuard()` strips passwords and secrets from SSH output before they reach the LLM or the database.
- **Per-user key encryption**: SSH private keys and Cloudstick API credentials stored in the `users` table are AES-256-GCM encrypted using `ENCRYPTION_KEY`.
- **Identity whitelist**: the bot only responds to the configured `SLACK_USER_ID` / `TELEGRAM_USER_ID`.
