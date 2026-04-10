---
name: cloudclaw-architecture
description: "Read this FIRST before doing any work on Cloud-Claw. Covers the full system design, philosophy, technology stack, folder structure, data flow, and 5-level build roadmap. If you are about to add a feature, fix a bug, or create a new file in this project — read this skill first."
---

# Cloud-Claw — System Architecture

## What Cloud-Claw Is

Cloud-Claw is an **Autonomous AIOps Hub** that lets a 3-person team manage
500+ Linux VPS servers via Telegram and Slack. It auto-resolves recurring
tickets (502s, nginx errors, WordPress white screens, SSL issues, resource
spikes) without human intervention where safe, and routes to a human Pilot
for approval when a write operation is needed.

**Mission**: Replace a 10-person DevOps team with 3 AIOps Pilots.
**Target**: 85% auto-resolution of recurring tickets.

---

## The Straitjacket Philosophy

This is the most important design principle. Read it before touching any code.

> The AI fills templates. It never writes raw scripts.
> The AI calls registered tools. It never executes arbitrary commands.
> Every write operation requires a human Proceed/Reject.

This means:
- No open web ports on the Hub VPS
- No AI-generated shell scripts executed directly
- All SSH commands go through `execute_ssh_command` tool with blocklist
- All write operations go through HITL approval gate
- The AI cannot do anything that isn't in the tool registry

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js / TypeScript |
| API | Cloudstick V2 (Server-Level Resource Architecture) |
| LLM | Claude Sonnet (primary), MiniMax M2.5 (fallback) |
| LLM Client | OpenAI-compatible SDK (`getLLMClient()`) |
| Messaging | Telegram (long-poll) + Slack (Socket Mode) |
| Firewall | CSF (ConfigServer Security & Firewall) — Native support |
| SSH | ssh2 library — hub-agent restricted user |
| Database | PostgreSQL + pgvector |
| Scheduler | node-cron |
| Auth | SSH private key, no passwords |

---

## Folder Structure

```
src/
  index.ts                  ← Entry point — boots Telegram + Slack
  agents/
    loop.ts                 ← THE CORE — agentic reasoning loop
  tools/
    tool_registry.ts        ← All tools registered here
    types.ts                ← Shared interfaces
    execute_ssh_command.ts  ← SSH command execution tool
    diagnose_nginx.ts       ← Nginx diagnostics tool
    fix_nginx_config.ts     ← Nginx config repair tool
    discovery_agent.ts      ← WordPress stack mapper
    get_current_time.ts     ← Smoke test tool
  security/
    command_filter.ts       ← Blocklist + Tier-3 classifier
  hitl/
    tool_approval.ts        ← Encodes tool approval requests
    resume.ts               ← Resumes session after approval
  database/
    db.ts                   ← PostgreSQL queries
  llm/
    provider.ts             ← Multi-LLM hot-swap
  config/
    env.ts                  ← Environment config
    stack_profile.ts        ← Server stack configuration
  telemetry/
    usage_tracker.ts        ← Token + cost tracking
  utils/
    status_indicator.ts     ← Typing indicators for Slack/Telegram
    ssh.ts                  ← Shared SSH exec utility
```

---

## Data Flow — One Request

```
User sends message in Slack or Telegram
         ↓
src/index.ts receives message
         ↓
Builds IncomingMessage { sessionId, userId, channel, text }
         ↓
Calls runAgentLoop(message, onReply, onApproval, indicator)
         ↓
loop.ts loads session history from PostgreSQL
         ↓
Appends user message to history
         ↓
Calls LLM with system prompt + history + tool definitions
         ↓
    ┌─── LLM returns tool call ───┐
    │                             │
    ↓                             ↓
Execute tool              LLM returns text reply
    ↓                             ↓
Push result to history     Send to user via onReply()
    ↓                             ↓
Loop again                  Persist session to DB
    ↓
(repeat up to 10 iterations)
```

---

## The 3-Layer Prompting Stack

Every LLM call uses three conceptual layers baked into SYSTEM_PROMPT:

**Layer 1 — Identity** (permanent, never changes)
- Who Cloud-Claw is
- What server it manages
- The Straitjacket rules

**Layer 2 — Logic** (per-session, injected from Causality Map)
- Tool usage rules
- Service names and paths for this server
- Available tools and when to use them

**Layer 3 — Constraint** (Guardian)
- HONESTY RULES — cannot claim success without tool evidence
- NEVER ask user for confirmation before tool calls
- NEVER print internal syntax in chat

---

## Security Model — 3 Tiers

| Tier | What | Example | Action |
|---|---|---|---|
| Tier 1 | Read-only diagnostics | `systemctl status nginx` | Execute immediately |
| Tier 2 | Safe writes | `systemctl restart nginx` | Execute immediately |
| Tier 3 | Infrastructure changes | `csf -a 1.2.3.4`, `rm` | HITL approval required |

The `command_filter.ts` file classifies every command before execution.
Blocklisted commands (e.g. `rm -rf /`) are rejected outright.
Tier-3 commands pause the loop and send an approval card to the Pilot.

---

## Database Schema (PostgreSQL)

```sql
-- Active agent sessions
ai_sessions (
  id          TEXT PRIMARY KEY,   -- sessionId = userId + channel
  channel     TEXT,               -- 'telegram' | 'slack'
  user_id     TEXT,
  messages    JSONB,              -- full conversation history
  iteration   INT,
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
)

-- HITL approval requests
hitl_approvals (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT,
  command     TEXT,               -- encoded tool command or raw bash
  target_host TEXT,
  rationale   TEXT,
  status      TEXT,               -- 'pending' | 'approved' | 'rejected' | 'expired'
  approved_by TEXT,
  created_at  TIMESTAMPTZ
)

-- Token + cost tracking
usage_log (
  id           SERIAL PRIMARY KEY,
  session_id   TEXT,
  model        TEXT,
  tokens_in    INT,
  tokens_out   INT,
  latency_ms   INT,
  tool_name    TEXT,
  created_at   TIMESTAMPTZ
)

-- Level 2: Semantic fix memory
fix_memory (
  id          SERIAL PRIMARY KEY,
  issue_type  TEXT,
  symptoms    TEXT,
  fix_applied TEXT,
  outcome     TEXT,
  embedding   vector(1536),       -- pgvector
  created_at  TIMESTAMPTZ
)
```

---

## 5-Level Build Roadmap

### Level 1 — Foundation (COMPLETE)
- ✅ Hub VPS, PostgreSQL, Telegram + Slack bots
- ✅ ssh2 SSH bridge, execute_ssh_command, diagnose_nginx
- ✅ 3-Layer Prompting Stack
- ✅ Tool registry + command_filter
- ✅ HITL approval lifecycle + Slack card rendering
- ✅ V2 Server-Level API Migration (Cron, Databases)

### Level 4 — Power Skills (ACTIVE)
- 🚀 CSF Firewall Native Support (IP blocks, whitelists, ports)
- 🚀 Forensic 502 Diagnostics (PHP pool auditing, socket verification)
- 🚀 Cloudstick Internal Log Reading (/var/log/cloudstick)
- 🚀 V2 Cloudflare DNS Migration (In Progress)

### Level 5 — Heartbeat (NOT STARTED)
- node-cron scheduler (morning briefings, fleet sweeps)
- LoRA fine-tuning pipeline
- AIOps Pilot Console v3

---

## Key Interfaces (src/tools/types.ts)

```typescript
interface IncomingMessage {
  sessionId: string;   // unique per user+channel combination
  userId: string;
  channel: string;     // 'telegram' | 'slack'
  text?: string;
}

type ReplyFn = (text: string) => Promise<void>;

type ApprovalFn = (req: {
  approvalId: number;
  command: string;
  targetHost: string;
  rationale: string;
}) => Promise<void>;

interface ToolResult {
  success: boolean;
  output: string;      // always a string — shown to LLM as tool result
}
```

---

## What NOT to Build (Rejected Features)

These were explicitly rejected — do not add them:
- SQLite (PostgreSQL is already running)
- Markdown memory files (pgvector handles this)
- Knowledge Graph
- Browser Automation
- Container Sandbox
- MCP Bridge
- Self-Evolving Memory
- Open web ports on Hub VPS
- AI-generated shell scripts executed directly
