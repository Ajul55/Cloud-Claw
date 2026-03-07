---
name: cloudclaw-agent-loop
description: "Read this before modifying loop.ts, the SYSTEM_PROMPT, tool_choice logic, hallucination detection, or session handling. Covers the exact rules for how the agentic loop must behave, what bugs have already been fixed, and what patterns are forbidden."
---

# Cloud-Claw Agent Loop — Rules and Patterns

## File: src/agents/loop.ts

This is the most critical file in the project.
Every LLM call, tool execution, hallucination block, and HITL pause
flows through this file. Read the full rules before editing it.

---

## The Loop Flow

```
runAgentLoop(message, onReply, onApproval, indicator)
  │
  ├── Load session from PostgreSQL
  ├── Append user message
  ├── Check for pending approval fast-path (proceed/reject keywords)
  │
  └── while iteration < 10:
        │
        ├── Build tool_choice (required or auto)
        ├── Call LLM
        │
        ├── No tool calls?
        │     ├── Check for pseudo tool syntax → retry
        │     ├── Check hallucination patterns → retry
        │     ├── Check requiresTool && !hasExecutedTool → error
        │     └── Send reply to user → break
        │
        └── Tool calls?
              ├── Check getToolApprovalRequest() → HITL pause + return
              ├── Check command_filter → block or approve
              ├── Check requiresApproval() → HITL pause + return
              ├── Execute tool → set hasExecutedTool = true
              ├── Auto-chain (diagnose → fix) if applicable
              └── Continue loop
```

---

## The hasExecutedTool Flag

**This is the most important flag in the loop.**

```typescript
let hasExecutedTool = false;  // ← ALWAYS start false
```

**NEVER initialise it from session history:**
```typescript
// ❌ WRONG — this breaks hallucination detection for follow-up messages
let hasExecutedTool = messages.some((m) => m.role === 'tool');

// ✅ CORRECT — tracks tools executed in THIS turn only
let hasExecutedTool = false;
```

It controls two things:
1. `tool_choice: (requiresTool && !hasExecutedTool) ? 'required' : 'auto'`
2. `const isHallucination = !hasExecutedTool && hallucinationPatterns.some(...)`

---

## tool_choice Rules

```typescript
const requiresTool = /\b(nginx|mariadb|mysql|postgres|redis|php|apache|
  fix|diagnose|status|running|install|restart|ssh|server|error|failed|
  resolve|issue|proceed|yes|confirm|do\s+it|apply|check|db|database|
  memory|disk|cpu|down|up|broken|crash|500|502|503|504|
  start|stop|service|process|log|config)\b/i
  .test(fullContext);

tool_choice: (requiresTool && !hasExecutedTool) ? 'required' : 'auto'
```

- `'required'` on first iteration for any server-related message
- `'auto'` once a tool has run (LLM can decide to reply)
- `fullContext` includes last 6 messages — catches "yes" and "confirm" replies

---

## SYSTEM_PROMPT — 3 Mandatory Sections

Every SYSTEM_PROMPT must contain these three sections in order:

### Section 1: HONESTY RULES (at the very top, overrides everything)
```
HONESTY RULES — these override all other instructions:
- You CANNOT claim a tool ran unless you received an actual tool result
  in this conversation.
- You CANNOT say "Nginx is running" without tool evidence.
- If a user asks you to fix something: call the tool. Do not describe
  what the tool would do. Do not pretend it ran. Call it.
- NEVER invent command output. NEVER fabricate success messages.
```

### Section 2: Known Infrastructure
```
Known Infrastructure:
- Default Target Server IP: ${env.SSH_HOST}
- Default SSH User: ${env.SSH_USER}
- Stack: [stack details from STACK_PROFILE]
```

### Section 3: Tool Usage Rules
```
1. For ANY nginx issue: call diagnose_nginx FIRST. Then fix_nginx_config.
   Do NOT ask for confirmation between steps.
2. For ANY other service: call execute_ssh_command first.
3. For ANY status check: call execute_ssh_command first.
4. NEVER print function names or JSON in replies.
5. NEVER ask user for confirmation before tool calls.
6. NEVER hallucinate parameters.
7. After tools run, quote key lines from real output.
```

---

## Hallucination Patterns — Required List

These patterns must all be present. Extend but never remove:

```typescript
const hallucinationPatterns = [
  /(nginx|mariadb|mysql|apache|php|redis|postgres) is (now |currently )?(active|running|up|fixed|resolved)/i,
  /configuration (has been|was) (successfully |)repaired/i,
  /(service|nginx|mariadb|mysql) has been restarted/i,
  /fix (was|has been) applied/i,
  /issue (has been|is now|was) (resolved|fixed|solved)/i,
  /successfully (restarted|repaired|resolved|fixed|applied)/i,
  /steps taken:/i,
  /outcome:/i,
  /please (give me a moment|allow me a moment|wait while)/i,
  /i (have|'ve) (applied|fixed|repaired|restarted|resolved)/i,
  /i('ll| will) now (apply|run|execute|perform|initiate)/i,
];
```

When `isHallucination` is true:
1. Log to console with `[loop] HALLUCINATION DETECTED`
2. Push the hallucinated text to messages as assistant role
3. Push a hard correction as user role
4. `continue` — do NOT call `onReply()`

---

## Auto-Chain: diagnose → fix

After a `diagnose_nginx` tool result, extract the error file path
and inject a user message forcing the LLM to call `fix_nginx_config`:

```typescript
if (toolName === 'diagnose_nginx' && result.success) {
  const fileMatch = result.output.match(/in\s+(\/etc\/[^\s:]+)/i);
  const foundFilePath = fileMatch?.[1];
  if (foundFilePath) {
    messages.push({
      role: 'user',
      content:
        `diagnose_nginx found a config error in ${foundFilePath}. ` +
        `Call fix_nginx_config now with host="${String(toolArgs.host)}" ` +
        `and file_path="${foundFilePath}". Do not ask for confirmation.`,
    });
  }
}
```

---

## HITL Pause Pattern

When a tool needs approval, the loop MUST:
1. Call `createApproval()` to save to DB
2. Call `onApproval()` to render the Proceed/Reject card
3. Call `onReply()` with a text message explaining what needs approval
4. Call `upsertSession()` to save current state
5. `return` — do NOT continue the loop

```typescript
// ✅ CORRECT order
await onApproval({ approvalId, command, targetHost, rationale });
await onReply('🔐 Approval Required...');
await upsertSession(...);
return;
```

---

## Forbidden Patterns — Never Add These

### ❌ Fake tool call injection
Never inject a fake assistant message with tool_calls that the LLM
didn't actually produce. This corrupts OpenAI conversation history:

```typescript
// ❌ NEVER DO THIS
messages.push({
  role: 'assistant',
  tool_calls: [{ id: `auto-${Date.now()}`, ... }]  // fake
});
```

### ❌ Multiple boolean retry flags
Do not add flags like `forcedDiagnosticRetry`, `internalSyntaxRetryUsed`
for every edge case. Use the hallucination patterns + tool_choice instead.

### ❌ Hardcoded service names in loop.ts
Do not write `'nginx'`, `'mariadb'`, `'/etc/nginx/'` in loop.ts.
Import from `STACK_PROFILE` in `src/config/stack_profile.ts`.

### ❌ Initialising hasExecutedTool from session history
See hasExecutedTool section above.

---

## Approved Retry Patterns

Only two retry mechanisms are allowed:

1. **Pseudo syntax retry** — `containsInternalToolSyntax()` — max 1 retry
2. **Hallucination retry** — `isHallucination` — max 2 retries (add counter if needed)

Both push to messages and `continue`. Both guard with a used-flag or counter.

---

## Session Persistence

Sessions are saved at two points:
1. When loop pauses for HITL approval (`upsertSession` before `return`)
2. At the end of the loop regardless of outcome

Session ID format: `{userId}-{channel}` — one session per user per channel.
History is the full OpenAI messages array stored as JSONB in PostgreSQL.

---

## Console Logging Standards

Every meaningful action must log to console:

```typescript
console.log(`[loop] Iteration ${iteration}/${MAX_ITERATIONS} — session: ${message.sessionId}`);
console.log(`[loop] ⚡ EXECUTING TOOL: ${toolName} on host: ${String(toolArgs.host ?? 'N/A')}`);
console.log(`[loop] ✅ TOOL COMPLETE: ${toolName} — output length: ${result.output.length} chars`);
console.error('[loop] HALLUCINATION DETECTED — LLM claimed success without tool execution');
console.error('[loop] LLM avoided tool call despite tool_choice required');
console.warn('[loop] Tool call missing ID — skipping');
```

These logs are how you verify the system is working. If you don't see
`⚡ EXECUTING TOOL` in the terminal, the tool never ran.
