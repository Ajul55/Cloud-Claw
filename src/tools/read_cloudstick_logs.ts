import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

const VALID_LOG_FILES = ['agent.log', 'cron.log', 'backup.log'] as const;
type LogFile = typeof VALID_LOG_FILES[number];

export const readCloudstickLogsTool: Tool = {
    name: 'read_cloudstick_logs',
    description:
        'Read internal Cloudstick agent/cron/backup logs from /var/log/cloudstick/. ' +
        'Use this when a cron job, backup, or API action is reported as "Success" in the dashboard ' +
        'but did not actually execute on the server. These logs contain the real error messages ' +
        '(e.g. Permission Denied, Connection Refused) that the API does not expose. ' +
        'Valid log files: agent.log, cron.log, backup.log.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (use get_cloudstick_servers to list).',
            },
            host: {
                type: 'string',
                description: 'Legacy: IP or hostname. Prefer server_label.',
            },
            log_file: {
                type: 'string',
                enum: [...VALID_LOG_FILES],
                description: 'Which log file to read: agent.log, cron.log, or backup.log.',
            },
            lines: {
                type: 'number',
                description: 'Number of lines to tail (default: 100, max: 200).',
            },
            filter: {
                type: 'string',
                description: 'Optional grep filter to narrow results (e.g. "error", "failed", a domain name).',
            },
        },
        required: ['log_file'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const logFile = String(args.log_file ?? '').trim();
        const lines = Math.min(Math.max(Number(args.lines) || 100, 1), 200);
        const filter = String(args.filter ?? '').trim();

        if (!VALID_LOG_FILES.includes(logFile as LogFile)) {
            return {
                success: false,
                output: `Error: Invalid log file "${logFile}". Valid options: ${VALID_LOG_FILES.join(', ')}`,
            };
        }

        const logPath = `/var/log/cloudstick/${logFile}`;

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };

            // Check if the log file exists
            const exists = await sshExec(
                server.ip,
                `test -f ${logPath} && echo "exists" || echo "missing"`,
                sshOptions
            );

            if (exists.trim() !== 'exists') {
                return {
                    success: false,
                    output: `Log file not found: ${logPath}\nThe Cloudstick agent may not be installed on this server.`,
                };
            }

            // Build command: tail with optional grep filter
            let cmd = `tail -n ${lines} ${logPath}`;
            if (filter) {
                // Escape special regex chars in the filter for safety
                const safeFilter = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cmd += ` | grep -i '${safeFilter}'`;
            }

            const raw = await sshExec(server.ip, cmd, {
                ...sshOptions,
                timeoutMs: 15_000,
            });

            const output = raw.trim() || '(no matching log entries)';

            return {
                success: true,
                output: [
                    `Cloudstick Logs — ${formatServerTarget(server)}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    `File:   ${logPath}`,
                    `Lines:  last ${lines}${filter ? ` (filtered: "${filter}")` : ''}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    output,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `read_cloudstick_logs failed: ${msg}` };
        }
    },
};
