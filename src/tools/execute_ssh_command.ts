import { sshExec } from '../utils/ssh.js';
import { formatServerTarget, resolveServerArg } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

// ─── Cloudstick Service/Path Rewriter ──────────────────────────────────────────
// Cloudstick servers use proprietary service names and paths.
// The LLM's training data causes it to emit generic Ubuntu/RHEL commands.
// This function intercepts and rewrites them at the SSH execution boundary.

/** Services that do NOT exist on Cloudstick — block with helpful message */
const NON_EXISTENT_SERVICES = new Set(['httpd']);

/** Services that exist but under a different name — rewrite with guidance */
const MISNAMED_SERVICE_GUIDANCE: Array<[RegExp, string]> = [
    // "systemctl status apache2" → guidance to use apache2-cs
    [/\b(systemctl\s+\w+\s+apache2|which\s+apache2|service\s+apache2)\b(?!-cs)/i,
        'Cloudstick does NOT use "apache2". The Cloudstick Apache service is "apache2-cs". ' +
        'Use "systemctl status apache2-cs" instead. Note: Apache only runs on sites with the nginx+apache stack.'],
];

/** Rewrite generic service names → Cloudstick equivalents */
const SERVICE_REWRITES: Array<[RegExp, string]> = [
    // nginx → nginx-cs (but not if already nginx-cs)
    [/\bnginx(?!-cs)\b/g, 'nginx-cs'],
    // apache2 → apache2-cs (but not if already apache2-cs)
    [/\bapache2(?!-cs)\b/g, 'apache2-cs'],
    // php8.1-fpm → php81cs-fpm (dot-separated Ubuntu format)
    [/\bphp(\d+)\.(\d+)-fpm\b/g, 'php$1$2cs-fpm'],
    // php-fpm8.3 → php83cs-fpm (alternate format)
    [/\bphp-fpm(\d+)\.(\d+)\b/g, 'php$1$2cs-fpm'],
];

/** Rewrite generic paths → Cloudstick paths */
const PATH_REWRITES: Array<[RegExp, string]> = [
    [/\/etc\/nginx\/sites-enabled\//g, '/etc/nginx-cs/vhosts.d/'],
    [/\/etc\/nginx\/sites-available\//g, '/etc/nginx-cs/vhosts.d/'],
    [/\/etc\/nginx\/conf\.d\//g, '/etc/nginx-cs/vhosts.d/'],
    // /etc/nginx/ (but not if already /etc/nginx-cs/)
    [/\/etc\/nginx(?!-cs)\//g, '/etc/nginx-cs/'],
    // /var/log/nginx/ (but not if already /var/log/nginx-cs/)
    [/\/var\/log\/nginx(?!-cs)\//g, '/var/log/nginx-cs/'],
];

interface RewriteResult {
    command: string;
    blocked: string | null;
    rewrites: string[];
}

function rewriteForCloudstick(command: string): RewriteResult {
    const trimmed = command.trim();
    const rewrites: string[] = [];

    // 1a. Block commands targeting services with wrong names (redirect to Cloudstick name)
    for (const [pattern, guidance] of MISNAMED_SERVICE_GUIDANCE) {
        if (pattern.test(trimmed)) {
            return {
                command: trimmed,
                blocked: guidance,
                rewrites: [],
            };
        }
    }

    // 1b. Block commands targeting non-existent services
    for (const svc of NON_EXISTENT_SERVICES) {
        // Match: systemctl status apache2, which apache2, service apache2 status, etc.
        const pattern = new RegExp(`\\b(systemctl\\s+\\w+\\s+${svc}|which\\s+${svc}|service\\s+${svc}|${svc}\\s+-(t|T|v|V))\\b`, 'i');
        if (pattern.test(trimmed)) {
            return {
                command: trimmed,
                blocked: `Cloudstick servers do NOT use "${svc}". ` +
                    'The web server is "nginx-cs" (not nginx, not apache2, not httpd). ' +
                    'PHP is managed via php81cs-fpm through php85cs-fpm. ' +
                    'Use "systemctl status nginx-cs" or "diagnose_nginx" instead.',
                rewrites: [],
            };
        }
    }

    // 2. Rewrite service names
    let rewritten = trimmed;
    for (const [pattern, replacement] of SERVICE_REWRITES) {
        const before = rewritten;
        rewritten = rewritten.replace(pattern, replacement);
        if (rewritten !== before) {
            rewrites.push(`service: ${pattern.source} → ${replacement}`);
        }
    }

    // 3. Rewrite paths
    for (const [pattern, replacement] of PATH_REWRITES) {
        const before = rewritten;
        rewritten = rewritten.replace(pattern, replacement);
        if (rewritten !== before) {
            rewrites.push(`path: ${pattern.source} → ${replacement}`);
        }
    }

    return { command: rewritten, blocked: null, rewrites };
}

function enrichServiceRestartCommand(command: string): string {
    const trimmed = command.trim();
    const restartMatch = trimmed.match(/^sudo\s+systemctl\s+restart\s+([a-zA-Z0-9_.@-]+)\s*$/i)
        ?? trimmed.match(/^systemctl\s+restart\s+([a-zA-Z0-9_.@-]+)\s*$/i);

    if (!restartMatch) return command;
    const service = restartMatch[1];

    // PHP-FPM services hang on restart — force-kill processes first, then start fresh
    const isPhpService = /^php/i.test(service);
    if (isPhpService) {
        return `killall -9 php php-fpm php[0-9][0-9]cs-fpm 2>/dev/null; systemctl start ${service} && systemctl is-active ${service} && systemctl status ${service} --no-pager -l | sed -n '1,30p'`;
    }

    return `${trimmed} && systemctl is-active ${service} && systemctl status ${service} --no-pager -l | sed -n '1,30p'`;
}

export const executeSshCommandTool: Tool = {
    name: 'execute_ssh_command',
    description:
        'Execute a read-only or diagnostic shell command on a remote Linux server via SSH. ' +
        'Use this to check service status, read logs, view processes, or perform other systems administrative discovery. ' +
        'Note: If the command modifies state, it will be automatically routed for human approval.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label or ID from Cloudstick API (use get_cloudstick_servers to find active server IDs).',
            },
            host: {
                type: 'string',
                description: 'Legacy host/IP override. Prefer server_label.',
            },
            command: {
                type: 'string',
                description: 'The shell command to execute. Must be a valid bash command.',
            },
        },
        required: ['command'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const rawCommand = String(args.command ?? '');

        if (!rawCommand) {
            return {
                success: false,
                output: 'Error: command is required.',
            };
        }

        // Cloudstick command rewriter — intercept generic service/path names
        const rewrite = rewriteForCloudstick(rawCommand);
        if (rewrite.blocked) {
            console.warn(`[execute_ssh_command] BLOCKED non-Cloudstick command: "${rawCommand}" → ${rewrite.blocked}`);
            return {
                success: false,
                output: rewrite.blocked,
            };
        }
        if (rewrite.rewrites.length > 0) {
            console.log(`[execute_ssh_command] Cloudstick rewrite: "${rawCommand}" → "${rewrite.command}" (${rewrite.rewrites.join(', ')})`);
        }

        const commandToRun = enrichServiceRestartCommand(rewrite.command);

        try {
            const server = await resolveServerArg(args);
            console.log(`[execute_ssh_command] Running '${commandToRun}' on ${formatServerTarget(server)}`);
            const output = await sshExec(server.ip, commandToRun, {
                user: server.sshUser,
                port: server.sshPort,
            });

            return {
                success: true,
                output: output ? output : '(Command executed successfully but returned no output)'
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[execute_ssh_command] Error:`, message);
            return {
                success: false,
                output: `❌ SSH command failed: ${message}`,
            };
        }
    },
};
