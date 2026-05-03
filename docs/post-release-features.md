# Post-Release Features — Backlog

Features identified from reference repo comparison. Not planned for current release. Revisit after initial release ships.

---

## Feature 1 — Subagent Delegation with Parallel Execution

### What it is

The main agent spawns child agents for parallel or isolated subtasks. Each subagent gets its own fresh context (no parent history) and a restricted toolset. A thread pool caps concurrency. Children cannot trigger HITL — they auto-deny write operations by default.

### Value for Cloud-Claw

- **Latency:** Diagnosing 4 servers sequentially takes 4× longer than needed. Subagents run them in parallel.
- **Complex audits:** nginx + MySQL + SSL + DNS checks can fan out instead of running in one long sequence.
- **Context hygiene:** Main agent stays focused on reasoning; children handle repetitive read operations, preventing context bloat.
- **Approval interleaving:** While an operator reviews a pending HITL approval, a subagent can run a fresh discovery scan in the background.

### Token / rate limit concern

Each subagent starts with a fresh ~2k token context (no inherited history), so per-subagent cost is low. The risk is concurrent API throughput — parallel subagents = parallel Anthropic API calls. Mitigate with:
- `MAX_SUBAGENTS=3` config cap (never more than 3 parallel children)
- Per-subagent token budget (kill child if it exceeds allocation)
- `SUBAGENT_AUTO_APPROVE=deny` default (children cannot block a worker thread on HITL)

### Implementation notes

- Subagent spawner in `src/agents/loop.ts` — main agent calls a `delegate(task, allowedTools[])` function
- `SafeToolGate` — filters the tool registry to the subset passed at spawn time; write tools excluded by default
- HITL queue integration — subagents either auto-deny or escalate to a separate approval queue
- Interrupt handling — `src/hitl/resume.ts` needs awareness of subagent session IDs for cancellation
- Effort estimate: ~4–6 days

### Reference

Implemented in `/tmp/reference-repo/tools/delegate_tool.py` (600+ lines). Uses `ThreadPoolExecutor` with configurable `max_workers` (default 3) and per-subagent token budget.

---

## Feature 2 — Skill / Procedure Curation with Self-Improvement

### What it is

A registry of reusable executable playbooks ("skills") that the agent can invoke directly like a tool. Unlike `fix_memory` (which surfaces text hints for the LLM to reason about), skills are called and executed — the agent doesn't re-reason the steps each time. A background curator agent manages their lifecycle and patches failing skills automatically.

### How it differs from existing fix_memory

| | `fix_memory.ts` (existing) | Skills (this feature) |
|---|---|---|
| Stores | `issueText` + `fixCommand` (two 500-char strings) | Full multi-step procedure (tool sequences, conditionals) |
| How used | Injected as text into system prompt — LLM reads and reasons | Directly invoked like a tool — executes the procedure |
| Static vs living | Fixed once saved | Self-improves on each invocation; curator patches failures |
| Lifecycle | None | `new → active → stale → archived` |

They are complementary: fix_memory handles "what has worked on this class of problem" recall; skills handle "given the diagnosis, here is the validated procedure to execute."

### Value for Cloud-Claw

- **Reduced LLM calls per session:** Common incidents (nginx 502, MySQL table repair, disk cleanup) run a pre-validated playbook instead of re-reasoning tool sequences from scratch.
- **Consistency:** Every occurrence of the same incident class gets the same approved fix — no drift from session to session.
- **Self-healing knowledge base:** Skills that fail get patched by the curator. The fix library improves with each incident handled.
- **Hallucination reduction:** Agent calls a curated, validated procedure instead of inventing a new tool sequence under pressure.

### Implementation notes

- Skill registry table in DB (`skills` — id, name, body, status, usage_count, version)
- Skill invocation in `src/agents/loop.ts` — agent can call `invoke_skill(name)` as a tool
- Curator background loop (can run in `src/workers/` or piggyback on approval worker)
- Lifecycle transitions: `new` after first save, `active` after N successful uses, `stale` after M days without use, `archived` by curator
- Write operations inside skills still require HITL — skill body is not exempt from guards
- Effort estimate: ~5–7 days

### Reference

Implemented in `/tmp/reference-repo/agent/curator.py` (143 lines), `/tmp/reference-repo/tools/skill_manager_tool.py`, `/tmp/reference-repo/tools/skills_guard.py`. Skills stored in `~/.hermes/skills/` with curator state in `.curator_state`.
