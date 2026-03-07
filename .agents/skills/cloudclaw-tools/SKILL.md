---
name: cloudclaw-tools
description: "Read this before creating a new tool, modifying an existing tool, adding a tool to the registry, or changing how tools execute SSH commands. Covers the tool interface, how to register tools, SSH execution patterns, and the base64 file write pattern."
---

# Cloud-Claw Tools — Building and Registering Tools

## Tool Interface

Every tool must implement this interface:

```typescript
// src/tools/types.ts
interface Tool {
  name: string;           // matches the function name in LLM tool definition
  description: string;   // shown to LLM — be precise
  parameters: object;    // JSON Schema for LLM
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  output: string;   // ALWAYS a string — this is what the LLM sees
}
```

---

## Registering a Tool

In `src/tools/tool_registry.ts`:

```typescript
import { myNewTool } from './my_new_tool.js';

const TOOLS: Tool[] = [
  get_current_time,
  diagnose_nginx,
  fix_nginx_config,
  execute_ssh_command,
  discovery_agent,
  myNewTool,       // ← add here
];

export function getLLMToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }
  }));
}

export function getToolByName(name: string): Tool | undefined {
  return TOOLS.find(t => t.name === name);
}
```

---

## Tool File Template

```typescript
// src/tools/my_tool.ts
import { sshExec } from '../utils/ssh.js';
import { STACK_PROFILE } from '../config/stack_profile.js';
import type { ToolResult } from './types.js';

export const my_tool = {
  name: 'my_tool',
  description: 'What this tool does — be specific for the LLM. ' +
    'Include when to use it and what parameters are required.',
  parameters: {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description: 'IP address or hostname of the target server',
      },
      // add more parameters here
    },
    required: ['host'],
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const host = String(args.host ?? '');
    if (!host) {
      return { success: false, output: 'Error: host parameter is required' };
    }

    try {
      const output = await sshExec(host, 'your command here');
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Error: ${msg}` };
    }
  },
};
```

---

## SSH Execution — Always Use sshExec

The shared SSH utility is in `src/utils/ssh.ts`.
Never duplicate SSH connection logic inside a tool.

```typescript
import { sshExec } from '../utils/ssh.js';

// Basic usage
const output = await sshExec(host, 'systemctl status nginx-cs');

// With timeout (default is 30s)
const output = await sshExec(host, 'find / -name "*.log"', { timeout: 60000 });
```

`sshExec` reads SSH credentials from `env` (SSH_HOST, SSH_USER, SSH_PRIVATE_KEY_PATH).
It returns stdout+stderr combined as a string.
It throws on connection failure or non-zero exit if `throwOnError` is true.

---

## Writing Files to Remote Server — Always Use Base64

**NEVER write file content directly via echo or heredoc.**
Shell variable expansion will convert `\n` to literal backslash-n,
breaking config files silently.

### ❌ Wrong — produces literal \n in file
```typescript
await sshExec(host, `echo "${content}" > /etc/nginx/site.conf`);
await sshExec(host, `cat > /etc/nginx/site.conf << EOF\n${content}\nEOF`);
```

### ✅ Correct — base64 transfer guarantees real newlines
```typescript
async function writeRemoteFile(host: string, filePath: string, content: string): Promise<void> {
  // Verify content has real newlines before encoding
  if (!content.includes('\n')) {
    throw new Error(`File content has no newlines — aborting write to ${filePath}`);
  }

  const encoded = Buffer.from(content, 'utf8').toString('base64');

  // Write via base64 decode
  await sshExec(host, `echo '${encoded}' | base64 -d | tee ${filePath} > /dev/null`);

  // Verify — check first 3 lines look right
  const preview = await sshExec(host, `head -3 ${filePath}`);

  if (preview.includes('\\n')) {
    throw new Error(
      `Write verification failed — ${filePath} contains literal \\n characters. ` +
      `Base64 transfer failed.`
    );
  }
}
```

Always verify after writing. Always back up the original before overwriting:

```typescript
// Backup before overwriting
await sshExec(host, `cp ${filePath} ${filePath}.bak.$(date +%s)`);
// Then write
await writeRemoteFile(host, filePath, newContent);
```

---

## Tool Output Rules

The `output` string is sent directly to the LLM as a tool result.

**DO:**
- Return real command output verbatim (systemctl status lines, nginx -t output)
- Include the key status line: `Active: active (running)` or `Active: failed`
- Return structured summary when output would be too long
- Always return something — never return empty string

**DO NOT:**
- Return fabricated output
- Return "success" with no evidence
- Truncate critical error lines
- Return raw JSON objects (convert to string first)

```typescript
// ✅ Good output
return {
  success: true,
  output: `nginx-cs status: Active: active (running) since 2026-03-07 09:15:22 UTC\n` +
          `nginx-cs -t: syntax is ok\n` +
          `Config file: /etc/nginx-cs/nginx.conf`
};

// ❌ Bad output
return { success: true, output: 'Done' };
return { success: true, output: '' };
```

---

## Security Rules for Tools

Tools that accept a `command` parameter MUST check the security filter:

```typescript
import { checkCommand, requiresApproval } from '../security/command_filter.js';

const check = checkCommand(command);
if (!check.safe) {
  return { success: false, output: `BLOCKED: ${check.reason}` };
}
```

Tools that perform write operations MUST:
1. Be listed in `getToolApprovalRequest()` in `loop.ts`
2. Return a clear rationale string for the approval card
3. Accept the approval flow pausing execution

---

## Current Tool Inventory

| Tool | Purpose | Requires Approval |
|---|---|---|
| `get_current_time` | Smoke test | No |
| `execute_ssh_command` | Read-only SSH commands | No (Tier-3 commands auto-blocked) |
| `diagnose_nginx` | Nginx status + config test | No |
| `fix_nginx_config` | Repair nginx config file | **Yes** |
| `discovery_agent` | WordPress stack mapping | No |

---

## Adding the Next Tools (Level 4)

When building Power Skills, each becomes a tool:

```
restart_service      — restart any service by name (Tier-2 approval)
fix_wordpress        — repair WP white screen
switch_php_version   — change PHP version for a site
renew_ssl            — Let's Encrypt cert renewal
check_disk_usage     — df -h + find large files
check_memory         — free -h + top processes
install_package      — apt install with approval gate
flush_cache          — clear OPcache, Redis, WP cache
```

Each follows the same Tool interface above.
Each must use `sshExec` from `src/utils/ssh.ts`.
Each must use `STACK_PROFILE` instead of hardcoded service names.
