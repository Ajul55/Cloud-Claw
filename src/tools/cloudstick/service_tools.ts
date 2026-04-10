/**
 * Service Control Tool — SSH-backed
 *
 * manage_service: start/stop/restart/status for system services.
 * status = Tier 1 (read-only), start/stop/restart = Tier 3 (HITL required).
 * Mutating actions run over SSH, not the Cloudstick API.
 */

import type { Tool } from '../types.js';
import { sshExec } from '../../utils/ssh.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';
import { formatServerTarget, resolveServerArg } from '../../utils/server_registry.js';

const ALLOWED_SERVICES = new Set([
    'beanstalk',
    'mariadb',
    'nginx-cs',
    'redis',
    'redis-server',
    'supervisor',
    'pure-ftpd',
    'memcached',
    'php81cs-fpm',
    'php82cs-fpm',
    'php83cs-fpm',
    'php84cs-fpm',
]);

const SERVICE_ALIASES: Record<string, string> = {
    nginx: 'nginx-cs',
    redis: 'redis-server',
    'php8.1-fpm': 'php81cs-fpm',
    'php8.2-fpm': 'php82cs-fpm',
    'php8.3-fpm': 'php83cs-fpm',
    'php8.4-fpm': 'php84cs-fpm',
    'php81-fpm': 'php81cs-fpm',
    'php82-fpm': 'php82cs-fpm',
    'php83-fpm': 'php83cs-fpm',
    'php84-fpm': 'php84cs-fpm',
};

function normalizeServiceName(service: string): string {
    const normalized = service.trim().toLowerCase();
    return SERVICE_ALIASES[normalized] ?? normalized;
}

function buildStatusCommand(service: string): string {
    return `systemctl is-active ${service} 2>&1 || true; systemctl status ${service} --no-pager -l 2>&1 | head -20`;
}

function buildMutatingCommand(service: string, action: string): string {
    if (action === 'restart' && /^php\d{2}cs-fpm$/.test(service)) {
        return `killall -9 php php-fpm php[0-9][0-9]cs-fpm 2>/dev/null || true; systemctl start ${service} 2>&1`;
    }

    return `systemctl ${action} ${service} 2>&1`;
}

export const manageServiceTool: Tool = {
    name: 'manage_service',
    description:
        'Control a named system service via SSH. ' +
        'Supports: start, stop, restart, status. ' +
        'status is read-only; start/stop/restart require HITL approval. ' +
        'All service actions are executed over SSH, not the Cloudstick API. ' +
        'IMPORTANT: On Cloudstick servers, nginx is called "nginx-cs", not "nginx". ' +
        'PHP-FPM is called "php81cs-fpm", "php82cs-fpm", etc. (not "php8.1-fpm"). ' +
        `Allowed services: ${Array.from(ALLOWED_SERVICES).join(', ')}.`,
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            host: { type: 'string', description: 'Server IP address. Optional fallback if label/ID are unavailable.' },
            service: {
                type: 'string',
                description: 'Service name',
            },
            action: {
                type: 'string',
                enum: ['start', 'stop', 'restart', 'status'],
                description: 'Action to perform',
            },
            port: {
                type: 'number',
                description: 'Unused for SSH execution. Kept for backward compatibility with older tool calls.',
            },
        },
        required: ['service', 'action'],
    },
    approvalTier: 3,
    getApprovalRequest: (args) => {
        if (args.action === 'status') return null;

        const service = normalizeServiceName(String(args.service ?? ''));

        return {
            command: encodeToolApprovalCommand('manage_service', {
                server_id: String(args.server_id ?? ''),
                server_label: String(args.server_label ?? ''),
                host: String(args.host ?? ''),
                service,
                action: String(args.action),
            }),
            targetHost: String(args.server_label ?? args.server_id ?? args.host ?? 'unknown'),
            rationale: `${String(args.action).toUpperCase()} service "${service}" via SSH.`,
        };
    },
    getRationale: (args) =>
        `This will ${args.action} the "${normalizeServiceName(String(args.service ?? ''))}" service on server ${args.server_label ?? args.server_id ?? args.host}.`,
    execute: async (args) => {
        const service = normalizeServiceName(String(args.service ?? ''));
        const action = String(args.action ?? '').trim().toLowerCase();

        if (!ALLOWED_SERVICES.has(service)) {
            return {
                success: false,
                output: `BLOCKED: Service "${service}" is not in the allowed list.\nAllowed: ${Array.from(ALLOWED_SERVICES).join(', ')}`,
            };
        }

        if (!['start', 'stop', 'restart', 'status'].includes(action)) {
            return {
                success: false,
                output: `BLOCKED: Unsupported service action "${action}". Allowed actions: start, stop, restart, status.`,
            };
        }

        try {
            const server = await resolveServerArg(args);
            const target = formatServerTarget(server);

            if (action === 'status') {
                const result = await sshExec(server.ip, buildStatusCommand(service), {
                    user: server.sshUser,
                    port: server.sshPort,
                });
                return {
                    success: true,
                    output: `Service "${service}" status on ${target}:\n${result || '(no output)'}`,
                };
            }

            const preStatus = await sshExec(server.ip, `systemctl is-active ${service} 2>&1 || true`, {
                user: server.sshUser,
                port: server.sshPort,
            });
            const actionOutput = await sshExec(server.ip, buildMutatingCommand(service, action), {
                user: server.sshUser,
                port: server.sshPort,
            });
            const postStatus = await sshExec(server.ip, `systemctl is-active ${service} 2>&1 || true`, {
                user: server.sshUser,
                port: server.sshPort,
            });
            const statusDetail = await sshExec(server.ip, `systemctl status ${service} --no-pager -l 2>&1 | head -20`, {
                user: server.sshUser,
                port: server.sshPort,
            });

            const normalizedPostStatus = postStatus.trim().toLowerCase();
            const success = action === 'stop'
                ? normalizedPostStatus !== 'active' && normalizedPostStatus !== 'activating'
                : normalizedPostStatus === 'active';

            return {
                success,
                output: [
                    `Service "${service}" ${action} on ${target}`,
                    `Pre-${action} status: ${preStatus.trim() || '(no output)'}`,
                    `Post-${action} status: ${postStatus.trim() || '(no output)'}`,
                    '',
                    `${action} output:`,
                    '```',
                    actionOutput || '(no output)',
                    '```',
                    '',
                    'Service status:',
                    '```',
                    statusDetail || '(no output)',
                    '```',
                    '',
                    success
                        ? `✅ Service "${service}" ${action} succeeded over SSH.`
                        : `❌ Service "${service}" ${action} did not reach the expected post-action state.`,
                ].join('\n'),
            };
        } catch (err) {
            return { success: false, output: `Service operation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
