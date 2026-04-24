/**
 * Website Management Tools — Cloudstick API
 * - set_maintenance_mode (Tier 3)
 * - manage_ssl (Tier 1 for status, Tier 3 for issue/renew/revoke)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Set Maintenance Mode (Tier 3) ──────────────────────────────────────────

export const setMaintenanceModeTool: Tool = {
    name: 'set_maintenance_mode',
    description:
        'Toggle maintenance mode for a website via the Cloudstick API. ' +
        'For WordPress sites, uses the WordPress manager endpoint. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            state: {
                type: 'string',
                enum: ['on', 'off'],
                description: 'Turn maintenance mode on or off',
            },
        },
        required: ['website_id', 'server_id', 'state'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will turn maintenance mode ${args.state} for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('set_maintenance_mode', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            state: String(args.state),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Turn maintenance mode ${args.state} for website ${args.website_id}.`,
    }),
    execute: async (args) => {
        const enabled = args.state === 'on';
        try {
            const client = getCloudstickClient();
            // Try WordPress manager endpoint first (toggles maintenance)
            // If that fails, fall back to generic maintenance endpoint
            try {
                const result = await client.toggleWpMaintenanceMode(
                    String(args.website_id), String(args.server_id), userId()
                );
                return {
                    success: true,
                    output: `Maintenance mode toggled (WordPress).\n${JSON.stringify(result, null, 2)}`,
                };
            } catch {
                // Not a WordPress site — try generic endpoint
                const result = await client.setMaintenanceMode(
                    String(args.website_id), String(args.server_id), userId(),
                    { enabled }
                );
                return {
                    success: true,
                    output: `Maintenance mode set to ${args.state}.\n${JSON.stringify(result, null, 2)}`,
                };
            }
        } catch (err) {
            return { success: false, output: `Maintenance mode failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Manage SSL (Tier 1 for status, Tier 3 for issue/renew/revoke) ──────────

export const manageSslTool: Tool = {
    name: 'manage_ssl',
    description:
        'Manage SSL certificate for a website via the Cloudstick API. ' +
        'Supported actions: issue, renew, revoke, status. ' +
        'status is read-only; issue/renew/revoke require HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            action: {
                type: 'string',
                enum: ['issue', 'renew', 'revoke', 'status'],
                description: 'SSL action',
            },
        },
        required: ['website_id', 'server_id', 'action'],
    },
    approvalTier: 3,
    getApprovalRequest: (args) => {
        if (args.action === 'status') return null; // Read-only
        return {
            command: encodeToolApprovalCommand('manage_ssl', {
                website_id: String(args.website_id),
                server_id: String(args.server_id),
                action: String(args.action),
            }),
            targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
            rationale: `SSL: ${String(args.action).toUpperCase()} certificate for website ${args.website_id}.`,
        };
    },
    getRationale: (args) =>
        `This will ${args.action} the SSL certificate for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);

        try {
            const client = getCloudstickClient();

            switch (args.action) {
                case 'status': {
                    // Use server details to get SSL status
                    const details = await client.getServerDetails(serverId, userId());
                    const server = (details as any)?.message;
                    return {
                        success: true,
                        output: `SSL Status:\n${JSON.stringify({
                            is_ssl_installed: server?.is_ssl_installed,
                            ssl_provider: server?.ssl_provider,
                            ssl_created_at: server?.ssl_created_at,
                            ssl_expired_at: server?.ssl_expired_at,
                        }, null, 2)}`,
                    };
                }
                case 'issue': {
                    const result = await client.issueSSL(websiteId, serverId, userId(), {
                        authorisation: 'HTTP', access: 'HTTPS', brotli_enabled: true,
                    });
                    return { success: true, output: `SSL certificate issued.\n${JSON.stringify(result, null, 2)}` };
                }
                case 'renew': {
                    const result = await client.renewFreeSSL(websiteId, serverId, userId());
                    return { success: true, output: `SSL certificate renewed.\n${JSON.stringify(result, null, 2)}` };
                }
                case 'revoke': {
                    const result = await client.revokeSSL(websiteId, serverId, userId());
                    return { success: true, output: `SSL certificate revoked.\n${JSON.stringify(result, null, 2)}` };
                }
                default:
                    return { success: false, output: `Unknown SSL action: ${args.action}` };
            }
        } catch (err) {
            return { success: false, output: `SSL operation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};


