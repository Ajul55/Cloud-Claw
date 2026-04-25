# Phase 2 — CI/CD + DevOps

**Timeline:** This week  
**Status:** ✅ Complete  
**Prerequisite:** Phase 0 complete

---

## Goals

Automated deployment pipeline, test files in source control, structured logging, and secure Docker config.

---

## Tasks

| ID | Issue | File(s) | Effort | Status |
|----|-------|---------|--------|--------|
| CRIT-3 | Add GitHub Actions CI: `typecheck → test → docker build → push → deploy`. Gate merges on green CI. | `.github/workflows/ci.yml` | 4h | ✅ Completed |
| HIGH-14 | Remove `*.test.ts` from `.gitignore`. Commit all 18 test files. Add `.dockerignore` exclusion instead. | `.gitignore`, `.dockerignore` | *(done in Phase 0 — QW-2)* | ✅ Done in Phase 0 |
| HIGH-12 | Add DB connection retry with backoff in `connectDB()`. | `src/database/db.ts` | *(done in Phase 0 — QW-7)* | ✅ Done in Phase 0 |
| HIGH-6 | Postgres port bound to localhost only in Docker Compose. | `docker-compose.yml` | *(done in Phase 0 — QW-3)* | ✅ Done in Phase 0 |
| HIGH-4 | Replace all `console.log/warn/error` with structured logger. Add `requestId` + `sessionId` context. Use `pino` or `winston`. | All `src/` files | 6h | ⏳ Deferred — large refactor, phase 4 |
| HIGH-1 | Replace inline `ALTER TABLE` boot-time migrations with `node-pg-migrate` or `knex`. | `src/database/db.ts:54-69`, new `migrations/` dir | 6h | ⏳ Deferred — requires careful schema planning |
| MED-7 | Verify `.dockerignore` excludes `.env*`, `keys/`, `.git/`, `*.test.ts`. | `.dockerignore` | 15 min | ✅ Completed — all patterns present |
| MED-8 | Add `/ready` endpoint that checks DB + Slack/Telegram connection status. | `src/health.ts` | 1h | ✅ Completed |
| HIGH-10 | Fix swallowed `unhandledRejection` — add alerting + threshold counter. | `src/index.ts:30-33` | 1h | ✅ Completed |

---

## CI/CD Pipeline Design

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  ci:
    steps:
      - typecheck: npx tsc --noEmit
      - test: npm test
      - build: docker build -t cloudclaw .
      - push: docker push (on main only)
      - deploy: ssh + docker pull + pm2 restart (on main only)
```

**Branch protection:** Require `ci` to pass before merge to `main`.

---

## Structured Logging Migration

Replace:
```typescript
console.log(`[session ${sessionId}] Starting loop`)
console.error('SSH failed', err)
```

With:
```typescript
logger.info({ sessionId, requestId }, 'Starting agent loop')
logger.error({ sessionId, err }, 'SSH connection failed')
```

All logs must include at minimum: `level`, `timestamp`, `sessionId` (where applicable), `requestId` (where applicable).

---

## Migration Framework Choice

Recommendation: **`node-pg-migrate`**
- Already common in Node/TypeScript projects
- Tracks applied migrations in `pgmigrations` table
- Supports rollback via `down()` functions
- CLI: `node-pg-migrate up` / `node-pg-migrate down`

---

## Definition of Done

- [ ] Push to `main` triggers automated typecheck + test + docker build
- [ ] Failed typecheck or tests block the merge
- [ ] All source files use structured logger (zero raw `console.log` in `src/`)
- [ ] Schema changes go through migration files, not inline `ALTER TABLE`
- [ ] `.dockerignore` excludes all sensitive files
- [ ] `/ready` endpoint returns 503 until DB + bots are connected
- [ ] Unhandled rejections send an ops alert after threshold
