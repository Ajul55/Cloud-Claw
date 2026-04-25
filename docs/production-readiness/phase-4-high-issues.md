# Phase 4 — High Issues

**Timeline:** Next 2 sprints  
**Status:** ✅ Complete  
**Prerequisite:** Phases 0 + 1 complete

---

## Tasks

| ID | Issue | File(s) | Effort | Status |
|----|-------|---------|--------|--------|
| HIGH-2 | In-process sliding window rate limiter per `accountId` — 10/30/60 req/min by plan | `src/interfaces/http_gateway.ts` | 2h | ✅ Completed |
| HIGH-5 | Remove hardcoded server IPs from `schema.sql` INSERT seed data | `src/database/schema.sql:83-86` | *(done in Phase 0 — QW-4)* | ✅ Done in Phase 0 |
| HIGH-7 | Zod schemas for POST `/api/chat` and POST `/api/chat/:id/approve` bodies | `src/interfaces/http_gateway.ts` | 3h | ✅ Completed |
| HIGH-8 | Store Slack channel + ts on approval; expiry job calls `chat.update` to replace buttons with "⏰ Expired" | `src/jobs/expire_approvals.ts`, `src/interfaces/slack.ts`, `src/database/db.ts` | 3h | ✅ Completed |
| HIGH-9 | Circuit breaker in `provider.ts` — 3 failures trips fallback for 5 min; `LLM_FALLBACK_PROVIDER` env var | `src/llm/provider.ts`, `src/agents/loop.ts` | 4h | ✅ Completed |
| HIGH-13 | Remove `pg-boss` from dependencies | `package.json` | *(done in Phase 0 — QW-1)* | ✅ Done in Phase 0 |
| MED-11 | Restart alert dedup — 10-min cooldown prevents flood during PM2 crash loops | `src/telemetry/ops_alerts.ts` | 1h | ✅ Completed |
| MED-12 | Intent-based tool filtering — `getLLMToolDefinitions(intentHint)` reduces token waste | `src/tools/tool_registry.ts`, `src/agents/loop.ts` | 4h | ✅ Completed |
| MED-6 | Telegram documented as single-tenant by design — upgrade path noted in code comment | `src/interfaces/telegram.ts` | — | ✅ Completed |

---

## Implementation Notes

### HIGH-2: Rate Limiting
```typescript
import rateLimit from 'express-rate-limit'

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,              // 10 req/min for starter
  keyGenerator: (req) => req.body?.accountId ?? req.ip,
  message: { error: 'Too many requests' }
})

app.post('/api/chat', chatLimiter, handlePostChat)
```

### HIGH-8: Expired Approval Card Update
When `expire_approvals.ts` marks an approval as expired, call Slack `chat.update` to replace the action block:
```
[✅ Proceed] [❌ Cancel]
```
→
```
⏰ This approval expired at 14:32
```

### HIGH-9: LLM Circuit Breaker
```typescript
let consecutiveFailures = 0
let fallbackUntil: number | null = null

async function callLLM(messages, tools) {
  const useFallback = fallbackUntil && Date.now() < fallbackUntil
  try {
    const result = await (useFallback ? fallbackClient : primaryClient).call(messages, tools)
    consecutiveFailures = 0
    return result
  } catch (err) {
    consecutiveFailures++
    if (consecutiveFailures >= 3) {
      fallbackUntil = Date.now() + 5 * 60 * 1000
    }
    throw err
  }
}
```

### MED-12: Intent-Based Tool Filtering
```typescript
function getToolsForIntent(intent: string): ToolDefinition[] {
  const toolGroups = {
    'web': ['manage_nginx', 'manage_ssl', 'create_wordpress'],
    'database': ['manage_databases', 'manage_database_users'],
    'system': ['run_command', 'get_server_stats', 'manage_services'],
    // ...
  }
  return toolGroups[intent] ?? getAllTools() // fallback to all
}
```

---

## Definition of Done

- [ ] `/api/chat` returns 429 when rate limit exceeded
- [ ] Expired Slack approval cards show "⏰ Expired" instead of dead buttons
- [ ] LLM automatically switches to fallback after 3 failures
- [ ] LLM calls include only relevant tools for the detected intent
- [ ] All gateway request bodies validated with Zod — invalid payloads return 400
