# Cloud-Claw Production Readiness Audit

**Date:** 2026-04-25  
**Scope:** Full codebase — `src/`, Docker, CI/CD, security, performance  
**Verdict:** **NOT PRODUCTION-READY** — 8 critical issues must be resolved first

---

## 🔴 CRITICAL Issues

### CRIT-1: In-Memory SSE Bus — Total Data Loss on Restart
- **What:** `sessionBus`, `replayBuffer`, `sessionSeq` in [http_gateway.ts](file:///home/ajul/Desktop/Cloud-Claw/src/interfaces/http_gateway.ts#L18-L32) are `Map` objects in process memory.
- **Why:** PM2 restart, OOM kill, or deployment = all active SSE streams drop silently. Connected Cloudstick web clients lose their session mid-response with no recovery. Already documented as blocking cluster mode.
- **Fix:** Replace with Redis pub/sub. Use `ioredis` subscriber per SSE connection. This is the #1 blocker for horizontal scaling.

### CRIT-2: In-Memory Session Limiter — Resets on Every Restart
- **What:** `activeSessions` Map in [session_limiter.ts](file:///home/ajul/Desktop/Cloud-Claw/src/services/session_limiter.ts#L32) resets to empty on process restart.
- **Why:** After PM2 restart, all concurrency limits are lost. A user hitting the limit pre-restart gets unlimited sessions post-restart. A user mid-session pre-restart never gets `releaseSession()` called — phantom slot leak until restart.
- **Fix:** Store active session counts in Redis with TTL (e.g. 10 min auto-expire). Or use a PostgreSQL advisory lock pattern.

### CRIT-3: No CI/CD Pipeline
- **What:** No `.github/workflows/`, no `Jenkinsfile`, no GitLab CI config, no deployment automation.
- **Why:** Every deployment is manual SSH + `git pull` + `pm2 restart`. No automated typecheck, no test gate, no image push. Human error on every release. One bad commit goes live immediately.
- **Fix:** Add GitHub Actions: `typecheck → test → docker build → push → deploy`. Gate merges on green CI.

### CRIT-4: `.env` File Present in Working Directory
- **What:** [`.env`](file:///home/ajul/Desktop/Cloud-Claw/.env) (2317 bytes) exists in the repo root. `.gitignore` has `.env` listed but the file is already on disk and was likely committed at some point.
- **Why:** Contains `LLM_API_KEY`, `CLOUDSTICK_API_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, SSH paths. If this was ever committed, all secrets are in git history forever.
- **Fix:** `git log --all --diff-filter=A -- .env` to check if committed. If yes: rotate ALL secrets immediately. Use `git filter-repo` to scrub history. Switch to Docker secrets or Vault.

### CRIT-5: No Request-Level Timeout on Agent Loop
- **What:** `runAgentLoop()` can run up to 15 iterations × 60s LLM timeout = **15 minutes** per request with no global timeout. The gateway has a 5-min timeout ([http_gateway.ts:212](file:///home/ajul/Desktop/Cloud-Claw/src/interfaces/http_gateway.ts#L212)) but the **Slack/Telegram interfaces have no timeout at all**.
- **Why:** A single runaway session blocks the Node.js event loop for minutes. Multiply by concurrent users = total system hang.
- **Fix:** Wrap all `runAgentLoop()` calls in a global `AbortController` with a 3-minute hard timeout. Propagate cancellation to SSH and LLM calls.

### CRIT-6: Concurrent Session Race on `upsertSession`
- **What:** OCC is implemented with `version` column, but the gateway fires `runAgentLoop()` as a background promise ([http_gateway.ts:218](file:///home/ajul/Desktop/Cloud-Claw/src/interfaces/http_gateway.ts#L218)) then immediately returns 202. If the user sends a second message before the first completes, both run concurrently on the same sessionId.
- **Why:** Two concurrent loops both read `version=5`, both try to write `WHERE version=5` — one silently drops its session update. The user sees stale or lost conversation state.
- **Fix:** Add a per-session mutex (in-memory `Map<string, Promise>` or Redis lock). Queue incoming messages for sessions with an active loop.

### CRIT-7: SSH Connection Pool Never Evicts Dead Connections
- **What:** [ssh.ts](file:///home/ajul/Desktop/Cloud-Claw/src/utils/ssh.ts#L88-L96) reuses pooled connections by checking `inUse` flag but never validates the connection is actually alive before returning it.
- **Why:** If a pooled connection is silently broken (TCP reset, server firewall change, keepalive timeout), the next `conn.exec()` will fail. The retry logic in `sshExec()` will retry but keeps pulling from the same dead pool.
- **Fix:** Add an `isAlive` ping (e.g. `conn.exec('echo ok', ...)` with 2s timeout) before reuse. Or set `keepaliveInterval: 10000` on the ssh2 connection and listen for `end`/`error` to remove from pool.

### CRIT-8: JSONB Session Messages Grow Without Bound
- **What:** Session `messages` column stores full conversation history as JSONB. The trim logic in [loop.ts:502-510](file:///home/ajul/Desktop/Cloud-Claw/src/agents/loop.ts#L502-L510) only runs on new user intents with >3 user turns, and only trims to the last 6 messages. But between trims, 15 iterations of tool calls can push 30+ messages per turn.
- **Why:** For long-running diagnostic sessions with multiple approve/resume cycles, the JSONB blob can reach megabytes. PostgreSQL JSONB queries degrade badly at large sizes. The `SELECT * FROM sessions WHERE id = $1` loads the entire blob into Node.js memory every iteration.
- **Fix:** (a) Cap `messages` JSONB at 50KB with explicit enforcement. (b) Archive old messages to a separate `session_messages` table. (c) Load only the last N messages, not `SELECT *`.

---

## 🟠 HIGH Issues

### HIGH-1: No Database Migrations Framework
- **What:** Schema changes are applied via inline `ALTER TABLE IF EXISTS ... ADD COLUMN IF NOT EXISTS` in [db.ts:54-69](file:///home/ajul/Desktop/Cloud-Claw/src/database/db.ts#L54-L69) at every boot.
- **Why:** No rollback capability. No migration history. No way to know what schema version a database is at. Two developers making schema changes will conflict silently.
- **Fix:** Adopt `node-pg-migrate` or `knex` migrations. Track migration state in a `migrations` table.

### HIGH-2: No Rate Limiting on HTTP Gateway
- **What:** No rate limiting on `/api/chat`, `/api/chat/:id/stream`, `/api/chat/:id/approve`. Only the session limiter and monthly cap provide indirect throttling.
- **Why:** A malicious or buggy Cloudstick frontend can fire thousands of requests per second. Each spawns a full LLM call ($$$). No IP-level or account-level request throttle.
- **Fix:** Add `express-rate-limit` or a simple token bucket per `accountId`. E.g., 10 req/min for starter, 30 for pro.

### HIGH-3: `decryptCloudstickCredential` Falls Back to Plaintext
- **What:** [user_service.ts:153-168](file:///home/ajul/Desktop/Cloud-Claw/src/services/user_service.ts#L153-L168) — if decryption fails, returns the raw ciphertext as if it were the credential.
- **Why:** This silently passes garbage to the Cloudstick API. Or worse — if the ENCRYPTION_KEY is rotated, old encrypted values are returned as-is and may succeed by accident if they happen to be valid API keys.
- **Fix:** On decryption failure, log a clear error and return `null`. Never silently treat ciphertext as a valid credential.

### HIGH-4: No Structured Logging Across the System
- **What:** The `logger` object in [logger.ts](file:///home/ajul/Desktop/Cloud-Claw/src/telemetry/logger.ts) exists but is only used in `http_gateway.ts` and `ops_alerts.ts`. The other 95% of the codebase uses raw `console.log`/`console.error` with inconsistent formats.
- **Why:** Impossible to filter, aggregate, or alert on log patterns. No correlation IDs. No log levels in production. `grep` is the only search tool.
- **Fix:** Replace all `console.log/warn/error` with the structured logger. Add `requestId` and `sessionId` context to all log lines. Use `pino` or `winston` for proper log levels and JSON output.

### HIGH-5: `schema.sql` Contains Hardcoded Server IPs
- **What:** [schema.sql:83-86](file:///home/ajul/Desktop/Cloud-Claw/src/database/schema.sql#L83-L86) — `INSERT INTO servers` with hardcoded IPs `139.84.130.63` and `65.20.83.180`.
- **Why:** Every fresh Docker `docker compose up` inserts these specific servers. New deployments start with someone else's infrastructure baked in.
- **Fix:** Remove seed data from schema. Use a separate `seed.sql` or environment-based init script.

### HIGH-6: Docker Compose Exposes PostgreSQL Port
- **What:** [docker-compose.yml:26](file:///home/ajul/Desktop/Cloud-Claw/docker-compose.yml#L26) — `ports: "5433:5432"` exposes the DB to the host network.
- **Why:** If the host has a public IP, PostgreSQL is reachable from the internet. Combined with a weak `POSTGRES_PASSWORD`, this is a direct database takeover vector.
- **Fix:** Remove the `ports` mapping. The `cloudclaw-net` bridge network already allows container-to-container access. If external DB access is needed, use `127.0.0.1:5433:5432`.

### HIGH-7: No Request Body Validation Beyond JSON Parse
- **What:** Gateway handlers parse JSON but don't validate field types beyond basic checks (e.g., `handlePostChat` only checks `parsed.message?.trim()`). No schema validation.
- **Why:** Unexpected field types, injection payloads, or oversized fields pass through to the agent loop unchecked.
- **Fix:** Add Zod schemas for all gateway request bodies (similar to how `env.ts` validates env vars).

### HIGH-8: Approval Cards Have No Expiry UI Feedback
- **What:** Approvals expire after 10 minutes ([expire_approvals.ts](file:///home/ajul/Desktop/Cloud-Claw/src/jobs/expire_approvals.ts)), but Slack/Telegram cards remain interactive. A user clicking "Proceed" on an expired card gets `⚠️ This approval expired` — confusing.
- **Why:** Zombie interactive cards in Slack. Users don't know why their approval failed.
- **Fix:** When expiring approvals, update the Slack message to replace buttons with "⏰ Expired" context block.

### HIGH-9: LLM Provider Has No Fallback/Circuit Breaker
- **What:** [provider.ts](file:///home/ajul/Desktop/Cloud-Claw/src/llm/provider.ts) creates a single client for the configured provider. If the primary LLM (e.g., Claude) goes down, all requests fail.
- **Why:** LLM API outages are common. The system prompt says "Claude Sonnet (primary), MiniMax M2.5 (fallback)" but there's no automatic failover logic — only `setGlobalLLMOverride()` which requires manual intervention.
- **Fix:** Implement automatic fallback: try primary → on 3 consecutive failures, switch to fallback for 5 minutes → retry primary.

### HIGH-10: `unhandledRejection` Handler Swallows Errors
- **What:** [index.ts:30-33](file:///home/ajul/Desktop/Cloud-Claw/src/index.ts#L30-L33) — logs the rejection but continues. No alerting, no tracking.
- **Why:** Swallowed rejections cause silent data corruption. A DB write that fails silently means lost session state. The PM2 max_memory_restart is the only safety net.
- **Fix:** At minimum, increment a counter and alert via ops_alerts when it exceeds a threshold. Consider exiting on repeated unhandled rejections.

### HIGH-11: `.env.docker` Committed to Repo
- **What:** `.env.docker` (3671 bytes) exists in the working directory. `.gitignore` lists it, but if committed previously, secrets are exposed.
- **Why:** Same risk as CRIT-4. Contains Docker-specific credentials.
- **Fix:** Verify git history. Rotate secrets if committed.

### HIGH-12: No Database Connection Retry
- **What:** [db.ts:40-104](file:///home/ajul/Desktop/Cloud-Claw/src/database/db.ts#L40-L104) — `connectDB()` tries once. If PostgreSQL isn't ready (despite `depends_on: service_healthy`), the app falls back to in-memory mode permanently.
- **Why:** Race condition on cold start. Docker healthcheck passes → cloudclaw starts → PostgreSQL is still running post-init SQL → connection fails → app runs without persistence for its entire lifetime with no recovery.
- **Fix:** Add retry loop with exponential backoff (3 attempts, 2/4/8 second delays).

### HIGH-13: `pg-boss` Dependency Installed But Unused
- **What:** `pg-boss` is in [package.json](file:///home/ajul/Desktop/Cloud-Claw/package.json#L24) dependencies but never imported anywhere in `src/`.
- **Why:** Dead weight. Adds to container image size and attack surface. May conflict with the PostgreSQL pool.
- **Fix:** Remove from dependencies. If it was intended for the approval worker queue, either use it or remove it.

### HIGH-14: Test Files Excluded from Git
- **What:** [.gitignore:16](file:///home/ajul/Desktop/Cloud-Claw/.gitignore#L16) contains `*.test.ts` — all 18 test files are excluded from version control.
- **Why:** Tests exist locally but won't be in CI, won't be in Docker builds, won't be available to other developers. This defeats the purpose of having tests.
- **Fix:** Remove `*.test.ts` from `.gitignore`. Commit all test files. Only exclude from production Docker builds via `.dockerignore`.

---

## 🟡 MEDIUM Issues

### MED-1: SSH Connection Pool Uses Busy-Wait Polling
- **What:** [ssh.ts:100-122](file:///home/ajul/Desktop/Cloud-Claw/src/utils/ssh.ts#L100-L122) — `while (pool.length >= MAX_CONNECTIONS_PER_HOST)` polls every 100ms for 30 seconds.
- **Why:** CPU-wasteful. Under load with 500+ servers, many coroutines polling simultaneously.
- **Fix:** Use a semaphore/queue pattern (e.g., `p-limit` or a custom `Promise`-based queue).

### MED-2: Session Trimming Is Fragile
- **What:** [loop.ts:502-510](file:///home/ajul/Desktop/Cloud-Claw/src/agents/loop.ts#L502-L510) trims to last 6 messages by walking backwards to find a user message boundary. The `MAX_HISTORY = 20` trim at L755-758 keeps the first message + last 19, then re-filters orphans.
- **Why:** Two separate trim passes with different strategies. The first message retained at L757 may be stale context from hours ago. Trimming can split tool_call/tool pairs, requiring the orphan filter.
- **Fix:** Unify trimming into a single pass. Use a sliding window that preserves complete tool_call/tool pairs.

### MED-3: `getAllServers()` Called on Every Loop Iteration with Server Ambiguity
- **What:** [loop.ts:527](file:///home/ajul/Desktop/Cloud-Claw/src/agents/loop.ts#L527) and [loop.ts:1026](file:///home/ajul/Desktop/Cloud-Claw/src/agents/loop.ts#L1026) hit the database for the server list on every ambiguous request.
- **Why:** N+1 queries. For a busy system with 50 concurrent sessions, that's 50+ identical `SELECT * FROM servers` per loop cycle.
- **Fix:** Cache server list with a 60-second TTL.

### MED-4: ivfflat Index on Empty Table Will Be Broken
- **What:** [schema.sql:117-119](file:///home/ajul/Desktop/Cloud-Claw/src/database/schema.sql#L117-L119) creates an ivfflat index with `lists = 100` on `fix_memory`.
- **Why:** ivfflat requires the table to have data before the index is useful. With `lists = 100` and <100 rows, all queries return empty results. pgvector docs recommend `lists = rows / 1000` minimum.
- **Fix:** Use HNSW index instead (doesn't require pre-populated data), or defer ivfflat creation until the table has sufficient rows.

### MED-5: Hardcoded Pricing Table
- **What:** [usage_tracker.ts:14-30](file:///home/ajul/Desktop/Cloud-Claw/src/telemetry/usage_tracker.ts#L14-L30) — model pricing is hardcoded and incomplete. Missing many models (GPT-4-turbo, Claude 3.5 Haiku, etc.).
- **Why:** Cost tracking reports $0 for unlisted models, silently producing incorrect billing data.
- **Fix:** Move pricing to a config file or database table. Log a warning when an unknown model is encountered.

### MED-6: Telegram Has No User Whitelist Enforcement for Multi-Tenant
- **What:** Slack has multi-tenant user resolution via `getUserBySlackUserId()`. Telegram only checks `TELEGRAM_USER_ID` (single-user whitelist). No multi-tenant path for Telegram.
- **Why:** The system architecture says it supports multi-tenant via both interfaces, but Telegram is locked to a single user.
- **Fix:** Implement `getUserByTelegramId()` for multi-tenant Telegram support, or document Telegram as single-tenant only.

### MED-7: Docker Build Has No `.dockerignore` for Sensitive Files
- **What:** `.dockerignore` exists (527 bytes) but was not inspected. If `.env`, `.env.docker`, or `keys/` are not excluded, they end up in the Docker image layers.
- **Why:** Docker images pushed to a registry would contain secrets.
- **Fix:** Verify `.dockerignore` excludes `.env*`, `keys/`, `.git/`, `node_modules/`, `*.test.ts`.

### MED-8: No Health Check Readiness Probe
- **What:** [health.ts](file:///home/ajul/Desktop/Cloud-Claw/src/health.ts) has `/health` (liveness) but no `/ready` endpoint.
- **Why:** The health check reports "ok" as soon as the HTTP server starts, but the DB migration, Slack connection, and Telegram bot may still be initializing. Kubernetes or Docker would route traffic before the app is truly ready.
- **Fix:** Add `/ready` that checks DB connectivity + Slack/Telegram connection status.

### MED-9: `resolveApproval` / `updateApprovalStatus` Not Transactional with Session Update
- **What:** In [resume.ts](file:///home/ajul/Desktop/Cloud-Claw/src/hitl/resume.ts), the approval status update and session upsert are separate queries, not wrapped in a transaction.
- **Why:** If the process crashes between `updateApprovalStatus(approved)` and `upsertSession()`, the approval is marked as resolved but the session still has the placeholder message. Next resume attempt says "already processed."
- **Fix:** Wrap the approval status update + session upsert in a PostgreSQL transaction.

### MED-10: `setInterval` for SSH Pool Cleanup Prevents Graceful Shutdown
- **What:** [ssh.ts:175-179](file:///home/ajul/Desktop/Cloud-Claw/src/utils/ssh.ts#L175-L179) — `setInterval` without `unref()`.
- **Why:** Keeps the Node.js event loop alive even after SIGTERM/SIGINT handler runs. `process.exit(0)` in the shutdown handler bypasses this, but it's still unclean.
- **Fix:** Store the interval handle and clear it in the shutdown handler. Or call `.unref()` on the interval.

### MED-11: Ops Alerts Fire on Every 5-min Check After Restart
- **What:** [ops_alerts.ts:101-109](file:///home/ajul/Desktop/Cloud-Claw/src/telemetry/ops_alerts.ts#L101-L109) — uptime < 300s triggers a "Cloud-Claw Restarted" alert. But the alert scheduler itself runs every 5 minutes, so it fires once per restart.
- **Why:** If PM2 enters a restart loop (crash → restart → crash), this fires an alert every restart (potentially every 10 seconds), flooding the ops channel.
- **Fix:** Add deduplication: skip if the last "restart" alert was sent < 10 minutes ago.

### MED-12: Tool Registry Sends ALL 100+ Tool Definitions to Every LLM Call
- **What:** `getLLMToolDefinitions()` returns all 100+ tools on every call. This bloats the system prompt to thousands of tokens.
- **Why:** Token waste ($$$). Context window pollution. The LLM has to parse 100+ function definitions even for simple "what time is it?" queries.
- **Fix:** Filter tools based on intent classification. E.g., if `intent.toolHint === 'get_current_time'`, only send 5-10 relevant tools.

---

## 🟢 LOW Issues

### LOW-1: `splitMessage` in Slack Splits Mid-Markdown
- **What:** [slack.ts:459-466](file:///home/ajul/Desktop/Cloud-Claw/src/interfaces/slack.ts#L459-L466) — splits at fixed 3000-char boundaries, ignoring code blocks, bullet lists, or markdown structure.
- **Why:** Replies with code blocks get broken across messages, rendering poorly.
- **Fix:** Split on paragraph boundaries or newlines near the limit.

### LOW-2: `ecosystem.config.cjs` Has `max_memory_restart: 1024M` but No Alert Before Restart
- **What:** PM2 silently restarts at 1GB RSS. The ops_alerts check at 800MB may not fire before PM2 kills the process.
- **Why:** Memory restart looks like a crash with no diagnostic info.
- **Fix:** Lower the ops_alerts threshold to 700MB, or use PM2's `--merge-logs` to capture pre-restart state.

### LOW-3: `decodeCloudstickJwtUserId` Doesn't Verify JWT Signature
- **What:** [crypto.ts:42-60](file:///home/ajul/Desktop/Cloud-Claw/src/utils/crypto.ts#L42-L60) — explicitly states "We decode without verifying the signature."
- **Why:** If an attacker can control the JWT payload, they can impersonate any user_id. The comment says "the API server handles that" but this trusts the input.
- **Fix:** Acceptable if the JWT is only received from trusted sources (user input at setup time). Document this trust boundary explicitly.

### LOW-4: `_dbReady` Flag Is Not Thread-Safe
- **What:** [db.ts:8](file:///home/ajul/Desktop/Cloud-Claw/src/database/db.ts#L8) — `let _dbReady = false` is a module-level boolean.
- **Why:** In Node.js single-threaded model this is fine. But with Worker Threads (future scaling), this becomes a data race.
- **Fix:** Acceptable for now. Document as single-process assumption.

### LOW-5: `MAX_OUTPUT_BYTES = 50_000` in SSH — No Per-Command Limit
- **What:** [ssh.ts:192](file:///home/ajul/Desktop/Cloud-Claw/src/utils/ssh.ts#L192) truncates after 50KB, but a command like `cat /var/log/syslog` streams unbounded data until that limit.
- **Why:** Memory pressure during the stream before truncation. 50KB × 100 concurrent SSH commands = 5MB, acceptable.
- **Fix:** Add stream backpressure: pause the stream once `output.length` exceeds the limit.

### LOW-6: Missing `LIMIT` on `getSession()` Query
- **What:** `SELECT * FROM sessions WHERE id = $1` — no `LIMIT 1`. Primary key guarantees single row but explicit limit is defensive.
- **Why:** Negligible performance impact.
- **Fix:** Add `LIMIT 1` for clarity.

---

## 🏗️ Architecture Improvements

### ARCH-1: Replace In-Memory SSE Bus with Redis Pub/Sub
- **Impact:** Enables horizontal scaling, PM2 cluster mode, zero-downtime deploys.
- **Effort:** Medium (2-3 days).
- **Pattern:** `PUBLISH cloudclaw:session:{id} {event}` → each SSE connection subscribes to its session channel.

### ARCH-2: Add a Job Queue for Long-Running Operations
- **Impact:** Decouple the HTTP request lifecycle from the agent loop. The `pg-boss` dependency is already installed but unused.
- **Effort:** Medium (2-3 days).
- **Pattern:** POST /api/chat enqueues a job → worker processes it → results published via Redis pub/sub to SSE.

### ARCH-3: Separate Dashboard API into Its Own Service
- **Impact:** The health server, dashboard API, gateway API, and agent runtime all share a single HTTP server and Node.js process. A dashboard query that takes too long blocks agent responses.
- **Effort:** High (1 week).
- **Pattern:** Extract dashboard routes to a separate process/container with its own DB pool.

### ARCH-4: Implement Connection-Level Backpressure
- **Impact:** Currently, if the LLM or SSH is slow, incoming Slack/Telegram messages queue in-process without limit. There's `acquireSession()` but no incoming message queue depth limit.
- **Effort:** Low (1 day).
- **Pattern:** Add a bounded queue per session. Reject with "busy" if queue is full.

### ARCH-5: Externalize Tool Definitions
- **Impact:** 100+ tools are all imported at module load time in [tool_registry.ts](file:///home/ajul/Desktop/Cloud-Claw/src/tools/tool_registry.ts). Adding a tool requires code changes + restart.
- **Effort:** Medium-High (1 week).
- **Pattern:** Move tool definitions to a database or config files. Load dynamically. Supports per-tenant tool filtering.

---

## ⚡ Quick Wins

| # | What | Fix | Effort |
|---|------|-----|--------|
| QW-1 | Remove `pg-boss` from `package.json` | `npm uninstall pg-boss` | 1 min |
| QW-2 | Remove `*.test.ts` from `.gitignore` | Delete line 16 from `.gitignore`, `git add src/**/*.test.ts` | 5 min |
| QW-3 | Bind Postgres port to localhost only | Change `"5433:5432"` → `"127.0.0.1:5433:5432"` in `docker-compose.yml` | 1 min |
| QW-4 | Remove hardcoded server seeds from `schema.sql` | Delete lines 83-86 in `schema.sql`, create separate `seed.sql` | 5 min |
| QW-5 | Add `unref()` to SSH pool cleanup interval | Add `.unref()` to the `setInterval` call at `ssh.ts:175` | 1 min |
| QW-6 | Add `LIMIT 1` to `getSession()` query | Append `LIMIT 1` to query at `db.ts:212` | 1 min |
| QW-7 | Add DB connection retry with backoff | Wrap `connectDB()` in a 3-attempt retry loop | 15 min |
| QW-8 | Verify `.env` never committed to git | Run `git log --all --diff-filter=A -- .env .env.docker` | 2 min |

---

## Summary Matrix

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Architecture | 3 | 1 | 3 | 1 |
| Reliability | 2 | 3 | 2 | 0 |
| DevOps/Infra | 1 | 4 | 2 | 1 |
| Security | 1 | 3 | 1 | 1 |
| Performance | 1 | 0 | 3 | 2 |
| Code Quality | 0 | 3 | 1 | 1 |
| **Total** | **8** | **14** | **12** | **6** |

---

> **Recommended Priority Order:**
> 1. Quick Wins (QW-1 through QW-8) — same day
> 2. CRIT-4 (secrets audit) — immediate
> 3. CRIT-3 (CI/CD) — this week
> 4. CRIT-5, CRIT-6, CRIT-7 (reliability) — this week
> 5. CRIT-1, CRIT-2 (Redis migration) — next sprint
> 6. HIGH issues — next 2 sprints
> 7. CRIT-8 (session unbounded growth) — next sprint
