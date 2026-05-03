# Agent Tracing — Implementation Plan

## Context

Cloud-Claw's admin dashboard currently shows only aggregate metrics (token burn, LLM calls, tool counts). When the AI agent acts confidently but incorrectly — wrong tool, wrong args, wrong target — there is no way to drill into what happened. The guards (hallucination guard, loop guard, intent classifier) catch most bad runs but not all. The primary need is **post-incident debugging**: click a session, see the full step-by-step execution timeline, understand exactly where the agent's reasoning went wrong.

Approach chosen: new `agent_events` table (structured event log) — clean timeline queries, drillable, minimal DB overhead, reuses already-stored LLM messages for reasoning text.

---

## Critical Files to Modify

| File | Change |
|---|---|
| `src/database/schema.sql` | Add `agent_events` table + indexes |
| `src/database/db.ts` | Add `insertAgentEvent()` and `getSessionTrace()` query helpers |
| `src/telemetry/event_recorder.ts` | **NEW** — fire-and-forget event insert helper |
| `src/agents/loop.ts` | Instrument 8 event points (tool_start/complete/error + guard events) |
| `src/hitl/resume.ts` | Instrument `hitl_resolved` event on approval/rejection |
| `src/dashboard/server.ts` | Add `GET /api/sessions/:sessionId/trace` endpoint |
| `src/dashboard/queries.ts` | Add `getSessionTrace()` query |
| `dashboard/src/types.ts` | Add `AgentEvent`, `TraceResponse` types |
| `dashboard/src/hooks/useTrace.ts` | **NEW** — data fetching hook |
| `dashboard/src/pages/TracePage.tsx` | **NEW** — trace timeline UI |
| `dashboard/src/App.tsx` | Add `/trace/:sessionId` route + "Trace →" link in sessions table |

---

## Step 1 — Database Schema

Add to `src/database/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS agent_events (
  id                SERIAL PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  iteration         INTEGER NOT NULL DEFAULT 0,
  event_type        TEXT NOT NULL,
  tool_name         TEXT,
  args              JSONB,
  result_summary    TEXT,
  duration_ms       INTEGER,
  success           BOOLEAN,
  -- LLM call fields (populated only on llm_call_start / llm_call_complete)
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cache_read_tokens INTEGER,
  finish_reason     TEXT,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_events_session_id_idx ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS agent_events_timestamp_idx  ON agent_events(timestamp DESC);
```

**Event types:**
- `llm_call_start` — just before Anthropic SDK call; captures iteration, approx input token count, message count
- `llm_call_complete` — after Anthropic SDK returns; captures api_duration_ms, finish_reason, input/output/cache_read tokens
- `tool_start` — just before tool executes
- `tool_complete` — tool finished successfully
- `tool_error` — tool threw or returned error
- `hitl_requested` — Tier-3 action paused for approval
- `hitl_resolved` — approval approved or rejected
- `hallucination_detected` — hallucination guard fired
- `loop_guard_blocked` — repeated tool call blocked
- `max_iterations_reached` — hit 15-iteration cap

---

## Step 2 — DB Query Helpers (`src/database/db.ts`)

Add two functions:

```typescript
// Insert a single event row (used by event_recorder.ts)
export async function insertAgentEvent(event: Omit<AgentEvent, 'id'>): Promise<void>

// Fetch full trace for a session
export async function getSessionTrace(sessionId: string): Promise<{
  events: AgentEvent[];
  messages: unknown[];   // raw sessions.messages JSONB
}>
```

`insertAgentEvent` uses a single `INSERT INTO agent_events (...) VALUES (...)`.
`getSessionTrace` joins:
```sql
SELECT e.* FROM agent_events e WHERE e.session_id = $1 ORDER BY e.timestamp ASC;
-- plus SELECT messages FROM sessions WHERE id = $1
```

---

## Step 3 — Event Recorder (`src/telemetry/event_recorder.ts`)

New file. Single exported function:

```typescript
const SAMPLE_RATE = parseFloat(process.env.TRACE_SAMPLE_RATE ?? '1.0');

export function recordEvent(event: Omit<AgentEvent, 'id' | 'timestamp'>): void {
  if (Math.random() > SAMPLE_RATE) return;
  insertAgentEvent({ ...event, timestamp: new Date() })
    .catch(err => logger.error('[event_recorder] Failed to write event', err));
}
```

- **Void return** — fire-and-forget, never blocks the agent loop
- **Sampling** — `TRACE_SAMPLE_RATE` env var (0.0–1.0, default `1.0`); set to `0.1` in high-volume production to write 10% of events
- Redacts sensitive args before storing: reuses `isSensitiveApprovalArg()` from `src/hitl/tool_approval.ts`
- Truncates `result_summary` to 500 chars

---

## Step 4 — Instrument `src/agents/loop.ts`

Import `recordEvent` from `src/telemetry/event_recorder.ts`.

Add calls at these 10 points (approximate line references from current codebase):

| Point | Event | Key fields |
|---|---|---|
| Before Anthropic SDK call | `llm_call_start` | iteration, approx input token count (messages char count / 4), message_count |
| After Anthropic SDK returns | `llm_call_complete` | iteration, api_duration_ms, finish_reason (stop_reason), input_tokens, output_tokens, cache_read_tokens from response.usage |
| Before tool execute (~line 845) | `tool_start` | iteration, tool_name, args |
| After tool succeed (~line 1267) | `tool_complete` | tool_name, duration_ms, result_summary, success: true |
| After tool error (~line 1280) | `tool_error` | tool_name, duration_ms, error message, success: false |
| Hallucination detected (~line 777) | `hallucination_detected` | iteration, tool_name |
| Loop guard blocked (~line 1326) | `loop_guard_blocked` | iteration, tool_name, args |
| Max iterations (~line 1511) | `max_iterations_reached` | iteration |
| HITL pause (~lines 1058, 1129) | `hitl_requested` | tool_name, args (redacted), target_host |

Duration for LLM calls: `const t0 = Date.now()` before SDK call, `api_duration_ms: Date.now() - t0` in `llm_call_complete`.
Duration for tool calls: same pattern, stored in `duration_ms`.

`cache_read_tokens` maps to `response.usage.cache_read_input_tokens` from the Anthropic SDK response.

---

## Step 5 — Instrument `src/hitl/resume.ts`

After tool executes on approval/rejection (around line where `resolveApproval()` is called), add:

```typescript
recordEvent({
  session_id: sessionId,
  iteration: session.iteration,
  event_type: 'hitl_resolved',
  tool_name: toolName,
  args: redactedArgs,
  result_summary: decision === 'approve' ? 'Approved' : `Rejected: ${reason}`,
  success: decision === 'approve',
});
```

---

## Step 6 — Dashboard API Endpoint (`src/dashboard/server.ts`)

Add after existing routes:

```typescript
app.get('/api/sessions/:sessionId/trace', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const trace = await getSessionTrace(sessionId);
  res.json(trace);
});
```

---

## Step 7 — Frontend Types (`dashboard/src/types.ts`)

Add:

```typescript
export interface AgentEvent {
  id: number;
  session_id: string;
  iteration: number;
  event_type: 'llm_call_start' | 'llm_call_complete' |
              'tool_start' | 'tool_complete' | 'tool_error' | 'hitl_requested' |
              'hitl_resolved' | 'hallucination_detected' | 'loop_guard_blocked' |
              'max_iterations_reached';
  tool_name: string | null;
  args: Record<string, unknown> | null;
  result_summary: string | null;
  duration_ms: number | null;
  success: boolean | null;
  // LLM call fields — null on non-LLM events
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  finish_reason: string | null;
  timestamp: string;
}

export interface TraceResponse {
  events: AgentEvent[];
  messages: Array<{ role: string; content: unknown }>;
}
```

---

## Step 8 — Frontend Hook (`dashboard/src/hooks/useTrace.ts`)

New file following the exact pattern of existing hooks (e.g., `useStats.ts`):

```typescript
export function useTrace(sessionId: string | null) {
  const [data, setData] = useState<TraceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // fetch /api/sessions/${sessionId}/trace on sessionId change
}
```

---

## Step 9 — TracePage (`dashboard/src/pages/TracePage.tsx`)

New page. URL: `/trace/:sessionId`

Layout:
1. **Header bar** — session ID, channel badge, status badge, iteration count, created_at
2. **Timeline** — events grouped by iteration number
   - Each event row: `[timestamp]  [event_type badge]  [tool_name]  [duration_ms]  [✅/❌]`
   - Click to expand: shows full `args` JSON and `result_summary` text
   - LLM reasoning messages (from `sessions.messages`) interleaved by timestamp, collapsed by default
   - Guard events (`hallucination_detected`, `loop_guard_blocked`) shown with amber/orange left border callout
   - Error events (`tool_error`) shown with red left border
   - `hitl_requested` shown with yellow pause icon, `hitl_resolved` shows decision (approved/rejected)
3. **Back button** → returns to Sessions page

> **Known limitation:** The trace view is poll-on-demand only (manual refresh or `useEffect` re-fetch). Real-time updates (watching a live session) would require a `GET /api/sessions/:sessionId/trace/stream` SSE endpoint — natural next step if live monitoring becomes a requirement.

Event type badge colors (reuse existing theme variables):
- `tool_complete` → green
- `tool_error` → red
- `hitl_requested` → yellow
- `hitl_resolved` → green or red based on decision
- `hallucination_detected` → orange
- `loop_guard_blocked` → orange
- `max_iterations_reached` → red

---

## Step 10 — Wire Up Routes (`dashboard/src/App.tsx`)

1. Add import for `TracePage`
2. Add route: `{ path: '/trace/:sessionId', component: TracePage }`
3. In `SessionsTable` or `SessionsPage`, add a "Trace →" link/button on each session row

---

## Verification

```bash
# 1. Apply schema
npm run db:init

# 2. Type check — must pass clean
npx tsc --noEmit

# 3. Run test suite
npm test

# 4. Start dev server
npm run dev

# 5. Send a test message via Telegram/Slack/gateway that triggers at least one tool call

# 6. Open dashboard → Sessions page
#    Confirm "Trace →" link appears on session rows

# 7. Click "Trace →" on the session with the test run
#    Confirm: events appear grouped by iteration, timestamps shown, expandable args work

# 8. Test an error case: trigger a tool failure or a hallucination
#    Confirm guard events appear with amber callout in the trace view

# 9. Check DB directly:
#    SELECT * FROM agent_events ORDER BY timestamp DESC LIMIT 20;
```

---

## Reusable Patterns / Utilities

- `isSensitiveApprovalArg()` — `src/hitl/tool_approval.ts` — reuse for arg redaction in event_recorder
- Existing hook pattern — `dashboard/src/hooks/useStats.ts` — copy structure for `useTrace.ts`
- Existing page pattern — `dashboard/src/pages/SessionsPage.tsx` — follow same layout conventions
- `logger` — `src/telemetry/logger.ts` — use for `.catch()` error logging in event_recorder
