/**
 * Lane 3: Emergency Service Restart — Phase 3
 *
 * When the Cloudstick management API is unreachable because a critical
 * service (nginx, mysql, php-fpm) has crashed, this tool allows a
 * controlled SSH restart with HITL approval (Tier 3).
 *
 * This is Lane 3 — emergency SSH write, gated behind human approval.
 */

import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool } from './types.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

// Only these services can be restarted. No custom service names allowed.
const ALLOWED_SERVICES = new Set([
    'nginx', 'mysql', 'mariadb', 'php8.0-fpm', 'php8.1-fpm', 'php8.2-fpm',
    'php8.3-fpm', 'php8.4-fpm', 'apache2', 'redis-server', 'memcached',
    'supervisor', 'cron',
]);

export const emergencyRestartTool: Tool = {
    name: 'emergency_service_restart',
    description:
        'Emergency restart a critical service via SSH when the Cloudstick API is unreachable. ' +
        'Only allowed for whitelisted services (nginx, mysql, php-fpm, redis, etc.). ' +
        'Requires HITL approval. Use only as a last resort.',
    parameters: {
        type: 'object',
        properties: {
            service: { type: 'string', description: 'Service to restart (e.g. "nginx", "mysql", "php8.2-fpm")' },
            server_label: { type: 'string', description: 'Server label (e.g. "production")' },
            host: { type: 'string', description: 'Server IP address' },
        },
        required: ['service'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `⚠️ EMERGENCY: This will restart "${args.service}" on ${args.server_label ?? args.host ?? 'the server'} via SSH. ` +
        `Only use this when the Cloudstick API is unreachable due to the service being down.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('emergency_service_restart', {
            service: String(args.service),
            server_label: String(args.server_label ?? ''),
            host: String(args.host ?? ''),
        }),
        targetHost: String(args.server_label ?? args.host ?? 'unknown'),
        rationale: `⚠️ EMERGENCY: Restart "${args.service}" via SSH (Lane 3).`,
    }),
    execute: async (args) => {
        const service = String(args.service ?? '').trim().toLowerCase();

        // Strict service whitelist
        if (!ALLOWED_SERVICES.has(service)) {
            return {
                success: false,
                output: `BLOCKED: Service "${service}" is not in the emergency restart whitelist.\n`
                    + `Allowed services: ${[...ALLOWED_SERVICES].join(', ')}`,
            };
        }

        try {
            const server = await resolveServerArg(args);
            const target = formatServerTarget(server);

            // Check pre-restart status
            const preStatus = await sshExec(server.ip, `systemctl is-active ${service} 2>&1 || true`);

            // Restart
            const restartOutput = await sshExec(server.ip, `systemctl restart ${service} 2>&1`);

            // Verify post-restart status
            const postStatus = await sshExec(server.ip, `systemctl is-active ${service} 2>&1`);
            const statusDetail = await sshExec(server.ip, `systemctl status ${service} --no-pager -l 2>&1 | head -20`);

            const success = postStatus.trim() === 'active';

            return {
                success,
                output: [
                    `Emergency restart of ${service} on ${target}`,
                    `Pre-restart status: ${preStatus.trim()}`,
                    `Post-restart status: ${postStatus.trim()}`,
                    '',
                    'Restart output:',
                    '```',
                    restartOutput || '(no output)',
                    '```',
                    '',
                    'Service status:',
                    '```',
                    statusDetail,
                    '```',
                    '',
                    success
                        ? '✅ Service is now active.'
                        : '❌ Service failed to start — check the logs above.',
                ].join('\n'),
            };
        } catch (err) {
            return { success: false, output: `Emergency restart failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
