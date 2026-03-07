---
name: cloudclaw-hitl
description: "Read this before working on anything related to HITL approvals, the Proceed/Reject flow, approval cards in Slack, session resume after approval, or the hitl_approvals database table. This covers the complete approval lifecycle from creation to resume."
---

# Cloud-Claw HITL (Human-in-the-Loop) Approval System

## What HITL Does

When the agent wants to execute a write operation (edit a config file,
restart a service, install a package), it PAUSES and sends an interactive
Proceed/Reject card to the Pilot via Slack or Telegram.

The loop saves its state to PostgreSQL and exits.
When the Pilot clicks Proceed, `resumeApprovedSession()` restores the
session, executes the approved action, and continues the conversation.

---

## Approval Lifecycle

```
Loop wants to execute write tool (e.g. fix_nginx_config)
         ↓
getToolApprovalRequest() returns { command, targetHost, rationale }
         ↓
createApproval() saves to hitl_approvals table (status = 'pending')
         ↓
onApproval() renders Proceed/Reject card in Slack/Telegram
         ↓
onReply() sends "Approval Required" text message
         ↓
upsertSession() saves current messages state
         ↓
loop returns (paused)
         ↓
         ┌───────────────────┐
         │   Pilot clicks    │
         │ Proceed or Reject │
         └───────────────────┘
                  ↓
    Slack/Telegram webhook fires
                  ↓
    resumeApprovedSession(approvalId, approved, pilotUserId)
                  ↓
    ┌── approved = true ──────────────────────────────┐
    │  Load session from DB by approvalId             │
    │  Execute the approved tool                      │
    │  Push tool result into messages                 │
    │  Call runAgentLoop again with resumed session   │
    └─────────────────────────────────────────────────┘
         ↓
    ┌── approved = false ─────────────────────────────┐
    │  Update status = 'rejected'                     │
    │  Reply: "Action cancelled by Pilot"             │
    └─────────────────────────────────────────────────┘
```

---

## Database Table

```sql
hitl_approvals (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  command     TEXT NOT NULL,     -- encoded tool command or raw bash
  target_host TEXT NOT NULL,
  rationale   TEXT NOT NULL,     -- shown on approval card
  status      TEXT NOT NULL DEFAULT 'pending',
               -- 'pending' | 'approved' | 'rejected' | 'expired'
  approved_by TEXT,              -- userId of Pilot who acted
  created_at  TIMESTAMPTZ DEFAULT NOW()
)
```

---

## createApproval() — DB Function

```typescript
// src/database/db.ts
async function createApproval(data: {
  session_id: string;
  command: string;
  target_host: string;
  rationale: string;
}): Promise<{ id: number }> {
  const result = await pool.query(
    `INSERT INTO hitl_approvals (session_id, command, target_host, rationale)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [data.session_id, data.command, data.target_host, data.rationale]
  );
  return { id: result.rows[0].id };
}
```

---

## Slack Approval Card — Block Kit

The `onApproval` callback in `src/index.ts` must post a Slack Block Kit
message with two buttons. The button values must be plain strings.

```typescript
// CORRECT Block Kit structure
await slack.chat.postMessage({
  channel: message.channel,   // same channel as the incoming message
  text: `Approval required: ${rationale}`,
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🔐 Approval Required*\n\n` +
              `*Action:* \`${command}\`\n` +
              `*Server:* \`${targetHost}\`\n` +
              `*Reason:* ${rationale}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Proceed' },
          style: 'primary',
          action_id: 'hitl_proceed',
          value: String(approvalId),   // ← MUST be a plain string, not JSON
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject' },
          style: 'danger',
          action_id: 'hitl_reject',
          value: String(approvalId),   // ← same here
        },
      ],
    },
  ],
});
```

**Critical rules for the Slack card:**
- Post to the SAME channel as the incoming message — not a hardcoded ID
- `value` must be `String(approvalId)` — a plain string, never a JSON object
- Wrap the entire `postMessage` in try/catch and log any error
- If `postMessage` fails silently, the Pilot will never see the card

---

## Telegram Approval Card

For Telegram, use inline keyboard buttons:

```typescript
await telegram.sendMessage(chatId, 
  `🔐 *Approval Required*\n\n` +
  `Action: \`${command}\`\n` +
  `Server: \`${targetHost}\`\n` +
  `Reason: ${rationale}`,
  {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Proceed', callback_data: `approve_${approvalId}` },
        { text: '❌ Reject',  callback_data: `reject_${approvalId}` },
      ]],
    },
  }
);
```

---

## resumeApprovedSession() — src/hitl/resume.ts

This function is called when the Pilot clicks Proceed or Reject.

```typescript
export async function resumeApprovedSession(
  approvalId: number,
  approved: boolean,
  pilotUserId: string,
  onReply: ReplyFn,
  onApproval: ApprovalFn,
): Promise<void> {
  // 1. Load the approval record
  const approval = await getApprovalById(approvalId);
  if (!approval || approval.status !== 'pending') {
    await onReply('⚠️ This approval has already been handled or expired.');
    return;
  }

  // 2. Update status in DB
  await updateApprovalStatus(approvalId, approved ? 'approved' : 'rejected', pilotUserId);

  if (!approved) {
    await onReply('❌ Action rejected by Pilot. No changes were made.');
    return;
  }

  // 3. Load the paused session
  const session = await getSession(approval.session_id);
  if (!session) {
    await onReply('⚠️ Session not found — it may have expired. Please retry.');
    return;
  }

  // 4. Decode the approved command
  const { toolName, toolArgs } = decodeToolApprovalCommand(approval.command);

  // 5. Execute the approved tool
  const tool = getToolByName(toolName);
  if (!tool) {
    await onReply(`⚠️ Tool "${toolName}" not found in registry.`);
    return;
  }

  const result = await tool.execute(toolArgs);

  // 6. Push result into session messages
  const messages = session.messages as OpenAI.ChatCompletionMessageParam[];
  // Find the tool_call_id that was saved when approval was requested
  // and push the real result
  messages.push({
    role: 'tool',
    tool_call_id: approval.tool_call_id,  // saved when approval was created
    content: result.output,
  });

  // 7. Re-enter the agent loop with the resumed session
  await runAgentLoop(
    {
      sessionId: approval.session_id,
      userId: pilotUserId,
      channel: session.channel,
      text: undefined,  // no new user message — just continue from tool result
    },
    onReply,
    onApproval,
  );
}
```

---

## getToolApprovalRequest() — Which Tools Need Approval

In `loop.ts`, this function decides if a tool call needs HITL:

```typescript
function getToolApprovalRequest(
  toolName: string,
  toolArgs: Record<string, unknown>
): { command: string; targetHost: string; rationale: string } | null {
  if (toolName === 'fix_nginx_config') {
    return {
      command: encodeToolApprovalCommand(toolName, toolArgs),
      targetHost: String(toolArgs.host ?? 'unknown'),
      rationale: `Edit Nginx config at ${toolArgs.file_path} and restart Nginx.`,
    };
  }
  // Add new approval-required tools here as you build them:
  // if (toolName === 'restart_service') { ... }
  // if (toolName === 'install_package') { ... }
  return null;
}
```

---

## Startup Cleanup

On every app startup, expire stale pending approvals:

```typescript
// In src/database/db.ts, call this on startup
export async function expireStaleApprovals(): Promise<void> {
  await pool.query(`
    UPDATE hitl_approvals
    SET status = 'expired'
    WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '30 minutes'
  `);
}
```

---

## Text-Based Approval (Fast Path)

Users can also type "proceed" or "reject" instead of clicking a button.
The loop handles this at the top before entering the iteration:

```typescript
const normalized = (message.text ?? '').trim().toLowerCase();
if (normalized) {
  const pending = await getLatestPendingApproval(message.sessionId);
  if (pending) {
    const isApprove = ['proceed', 'approve', 'yes', 'apply', 'fix', 'do it'].includes(normalized);
    const isReject  = ['reject', 'no', 'stop', 'cancel'].includes(normalized);
    if (isApprove || isReject) {
      await resumeApprovedSession(pending.id, isApprove, message.userId, onReply, onApproval);
      await indicator?.stop(true);
      return;
    }
  }
}
```

---

## Common HITL Bugs and Fixes

**Bug: Approval card never appears in Slack**
- Check: is `postMessage` in a try/catch? Is the error logged?
- Check: is the channel the same as the incoming message?
- Check: is `value` a plain string or a JSON object?

**Bug: Pilot clicks Proceed but nothing happens**
- Check: is the button action_id handler registered in the Slack app?
- Check: does `resumeApprovedSession` exist and is it imported?
- Check: is the approvalId being parsed from the button value correctly?

**Bug: "This approval has already been handled"**
- The approval was already expired by the startup cleanup.
- Default timeout is 30 minutes — increase if Pilots are slow to respond.

**Bug: Stuck pending approvals after restart**
- Run: `UPDATE hitl_approvals SET status = 'expired' WHERE status = 'pending';`
- Add the startup cleanup function (see above).
