# Phase 3 — Redis Migration

**Timeline:** Next sprint  
**Status:** ⏳ Pending  
**Prerequisite:** Phases 0 + 1 + 2 complete

---

## Goals

Replace in-memory state with Redis. Enables PM2 cluster mode, zero-downtime deploys, and horizontal scaling.

---

## Tasks

| ID | Issue | File(s) | Effort | Status |
|----|-------|---------|--------|--------|
| CRIT-1 | Replace in-memory SSE bus (`sessionBus`, `replayBuffer`, `sessionSeq`) with Redis pub/sub | `src/interfaces/http_gateway.ts:18-32` | 2-3 days | ⏳ Pending |
| CRIT-2 | Replace in-memory `activeSessions` Map with Redis counters + TTL | `src/services/session_limiter.ts:32` | 1 day | ⏳ Pending |
| ARCH-2 | Wire up the already-installed `pg-boss` (or use Redis queues) for job queue decoupling | `src/interfaces/http_gateway.ts` | 2-3 days | ⏳ Pending |

> Note: QW-1 in Phase 0 removes `pg-boss` since it was dead code. If ARCH-2 is pursued, reinstall it then.

---

## Redis Infrastructure Setup

Add Redis to Docker Compose:
```yaml
redis:
  image: redis:7-alpine
  networks: [cloudclaw-net]
  volumes: [redis-data:/data]
  command: redis-server --appendonly yes
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
```

Add to `.env`:
```
REDIS_URL=redis://redis:6379
```

---

## CRIT-1: SSE Bus Migration

**Current (broken across restarts/instances):**
```typescript
const sessionBus = new Map<string, EventEmitter>()
const replayBuffer = new Map<string, string[]>()
```

**Target (Redis pub/sub):**
```typescript
// Publisher side (agent loop)
await redisPublisher.publish(`cloudclaw:session:${sessionId}`, JSON.stringify(event))

// SSE endpoint side (one subscriber per SSE connection)
const subscriber = redis.duplicate()
await subscriber.subscribe(`cloudclaw:session:${sessionId}`)
subscriber.on('message', (channel, message) => {
  res.write(`data: ${message}\n\n`)
})
req.on('close', () => subscriber.unsubscribe())
```

Replay buffer: Store last N events per session in a Redis list (`RPUSH` + `LTRIM`).

---

## CRIT-2: Session Limiter Migration

**Current (resets on restart):**
```typescript
const activeSessions = new Map<string, number>()
```

**Target (Redis with TTL auto-expiry):**
```typescript
// Acquire: INCR cloudclaw:sessions:{userId} with 10-min TTL
// Release: DECR cloudclaw:sessions:{userId}
// Limit check: GET cloudclaw:sessions:{userId} >= MAX_SESSIONS
```

Use `SET NX` + TTL for slot acquisition to prevent phantom leaks on crash.

---

## ARCH-2: Job Queue (Optional but Recommended)

Decouple HTTP request lifecycle from agent loop:
1. `POST /api/chat` → enqueue job → return `202 { jobId }`
2. Worker process picks up job → runs `runAgentLoop()` → publishes results to Redis
3. SSE endpoint subscribes to session channel for streaming results

This eliminates the 202 + background promise pattern that causes CRIT-6 race conditions.

---

## Definition of Done

- [ ] PM2 cluster mode (`instances: 2`) works without SSE drops
- [ ] PM2 restart does not reset session concurrency limits
- [ ] SSE replays last N events on reconnect
- [ ] Redis added to `docker-compose.yml` with persistence
- [ ] `REDIS_URL` in `.env.example`
