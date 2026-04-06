/**
 * MySQL Management Tools — Cloudstick API
 *
 * Confirmed in Insomnia:
 *   GET  /status/mysql/servers/{s}/users/{u}          → get_mysql_status (Tier 1)
 *   PATCH /mysql-password/servers/{s}/users/{u}       → update_mysql_root_password (Tier 3)
 *   PATCH /mysql-access/remote/servers/{s}/users/{u}  → toggle_mysql_remote_access (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Get MySQL Status (Tier 1) ──────────────────────────────────────────────

export const getMysqlStatusTool: Tool = {
    name: 'get_mysql_status',
    description:
        'Check the current MySQL remote access status on a Cloudstick-managed server. ' +
        'Read-only — shows whether remote database access is enabled or disabled.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.getMysqlRemoteAccessStatus(
                String(args.server_id), userId()
            );
            return {
                success: true,
                output: `MySQL remote access status for server ${args.server_label ?? args.server_id}:\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to get MySQL status: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

// ─── Update MySQL Root Password (Tier 3) ────────────────────────────────────

export const updateMysqlRootPasswordTool: Tool = {
    name: 'update_mysql_root_password',
    description:
        'Change the MySQL root password on a Cloudstick-managed server via the API. ' +
        'Requires HITL approval. The password and confirm_password must match.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            password: { type: 'string', description: 'New MySQL root password' },
            confirm_password: { type: 'string', description: 'Confirm the new MySQL root password (must match)' },
        },
        required: ['server_id', 'password', 'confirm_password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will change the MySQL root password on server ${args.server_label ?? args.server_id}. This is a critical security action.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('update_mysql_root_password', {
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Change MySQL root password on server ${args.server_label ?? args.server_id}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.updateMysqlRootPassword(
                String(args.server_id), userId(),
                {
                    password: String(args.password),
                    confirm_password: String(args.confirm_password),
                }
            );
            return { success: true, output: `MySQL root password updated.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to update MySQL root password: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Toggle MySQL Remote Access (Tier 3) ────────────────────────────────────

export const toggleMysqlRemoteAccessTool: Tool = {
    name: 'toggle_mysql_remote_access',
    description:
        'Enable or disable MySQL remote access on a Cloudstick-managed server. ' +
        'Requires HITL approval. Enabling remote access exposes MySQL to the network — use with caution.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            remote_access: { type: 'boolean', description: 'true to enable remote access, false to disable' },
        },
        required: ['server_id', 'remote_access'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will ${args.remote_access ? 'ENABLE' : 'DISABLE'} MySQL remote access on server ${args.server_label ?? args.server_id}.` +
        (args.remote_access ? ' WARNING: This exposes MySQL to the network.' : ''),
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('toggle_mysql_remote_access', {
            server_id: String(args.server_id),
            remote_access: String(args.remote_access),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `${args.remote_access ? 'Enable' : 'Disable'} MySQL remote access.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.toggleMysqlRemoteAccess(
                String(args.server_id), userId(),
                { remote_access: Boolean(args.remote_access) }
            );
            return {
                success: true,
                output: `MySQL remote access ${args.remote_access ? 'enabled' : 'disabled'}.\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to toggle MySQL remote access: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};
