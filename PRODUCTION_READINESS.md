# Cloud-Claw Production Readiness Report

> **Last Audit:** 2026-04-26  
> **Status:** 🔴 NOT PRODUCTION-READY (4 Critical Blockers)

This document tracks the final push for production readiness. It consolidates findings from the latest structural and security audit.

---

## 📊 Implementation Tracker

| Category | Total | Completed | Pending | Progress |
|----------|-------|-----------|---------|----------|
| 🔴 CRITICAL | 4 | 3 | 1 | 75% |
| 🟠 HIGH | 13 | 8 | 5 | 61% |
| 🟡 MEDIUM | 16 | 4 | 12 | 25% |
| 🟢 LOW | 9 | 0 | 9 | 0% |
| **Total** | **42** | **15** | **27** | **36%** |

---

## 🔴 Critical Blockers (Must Fix Before Deploy)

These issues present immediate security or stability risks that could result in unauthorized system access or data corruption.

| ID | Issue | Risk | File |
|----|-------|------|------|
| **CRIT-1** | `loop.ts` God Function | 1700+ lines of monolithic logic. Extremely high regression risk and untestable. | `src/agents/loop.ts` |
| **CRIT-2** | Command Filter Bypass | Subshell substitution (`$(...)`, `` ` ``) and `/dev/tcp` bypass the regex filters. | `src/security/command_filter.ts` |
| **CRIT-3** | JWT Verification | Decodes Cloudstick JWT payloads without signature verification. | `src/utils/crypto.ts` |
| **CRIT-4** | Session Race Condition | Slack interface lacks a per-session mutex; concurrent messages corrupt history. | `src/interfaces/slack.ts` |

---

## 🛠️ Phase 1: Critical Fixes & Stability
*Target: Immediate remediation of blockers.*

- [x] **[CRIT-2] Patch Command Filter**  
  Add blocklist patterns for `$()`, backticks, `/dev/tcp`, and process substitution `<()`.
- [x] **[CRIT-4] Implement Slack Mutex**  
  Add a per-session lock in the Slack handler to prevent concurrent loop execution.
- [x] **[HIGH-10] Align Node.js Versions**  
  Update `ci.yml` and `Dockerfile` to use Node 22 (LTS) consistently.
- [x] **[HIGH-7] SSE Stream Guard**  
  Handle `req.on('close')` gracefully to prevent write-after-close errors.
- [x] **[MED-7] Fix SSH Eviction Key**  
  Update `evictConnection` to use `user@host:port` to stop connection leaks.

---

## 🛡️ Phase 2: Security & Hardening
*Target: Defense-in-depth and identity verification.*

- [x] **[CRIT-3] Verify JWT Signatures**  
  Implement HMAC or Public Key verification for incoming Cloudstick tokens.
- [x] **[HIGH-3] Async SSH CA Signing**  
  Replace `execSync` with `execFile` and move cert storage to a secure volume.
- [x] **[HIGH-4] Sanitize Server Labels**  
  Strict regex validation for `server_label` before using in logs or UI.
- [x] **[MED-3] Write Tool Validation**  
  Require Lane 3 approval even for "safe" write tool parameters.

---

## 📈 Phase 3: Operational Scale
*Target: Observability, performance, and CI/CD maturity.*

- [x] **[HIGH-8] Structured Logging Migration**  
  Replace all `console.log` with `logger.*` for proper log aggregation.
- [ ] **[HIGH-9] Enhance CI/CD Pipeline**  
  Add Docker Push and SSH Deploy stages to GitHub Actions. *(Deferred — pending VPC purchase)*
- [x] **[HIGH-2] Replace Redis KEYS**  
  Switch `getTotalActiveSessions` to use `SCAN` or a dedicated counter.
- [x] **[HIGH-5] Optimize Message Trimming**  
  Remove redundant `JSON.stringify` calls in the database trimming loop.
- [x] **[HIGH-6] Graceful SSH Shutdown**  
  Drain the connection pool on SIGTERM to prevent orphan SSH sessions.
- [x] **[MED-13] Site-to-Path Registry Enforcement**  
  Ensure `discovery_agent` tool provides definitive directory-to-domain mapping to prevent URL hallucinations.
- [x] **[MED-14] Command Whitelist Expansion**  
  Add `timeout` to `READ_SAFE_BINARIES` and improve tokenizer to prevent IP fragments (like `1.1.1.1` -> `1`) from being flagged as unknown binaries.

---

## 🏗️ Phase 4: Long-term Architecture
*Target: Maintainability and enterprise-grade testing.*

- [ ] **[CRIT-1] Refactor `loop.ts`**  
  Break the orchestrator into specialized modules (Dispatcher, ApprovalGate, etc.).
- [ ] **[HIGH-11] Agent Loop Integration Tests**  
  Create end-to-end tests for the tool execution and HITL resume flows.
- [ ] **[MED-1] Fix Schema Constraints**  
  Repair the broken foreign key reference to the `accounts` table.

---

## 🛠️ Phase 5: Audit Remediation
*Target: Resolve performance and minor security gaps identified in the 2026-04-27 audit.*

- [ ] **[HIGH-12] Fix `manageWebsiteSettings` HITL Metadata**  
  Add `getApprovalRequest` and `getRationale` to ensure write operations are gated.
- [ ] **[HIGH-13] Patch Command Injection in WP Tools**  
  Add strict input sanitization to all WordPress management parameters.
- [ ] **[MED-15] Optimize Vector Search**  
  Switch `pgvector` similarity search in `fix_memory.ts` to `ORDER BY ... LIMIT`.
- [ ] **[MED-16] Implement Pagination for Cron Jobs**  
  Add pagination to `list_server_cron_jobs` to prevent context exhaustion.
- [ ] **[LOW-7] Add Timeout to Connection Check**  
  Implement a 10s timeout for `check_cloudstick_connection` tool.
- [ ] **[LOW-8] WordPress N+1 Cleanup**  
  Refactor `getWordpressManagerSnapshot` to reduce redundant API calls.
- [ ] **[LOW-9] Password Validation**  
  Add length and complexity checks to `create_system_user` and `update_system_user`.

---

## 🔍 Verification Checklist

- [x] TypeScript Strict Mode: Clean
- [x] Unit Tests: 135/135 Passing
- [x] Security: `$(...)` and `/dev/tcp` blocked & VERIFIED (Live stress test passed)
- [x] Concurrency: Simultaneous Slack messages handled safely
- [ ] Health Check: `:9000/health` returns `{"status":"ok"}`
- [ ] Performance: No `execSync` during cert signing
