# Phase 1 — Critical Reliability

**Timeline:** This week  
**Status:** ✅ Complete  
**Prerequisite:** Phase 0 complete

---

## Goals

Fix the critical runtime bugs that cause data loss, silent failures, or system hangs under real load.

---

## Tasks

| ID | Issue | File(s) | Effort | Status |
|----|-------|---------|--------|--------|
| CRIT-5 | Wrap all `runAgentLoop()` calls in a global `AbortController` with 3-min hard timeout. Propagate cancellation to SSH and LLM calls. | `src/agents/loop.ts`, `src/interfaces/slack.ts`, `src/interfaces/telegram.ts` | 4h | ✅ Completed |
| CRIT-6 | Add per-session mutex to prevent concurrent loops on the same sessionId. Queue incoming messages for active sessions. | `src/agents/loop.ts`, `src/interfaces/http_gateway.ts` | 4h | ✅ Completed |
| CRIT-7 | Add SSH connection liveness check before reuse. Either `conn.exec('echo ok')` ping with 2s timeout, or `keepaliveInterval: 10000` + listen for `end`/`error` to evict from pool. | `src/utils/ssh.ts:88-96` | 3h | ✅ Completed |
| CRIT-8 | Cap session `messages` JSONB at 50KB. Load only the last N messages (not `SELECT *`). Archive old messages to a separate `session_messages` table. | `src/database/db.ts`, `src/agents/loop.ts:502-510` | 6h | ✅ Completed |
| MED-9 | Wrap `resolveApproval` + `upsertSession` in a PostgreSQL transaction to prevent split-brain on crash. | `src/hitl/resume.ts` | 2h | ✅ Completed |

---

## Implementation Notes

### CRIT-5: AbortController Pattern
```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 3 * 60 * 1000)
try {
  await runAgentLoop(sessionId, message, { signal: controller.signal })
} finally {
  clearTimeout(timeout)
}
```
Pass `signal` into SSH exec and LLM calls. Check `signal.aborted` at each loop iteration.

### CRIT-6: Session Mutex Pattern
```typescript
// In-memory map of active loop promises
const activeLoops = new Map<string, Promise<void>>()

async function enqueueMessage(sessionId: string, message: string) {
  const existing = activeLoops.get(sessionId)
  if (existing) await existing  // wait for current loop to finish
  const loopPromise = runAgentLoop(sessionId, message)
  activeLoops.set(sessionId, loopPromise)
  loopPromise.finally(() => activeLoops.delete(sessionId))
}
```

### CRIT-7: SSH Liveness Check
```typescript
async function isConnectionAlive(conn: Client): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 2000)
    conn.exec('echo ok', (err, stream) => {
      clearTimeout(timer)
      resolve(!err)
      stream?.destroy()
    })
  })
}
```

### CRIT-8: Session Message Cap
- Add a `SELECT id, messages[last 20]` query instead of `SELECT *`
- Enforce 50KB cap in `upsertSession()` before writing
- Create `session_messages` archive table for overflow

---

## Definition of Done

- [ ] No Slack/Telegram request runs longer than 3 minutes without cancellation
- [ ] Sending two rapid messages on same session queues them, not races
- [ ] Stale SSH connections are evicted from pool before being returned
- [ ] Sessions with 100+ messages still perform well (no JSONB > 50KB)
- [ ] Approval resume + session update are atomic (single transaction)
