# Phase 5 — Medium + Low Issues

**Timeline:** Ongoing  
**Status:** ⏳ Pending

---

## Medium Issues

| ID | Issue | File(s) | Effort | Status |
|----|-------|---------|--------|--------|
| MED-1 | Replace SSH pool busy-wait polling with `p-limit` semaphore | `src/utils/ssh.ts:100-122` | 2h | ⏳ Pending |
| MED-2 | Unify session message trimming into a single pass. Preserve complete tool_call/tool pairs. | `src/agents/loop.ts:502-510, 755-758` | 3h | ⏳ Pending |
| MED-3 | Cache `getAllServers()` result with 60s TTL — called on every loop iteration | `src/agents/loop.ts:527, 1026` | 1h | ⏳ Pending |
| MED-4 | Replace `ivfflat` with `HNSW` index on `fix_memory` — ivfflat broken on empty tables | `src/database/schema.sql:117-119` | 30 min | ⏳ Pending |
| MED-5 | Move LLM pricing to config file. Log warning for unknown models instead of silently returning $0 | `src/telemetry/usage_tracker.ts:14-30` | 1h | ⏳ Pending |
| MED-10 | Add `.unref()` to SSH pool cleanup `setInterval` | `src/utils/ssh.ts:175-179` | *(done in Phase 0 — QW-5)* | ✅ Done in Phase 0 |

---

## Low Issues

| ID | Issue | File(s) | Effort | Status |
|----|-------|---------|--------|--------|
| LOW-1 | Fix `splitMessage` in Slack to split on paragraph/newline boundaries, not fixed char count | `src/interfaces/slack.ts:459-466` | 1h | ⏳ Pending |
| LOW-2 | Lower ops_alerts memory threshold to 700MB (PM2 restarts at 1024MB with no warning) | `ecosystem.config.cjs`, `src/telemetry/ops_alerts.ts` | 15 min | ⏳ Pending |
| LOW-3 | Document JWT decode trust boundary — acceptable since JWT is from setup-time user input | `src/utils/crypto.ts:42-60` | 15 min | ⏳ Pending |
| LOW-4 | Document `_dbReady` as single-process assumption (acceptable for now) | `src/database/db.ts:8` | 5 min | ⏳ Pending |
| LOW-5 | Add stream backpressure to SSH output — pause stream once output exceeds limit | `src/utils/ssh.ts:192` | 1h | ⏳ Pending |
| LOW-6 | Add `LIMIT 1` to `getSession()` query | `src/database/db.ts` | *(done in Phase 0 — QW-6)* | ✅ Done in Phase 0 |

---

## Definition of Done

- [ ] SSH pool uses semaphore, not busy-wait
- [ ] Session trimming is a single unified pass
- [ ] `getAllServers()` result cached with TTL
- [ ] `fix_memory` uses HNSW index
- [ ] Unknown LLM models log a warning
- [ ] Slack messages split at paragraph boundaries
- [ ] Ops alerts fire before PM2 memory restart threshold
