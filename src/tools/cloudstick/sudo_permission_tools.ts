/**
 * System User Sudo Permission Tool — Cloudstick API
 *
 * Confirmed in Insomnia:
 *   PATCH /sudo-permission/systemuser/{sysUserId}/servers/{s}/users/{u}
 *   Body: { "sudo_permission": true/false }
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

export const updateSudoPermissionTool: Tool = {
    name: 'update_sudo_permission',
    description:
        'Enable or disable sudo permission for a system user on a Cloudstick-managed server. ' +
        'Requires HITL approval. Granting sudo gives full root access — use with extreme caution. ' +
        'Use list_system_users or discovery_agent to find the system user ID first.',
    parameters: {
        type: 'object',
        properties: {
            sys_user_id: { type: 'string', description: 'Cloudstick system user ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            sudo_permission: { type: 'boolean', description: 'true to grant sudo, false to revoke' },
        },
        required: ['sys_user_id', 'server_id', 'sudo_permission'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will ${args.sudo_permission ? 'GRANT' : 'REVOKE'} sudo permission for system user ${args.sys_user_id} on server ${args.server_label ?? args.server_id}.` +
        (args.sudo_permission ? ' WARNING: Sudo grants full root access to the server.' : ''),
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('update_sudo_permission', {
            sys_user_id: String(args.sys_user_id),
            server_id: String(args.server_id),
            sudo_permission: String(args.sudo_permission),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `${args.sudo_permission ? 'Grant' : 'Revoke'} sudo for system user ${args.sys_user_id}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.updateSudoPermission(
                String(args.sys_user_id),
                String(args.server_id),
                userId(),
                { sudo_permission: Boolean(args.sudo_permission) },
            );
            return {
                success: true,
                output: `Sudo permission ${args.sudo_permission ? 'granted' : 'revoked'} for system user ${args.sys_user_id}.\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to update sudo permission: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};
