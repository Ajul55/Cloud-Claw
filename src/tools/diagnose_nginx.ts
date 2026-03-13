import { sshExec } from '../utils/ssh.js';
import { formatServerTarget, resolveServerArg } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

interface ParsedNginxError {
    filePath: string;
    line: number;
}

function parseConfigError(output: string): ParsedNginxError | null {
    const match = output.match(/in\s+([/A-Za-z0-9._-]+):(\d+)/);
    if (!match) return null;
    return { filePath: match[1], line: Number(match[2]) };
}

function buildContextCommand(filePath: string, line: number): string {
    const start = Math.max(1, line - 3);
    const end = line + 3;
    return `nl -ba ${filePath} | sed -n '${start},${end}p'`;
}

export const diagnoseNginxTool: Tool = {
    name: 'diagnose_nginx',
    description:
        'Run a focused Nginx diagnostics routine on a remote host. ' +
        'Collects service status, nginx -t output, and surrounding config lines when an error references a file/line. ' +
        'Use this first when the user asks to diagnose or debug an Nginx failure.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label. Options: "production" (139.84.130.63) or "test" (65.20.82.177). If not specified, defaults to production.',
                enum: ['production', 'test'],
            },
            host: {
                type: 'string',
                description: 'Legacy host/IP override. Prefer server_label.',
            },
        },
        required: [],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        try {
            const server = await resolveServerArg(args);
            const [statusOutput, testOutput] = await Promise.all([
                sshExec(
                    server.ip,
                    `sudo systemctl status nginx --no-pager -l 2>&1 | sed -n '1,80p' || systemctl status nginx --no-pager -l 2>&1 | sed -n '1,80p'`
                    , { user: server.sshUser, port: server.sshPort }
                ),
                sshExec(server.ip, 'sudo nginx -t 2>&1 || nginx -t 2>&1', { user: server.sshUser, port: server.sshPort }),
            ]);

            let configContext = 'No config file/line error detected from nginx -t.';
            const parsed = parseConfigError(testOutput);
            if (parsed) {
                try {
                    configContext = await sshExec(server.ip, buildContextCommand(parsed.filePath, parsed.line), {
                        user: server.sshUser,
                        port: server.sshPort,
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    configContext = `Failed to fetch config context: ${msg}`;
                }
            }

            const summary = [
                `Nginx diagnostics for ${formatServerTarget(server)}`,
                '',
                '1) Service status (first 80 lines):',
                '```',
                statusOutput || '(no output)',
                '```',
                '',
                '2) nginx -t output:',
                '```',
                testOutput || '(no output)',
                '```',
                '',
                '3) Relevant config context:',
                '```',
                configContext || '(no output)',
                '```',
            ].join('\n');

            return { success: true, output: summary };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Nginx diagnostics failed: ${msg}` };
        }
    },
};
