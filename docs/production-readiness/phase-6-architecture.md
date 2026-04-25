# Phase 6 — Architecture Improvements

**Timeline:** Future (post-production stabilization)  
**Status:** ⏳ Pending  
**Prerequisite:** Phases 0–3 complete

---

## Goals

Structural changes to support scale, operability, and extensibility. These are week-long initiatives, not weekend fixes.

---

## Tasks

| ID | Improvement | Impact | Effort | Status |
|----|-------------|--------|--------|--------|
| ARCH-3 | Extract dashboard API into its own service/container with a separate DB pool | Isolates dashboard latency from agent response latency | 1 week | ⏳ Pending |
| ARCH-4 | Add bounded incoming message queue per session. Reject with "busy" if queue full. | Prevents memory growth under load | 1 day | ⏳ Pending |
| ARCH-5 | Externalize tool definitions to database/config. Dynamic loading. Per-tenant tool filtering. | Enables adding tools without code deploys | 1 week | ⏳ Pending |

---

## ARCH-3: Dashboard Service Separation

**Current:**
```
Single Node.js process:
  - HTTP Gateway (agent requests)
  - Dashboard API (/api/stats, /api/sessions, etc.)
  - Health endpoint
  - Agent runtime
```

**Target:**
```
cloudclaw-agent (port 3000):
  - HTTP Gateway
  - Agent runtime
  - Slack/Telegram bots

cloudclaw-dashboard (port 3001):
  - Dashboard API
  - Health + metrics
  - Own PostgreSQL pool (read-optimized)
```

A slow dashboard aggregation query can no longer delay an active agent loop response.

---

## ARCH-4: Bounded Message Queue

```typescript
const SESSION_QUEUE_LIMIT = 3

const sessionQueues = new Map<string, string[]>()

function enqueue(sessionId: string, message: string): boolean {
  const queue = sessionQueues.get(sessionId) ?? []
  if (queue.length >= SESSION_QUEUE_LIMIT) return false  // reject: busy
  queue.push(message)
  sessionQueues.set(sessionId, queue)
  return true
}
```

Return `429 { error: 'Session busy, try again shortly' }` when queue is full.

---

## ARCH-5: Dynamic Tool Registry

**Current:** 100+ tools imported at module load time. Adding a tool requires code change + restart.

**Target:**
- Tool definitions stored in `tools` DB table
- `getLLMToolDefinitions(tenantId, intent)` queries DB with filters
- Hot reload: tools updated in DB take effect without restart
- Per-tenant tool enable/disable flags

Schema:
```sql
CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  schema JSONB,
  tier INTEGER DEFAULT 1,
  enabled BOOLEAN DEFAULT true,
  tenant_id UUID REFERENCES accounts(id)
);
```

---

## Dependency Graph

```
ARCH-1 (Redis SSE)     → enables → ARCH-3 (separate services)
ARCH-2 (Job Queue)     → enables → ARCH-3
ARCH-4 (Msg Queue)     → prerequisite for → ARCH-3
ARCH-5 (Dynamic Tools) → independent
```

---

## Definition of Done

- [ ] Dashboard queries do not affect agent response latency
- [ ] Sending 4 rapid messages to one session returns 429 on the 4th
- [ ] New tools can be added via DB insert without restarting the agent process
