---
name: cloudclaw-troubleshooting
description: "Read this when CloudClaw is not working as expected. Covers every bug that has been encountered and fixed, symptoms to look for in terminal logs, and exact fixes. If the AI is hallucinating, tools aren't running, Slack cards aren't appearing, or SSH isn't connecting — start here."
---

# Cloud-Claw Troubleshooting — Known Bugs and Fixes

## How to Diagnose Quickly

Always check terminal logs and Cloudstick internal logs first. The most important logs:

**1. Terminal Output:**

```
✅ Working correctly:
[loop] ⚡ EXECUTING TOOL: diagnose_nginx on host: 139.x.x.x
[loop] ✅ TOOL COMPLETE: diagnose_nginx — output length: 842 chars

❌ Tool skipped:
[loop] Iteration 1/10 — (no EXECUTING TOOL line follows)

❌ Hallucination blocked:
[loop] HALLUCINATION DETECTED — LLM claimed success without tool execution

❌ Tool forced but LLM avoided:
[loop] LLM avoided tool call despite tool_choice required
```

**2. Internal Cloudstick Logs (/var/log/cloudstick/):**
- Use `read_cloudstick_logs` to check `agent.log`, `cron.log`, or `backup.log`.
- Look for silent errors where the API returns 200 but the OS operation failed.
- **Rule T-18**: Mandatory log inspection if an API call reports success but state remains unchanged.

---

## BUG-1: LLM Claims Service Is Running Without Checking

**Symptom:** CloudClaw says "Nginx is running" or "MariaDB is active"
but the server shows it's failed. No `⚡ EXECUTING TOOL` in terminal.

**Root cause:** `hasExecutedTool` is initialised from session history
instead of always starting `false`. Or hallucination patterns are
missing the service name.

**Fix in loop.ts:**
```typescript
// Line must be:
let hasExecutedTool = false;
// NOT:
let hasExecutedTool = messages.some((m) => m.role === 'tool');
```

Also verify `hallucinationPatterns` includes the service name being faked.

---

## BUG-2: Tool Never Runs — LLM Describes Steps Instead

**Symptom:** CloudClaw sends a numbered list of "steps I will take"
without actually running any tool. Terminal shows no EXECUTING TOOL line.

**Root cause:** `tool_choice: 'auto'` lets the LLM reply with text
instead of calling a tool.

**Fix in loop.ts:** Verify the `requiresTool` regex includes the
keywords from the user's message. Add missing keywords.

Also verify the SYSTEM_PROMPT TOOL USAGE RULES say:
"Do NOT ask for confirmation between steps."
"NEVER ask the user for confirmation before calling a tool."

---

## BUG-3: Nginx Config Has Literal \n Instead of Newlines

**Symptom:** `nginx -t` fails with `unknown directive "` on line 1.
`cat` of the config file shows everything on one line with `\n` visible.

**Root cause:** `fix_nginx_config` wrote the file using `echo "$content"`
where `$content` contains literal backslash-n from JavaScript template strings.

**Fix in fix_nginx_config.ts:** Use base64 transfer:
```typescript
const encoded = Buffer.from(content, 'utf8').toString('base64');
await sshExec(host, `echo '${encoded}' | base64 -d | tee ${filePath} > /dev/null`);
// Verify
const preview = await sshExec(host, `head -3 ${filePath}`);
if (preview.includes('\\n')) throw new Error('Literal \\n in written file');
```

**Emergency manual fix on the server:**
```bash
printf 'server {\n    listen 80;\n    server_name yourdomain.com;\n    root /path/to/webroot;\n    index index.html index.php;\n}\n' > /etc/nginx/sites-enabled/yourdomain.com
nginx -t && systemctl start nginx
```

---

## BUG-4: Slack Approval Card Never Appears

**Symptom:** CloudClaw says "Please click Proceed or Reject on the card
above" but no card appears. Pilot sees only the text message.

**Root cause:** `postMessage` in Slack's `onApproval` callback is
failing silently — no try/catch, no error logged.

**Fix in src/index.ts:**
```typescript
// Wrap postMessage in try/catch
try {
  await slack.chat.postMessage({
    channel: channelId,  // must be the INCOMING channel, not a hardcoded ID
    blocks: [...],
    text: `Approval required: ${rationale}`,
  });
} catch (err) {
  console.error('[slack] Failed to post approval card:', err);
  // Fallback: send plain text with instructions
  await slack.chat.postMessage({
    channel: channelId,
    text: `🔐 Approval required. Type "proceed" to approve or "reject" to cancel.\nAction: ${command}`,
  });
}
```

Also verify:
- `channel` is the actual channel ID from the incoming message
- Button `value` is `String(approvalId)` not `JSON.stringify({ id: approvalId })`
- The Slack app has `chat:write` permission

---

## BUG-5: HITL Resume Does Nothing After Proceed

**Symptom:** Pilot clicks Proceed, Slack acknowledges the click,
but CloudClaw never continues. Session stays paused forever.

**Root cause:** `src/hitl/resume.ts` either doesn't exist or is not
being called from the Slack button handler.

**Fix:** Verify the Slack action handler:
```typescript
// In src/index.ts Slack setup
slack.action('hitl_proceed', async ({ body, ack }) => {
  await ack();
  const approvalId = parseInt(body.actions[0].value, 10);
  const userId = body.user.id;
  const channelId = body.channel?.id ?? '';
  await resumeApprovedSession(
    approvalId,
    true,
    userId,
    (text) => slack.chat.postMessage({ channel: channelId, text }),
    (req) => postApprovalCard(channelId, req),
  );
});

slack.action('hitl_reject', async ({ body, ack }) => {
  await ack();
  const approvalId = parseInt(body.actions[0].value, 10);
  await resumeApprovedSession(
    approvalId,
    false,
    body.user.id,
    (text) => slack.chat.postMessage({ channel: body.channel?.id ?? '', text }),
    async () => {},
  );
});
```

---

## BUG-6: "I Was Unable to Connect to the Server"

**Symptom:** Every tool call fails. Terminal shows SSH connection errors.
CloudClaw replies "Unable to connect to the server."

**Root cause:** SSH config in `.env` is wrong or the key file is missing.

**Diagnose:**
```bash
# Check .env
cat .env | grep SSH

# Test connection manually
ssh -i $SSH_PRIVATE_KEY_PATH $SSH_USER@$SSH_HOST "echo connected"

# Common fixes:
chmod 600 /path/to/private/key
# Verify SSH_HOST is set (not empty)
# Verify the key file path exists
```

---

## BUG-7: Fake Tool Calls Corrupting Message History

**Symptom:** LLM starts returning increasingly confused responses.
Tool results don't make sense. `Invalid message format` errors from OpenAI.

**Root cause:** A developer added fake `tool_calls` injection
into messages:
```typescript
// ❌ This corrupts message history
messages.push({
  role: 'assistant',
  tool_calls: [{ id: `auto-${Date.now()}`, ... }]  // LLM never said this
});
```

**Fix:** Remove all fake tool_calls injections. The only messages that
should have `tool_calls` are messages returned directly from the LLM API.
Search for this pattern and delete it:
```bash
grep -n "auto-.*Date.now\|fake.*tool\|inject.*tool" src/agents/loop.ts
```

---

## BUG-8: LLM Prints "functions.execute_ssh_command(" in Chat

**Symptom:** CloudClaw sends a message containing visible function call
syntax like `functions.diagnose_nginx({ host: "139.x.x.x" })`.

**Root cause:** LLM is hallucinating tool invocations as text instead
of calling them through the API.

**Fix:** The `containsInternalToolSyntax()` guard handles this with
a one-time retry. If it's happening repeatedly, strengthen SYSTEM_PROMPT:
```
NEVER print function names, JSON, or tool call syntax in your replies.
Tools are called via the hidden API — the user never sees tool calls.
```

---

## BUG-9: Stuck Pending Approvals After Restart

**Symptom:** After restarting CloudClaw, old approval requests remain
as 'pending' in the DB. New approvals may conflict with old session data.

**Fix:** Run this on the database:
```sql
UPDATE hitl_approvals
SET status = 'expired'
WHERE status = 'pending';
```

Add to startup in `src/index.ts`:
```typescript
await expireStaleApprovals();  // expires anything older than 30 minutes
```

---

## BUG-10: Session History Growing Too Large

**Symptom:** LLM errors about context window exceeded. Slow responses.
High token costs per message.

**Root cause:** Session messages array in PostgreSQL grows indefinitely.
A multi-day conversation can accumulate hundreds of messages.

**Fix (add to loop.ts):**
```typescript
// Trim session to last 20 messages before each LLM call
// Always keep the first message (original request context)
const MAX_HISTORY = 20;
const trimmed = messages.length > MAX_HISTORY
  ? [messages[0], ...messages.slice(-MAX_HISTORY + 1)]
  : messages;
// Use trimmed instead of messages in the LLM call
```

---

## NEW: SRE Forensic Rules (The "Cloudstick Standard")

### Rule T-17: Firewall Integrity (CSF)
Before reporting an IP as "not blocked" or "whitelisted," the AI MUST run `csf -g <ip>`.
- If the output shows the IP in `/etc/csf/csf.deny`, it is BLOCKED regardless of what `iptables` might suggest.
- If the output shows the IP in `/etc/csf/csf.allow`, it is WHITELISTED.
- **Tools**: `manage_csf_firewall` (diagnose mode).

### Rule T-18: Silent Failure Audit
When a Cloudstick API tool (e.g., `create_cron_job`, `create_database`) returns `success: true`, but the expected state (crontab entry, database user) is not found via SSH, the AI MUST use `read_cloudstick_logs` to inspect `/var/log/cloudstick/agent.log`.
- Cloudstick often queues operations; success means "queued," not "completed on disk."

### Rule T-19: FTP Forensic Chain (Pure-FTPd)
Standard diagnostics for `pureftpd-cs`:
1. Check process: `systemctl status pureftpd-cs`
2. Check port 21: `netstat -plnt | grep :21`
3. Audit passive ports: Inspect `/etc/csf/csf.conf` for matching `TCP_IN` ports (default 30000:35000).

### Rule T-20: PHP Pool Forensics (502 Investigation)
If a website returns 502, but `systemctl status phpX.Xcs-fpm` is `active`, the AI MUST run `diagnose_php_pool`.
- Common cause: Missing socket file due to pools being renamed or disabled in `/etc/phpX.Xcs/fpm-pools.d/`.

---

## Quick Diagnostic Commands

Run these to understand the current state:

```bash
# Check pending approvals
psql -c "SELECT id, session_id, target_host, status, created_at FROM hitl_approvals ORDER BY created_at DESC LIMIT 10;"

# Check active sessions
psql -c "SELECT id, channel, user_id, iteration, updated_at FROM ai_sessions ORDER BY updated_at DESC LIMIT 10;"

# Check recent usage
psql -c "SELECT model, tool_name, tokens_in + tokens_out as total_tokens, latency_ms FROM usage_log ORDER BY created_at DESC LIMIT 20;"

# Clear everything and start fresh (development only)
psql -c "DELETE FROM ai_sessions; UPDATE hitl_approvals SET status = 'expired' WHERE status = 'pending';"
```

---

## Verification Tests After Any Change

Always run these tests after modifying loop.ts or any tool:

**Test 1 — Tool actually runs:**
```
Send: "@CloudClaw what is the nginx status?"
Expected terminal: [loop] ⚡ EXECUTING TOOL: diagnose_nginx
Fail: CloudClaw replies without that log line
```

**Test 2 — Hallucination is blocked:**
Stop nginx manually: `systemctl stop nginx`
```
Send: "@CloudClaw is nginx running?"
Expected: CloudClaw runs tool, reports nginx is stopped
Fail: CloudClaw says "nginx is running" without running a tool
```

**Test 3 — Fix chain works:**
```
Send: "@CloudClaw fix the nginx error on [host]"
Expected terminal:
  [loop] ⚡ EXECUTING TOOL: diagnose_nginx
  [loop] ✅ TOOL COMPLETE: diagnose_nginx
  [loop] Auto-chain: diagnose found error in /etc/nginx/...
  [loop] ⚡ EXECUTING TOOL: fix_nginx_config
Fail: Only diagnose runs, then CloudClaw asks for confirmation
```

**Test 4 — SSH connects:**
```
Send: "@CloudClaw get current time"
Expected: CloudClaw returns current time from get_current_time tool
Fail: "Unable to connect" error
```
