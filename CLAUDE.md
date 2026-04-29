# Cloud-Claw — Claude Code Project Context

## What This Is

Cloud-Claw is a TypeScript Node.js AIOps agent. Users describe server problems in plain English via Slack or Telegram; the agent SSHs into servers, diagnoses issues, and either fixes them autonomously or holds for human approval (HITL). It also integrates deeply with the Cloudstick hosting panel API.

## Key Commands

```bash
npm run dev           # hot-reload dev server (tsx watch)
npm run typecheck     # TypeScript type check
npm test              # Vitest test suite
npm run build         # compile to dist/
npm run db:init       # apply schema.sql to $DATABASE_URL
```

> **Important:** `tsc` is not in PATH. Always use `npx tsc --noEmit` for type checking.

## Testing

```bash
npm test                                          # all 148 tests
npx vitest run src/agents/tool_guard.test.ts      # single file
```

Tests live beside their module as `*.test.ts`. Run typecheck + tests before every commit.

## Worktrees

Active worktrees: `.worktrees/v2-migration` (branch `feature/v2-migration`) — merged to `main` on 2026-04-30.

## Cloudstick API v2 Migration Status

All work is in `src/api/cloudstick_client.ts`. Tracker: `docs/cloudstick/v2-migration-tracker.md`.

| Phase | Status |
|-------|--------|
| Phase 1 — Breaking fixes (auth, URLs) | ✅ Done |
| Phase 2 — High-value new endpoints | ✅ Done |
| Phase 3 — Security & infrastructure (3.4–3.10) | ✅ Done |
| Phase 3.1–3.3 — SSH vault/keys/config | ⬜ Deferred (user hold) |
| Phase 4 — Git integration | ✅ Done |
| Phase 5 — Backup extended | ✅ Done |
| Phase 6 — Server provisioning & datacenter | ⬜ Todo |
| Phase 7 — Support ticket system | ⬜ Todo |
| Phase 8 — WP templates & advanced app features | ✅ Done |
| Phase 9 — Business, billing & search | ⬜ Todo |

## Architecture Quick Reference

- **Agent loop:** `src/agents/loop.ts` — LLM ↔ Tool ↔ HITL cycle, 15-iteration cap
- **Tools:** `src/tools/` — all callable tools; register in `tool_registry.ts`
- **Cloudstick client:** `src/api/cloudstick_client.ts` — JWT auth via `CloudstickTokenManager`
- **HITL:** `src/hitl/` — Tier-3 write actions pause for `/approve`
- **Guards (4 layers):** intent classifier → pre-tool guard → post-tool sanitizer → hallucination guard
- **Gateway:** `src/interfaces/http_gateway.ts` — HMAC-signed server-to-server API for Cloudstick dashboard
- **Multi-tenant:** `AsyncLocalStorage` in `src/api/cloudstick_context.ts` scopes credentials per request

## Adding a Tool

1. Create `src/tools/my_tool.ts` implementing the `Tool` interface (`src/tools/types.ts`)
2. Register it in `src/tools/tool_registry.ts`
3. Write tools: add to `WRITE_TOOLS` Set in `loop.ts` + add approval metadata case

## Security Rules (Never Break These)

- Write operations **must** stay behind HITL approval
- SSH commands **must** pass `src/security/command_filter.ts`
- New write tools need `approvalTier`, `getRationale`, and `getApprovalRequest`
- Do not commit `.env`, private keys, or Cloudstick credentials
- Do not reintroduce raw bearer-key auth (gateway uses HMAC-SHA256 only)

## Cloudstick API Client Pattern

```typescript
// All methods follow this pattern — returns raw axios response data
return this.request({ method: 'GET', url: `/path/to/${userId}` });
return this.request({ method: 'POST', url: `/path/`, data });
return this.request({ method: 'PATCH', url: `/path/${id}/users/${userId}`, data });
```

JWT auth is automatic via `CloudstickTokenManager` — login, cache, and refresh are handled internally. Credentials come from `AsyncLocalStorage` context, falling back to `env` for single-tenant deployments.
