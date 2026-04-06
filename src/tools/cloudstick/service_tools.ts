/**
 * Service Control Tool — Cloudstick API
 *
 * manage_service: start/stop/restart/status for system services.
 * status = Tier 1 (read-only), start/stop/restart = Tier 3 (HITL required).
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

const ALLOWED_SERVICES = [
    'beanstalk', 'mariadb', 'nginx-cs', 'redis',
    'supervisor', 'pure-ftpd', 'memcached',
    'php81cs-fpm', 'php82cs-fpm', 'php83cs-fpm', 'php84cs-fpm',
] as const;

export const manageServiceTool: Tool = {
    name: 'manage_service',
    description:
        'Control a named system service via the Cloudstick API. ' +
        'Supports: start, stop, restart, status. ' +
        'status is read-only; start/stop/restart require HITL approval. ' +
        'IMPORTANT: On Cloudstick servers, nginx is called "nginx-cs", not "nginx". ' +
        'PHP-FPM is called "php81cs-fpm", "php82cs-fpm", etc. (not "php8.1-fpm"). ' +
        `Allowed services: ${ALLOWED_SERVICES.join(', ')}.`,
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            service: {
                type: 'string',
                enum: [...ALLOWED_SERVICES],
                description: 'Service name',
            },
            action: {
                type: 'string',
                enum: ['start', 'stop', 'restart', 'status'],
                description: 'Action to perform',
            },
            port: {
                type: 'number',
                description: 'Optional port number for the service',
            },
        },
        required: ['server_id', 'service', 'action'],
    },
    approvalTier: 3,
    getApprovalRequest: (args) => {
        if (args.action === 'status') return null; // Read-only — skip approval
        return {
            command: encodeToolApprovalCommand('manage_service', {
                server_id: String(args.server_id),
                service: String(args.service),
                action: String(args.action),
            }),
            targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
            rationale: `${String(args.action).toUpperCase()} service "${args.service}".`,
        };
    },
    getRationale: (args) =>
        `This will ${args.action} the "${args.service}" service on server ${args.server_label ?? args.server_id}.`,
    execute: async (args) => {
        const service = String(args.service ?? '').trim();
        const action = String(args.action ?? '').trim();

        if (!ALLOWED_SERVICES.includes(service as any)) {
            return {
                success: false,
                output: `BLOCKED: Service "${service}" is not in the allowed list.\nAllowed: ${ALLOWED_SERVICES.join(', ')}`,
            };
        }

        try {
            const client = getCloudstickClient();

            if (action === 'status') {
                const result = await client.getServiceStatus(String(args.server_id), userId(), service);
                return { success: true, output: `Service "${service}" status:\n${JSON.stringify(result, null, 2)}` };
            }

            const result = await client.manageService(
                String(args.server_id), userId(),
                { service, action, ...(args.port ? { port: Number(args.port) } : {}) }
            );
            return {
                success: true,
                output: `Service "${service}" ${action} completed.\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return { success: false, output: `Service operation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
