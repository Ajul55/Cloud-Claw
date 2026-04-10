import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

// Combined diagnostic command — all read-only
const LOAD_DIAGNOSTIC_CMD = [
    'free -m',
    'echo "=== UPTIME ==="',
    'uptime',
    'echo "=== TOP PROCESSES BY CPU ==="',
    'ps -eo pid,user,ppid,cmd,%mem,%cpu --sort=-%cpu | head -15',
    'echo "=== TOP PROCESSES BY MEM ==="',
    'ps -eo pid,user,ppid,cmd,%mem,%cpu --sort=-%mem | head -10',
    'echo "=== DISK I/O ==="',
    'iostat -x 1 2 2>/dev/null | tail -20 || echo "(iostat not available)"',
    'echo "=== OPEN FILE COUNTS ==="',
    'lsof 2>/dev/null | wc -l || echo "(lsof not available)"',
    'echo "=== NETWORK CONNECTIONS ==="',
    'ss -s 2>/dev/null || netstat -s 2>/dev/null | head -10 || echo "(ss/netstat not available)"',
].join(' ; ');

export const analyzeHighServerLoadTool: Tool = {
    name: 'analyze_high_server_load',
    description:
        'Diagnose high CPU or RAM usage on a server. Collects: memory stats, system uptime/load average, ' +
        'top processes by CPU and memory, disk I/O, open file counts, and network connection summary. ' +
        'Returns all data as formatted text for the agent to interpret and recommend a fix. ' +
        'This is a read-only diagnostic — safe to run at any time.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (use get_cloudstick_servers to list). Preferred over host.',
            },
            host: {
                type: 'string',
                description: 'Legacy: IP or hostname of the server. Prefer server_label.',
            },
        },
        required: [],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };

            const raw = await sshExec(server.ip, LOAD_DIAGNOSTIC_CMD, {
                ...sshOptions,
                // Give the compound command a bit more time
                timeoutMs: 45_000,
            });

            return {
                success: true,
                output: [
                    `Server Load Diagnostics — ${formatServerTarget(server)}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    raw,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `analyze_high_server_load failed: ${msg}` };
        }
    },
};
