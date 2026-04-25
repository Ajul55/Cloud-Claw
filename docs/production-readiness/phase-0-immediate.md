# Phase 0 — Secrets Audit + Quick Wins

**Timeline:** Same day  
**Status:** 🔄 In Progress

---

## Goals

Eliminate the highest-risk, lowest-effort issues. All items here are under 15 minutes each.

---

## Tasks

### 🔴 Secrets Audit (Do First)

| ID | Task | File | Status |
|----|------|------|--------|
| CRIT-4 | Check if `.env` was ever committed to git history | `git log --all --diff-filter=A -- .env .env.docker` | ✅ Completed |
| HIGH-11 | Verify `.env.docker` not in git history | same command | ✅ Completed |

> **If either file appears in git history:** Stop. Rotate ALL secrets immediately — `LLM_API_KEY`, `CLOUDSTICK_API_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`. Then use `git filter-repo` to scrub history.

---

### ⚡ Quick Wins

| ID | Task | File | Effort | Status |
|----|------|------|--------|--------|
| QW-1 | Remove `pg-boss` from dependencies — it's installed but never used | `package.json` | 1 min | ✅ Completed |
| QW-2 | Remove `*.test.ts` from `.gitignore` — tests must be in source control | `.gitignore` | 1 min | ✅ Completed |
| QW-3 | Bind Postgres port to `127.0.0.1:5433:5432` instead of `5433:5432` | `docker-compose.yml` | 1 min | ✅ Completed |
| QW-4 | Remove hardcoded server IPs from `schema.sql` seed data | `src/database/schema.sql` | 5 min | ✅ Completed |
| QW-5 | Add `.unref()` to SSH pool cleanup `setInterval` | `src/utils/ssh.ts:175` | 1 min | ✅ Completed |
| QW-6 | Add `LIMIT 1` to `getSession()` query | `src/database/db.ts` | 1 min | ✅ Completed |
| QW-7 | Add DB connection retry with exponential backoff (3 attempts) | `src/database/db.ts` | 15 min | ✅ Completed |
| HIGH-3 | Fix `decryptCloudstickCredential` — never return ciphertext as plaintext on failure | `src/services/user_service.ts:153-168` | 5 min | ✅ Completed |

---

## Definition of Done

- [x] `git log --all --diff-filter=A -- .env .env.docker` returns nothing (or secrets rotated)
- [x] `pg-boss` removed from `node_modules` and `package.json`
- [x] `*.test.ts` not in `.gitignore`
- [x] Docker Compose postgres port bound to localhost
- [x] No hardcoded server IPs in `schema.sql`
- [x] SSH interval has `.unref()`
- [x] `getSession()` has `LIMIT 1`
- [x] `connectDB()` retries on failure
- [x] `decryptCloudstickCredential` returns `null` on failure, never ciphertext
