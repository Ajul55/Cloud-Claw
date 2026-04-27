/**
 * System User Management Tools — Phase 2.5 Fix 2
 *
 * These tools wrap the Cloudstick API for creating, deleting, and changing
 * passwords on system users. All are classified as approvalTier: 3 (Hard HITL Gate)
 * because system-level access control changes are highly destructive.
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { checkSystemUserExists } from '../api/idempotency_guard.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

// Minimum 12 chars, at least one uppercase, one digit, one special char.
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_COMPLEXITY = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d])/;

function validatePassword(password: string): { ok: true } | { ok: false; error: string } {
    if (password.length < PASSWORD_MIN_LENGTH) {
        return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.` };
    }
    if (!PASSWORD_COMPLEXITY.test(password)) {
        return { ok: false, error: 'Password must contain at least one uppercase letter, one digit, and one special character.' };
    }
    return { ok: true };
}

// ─── Create System User ──────────────────────────────────────────────────────

export const createSystemUserTool: Tool = {
    name: 'create_system_user',
    description: 'Create a new system user on a Cloudstick-managed server. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label (e.g. "production")' },
            username: { type: 'string', description: 'The username to create' },
            password: { type: 'string', description: `The password for the new user (min ${PASSWORD_MIN_LENGTH} chars, requires uppercase, digit, special char)` },
        },
        required: ['server_id', 'username', 'password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create a new system user "${args.username}" on server ${args.server_label ?? args.server_id}. System user creation grants SSH/SFTP access.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_system_user', {
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            username: String(args.username),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create system user "${args.username}" — grants SSH/SFTP access to the server.`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const users = await client.listSystemUsers(String(args.server_id), userId());
            return JSON.stringify(users);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        const serverId = String(args.server_id);
        const username = String(args.username);
        const password = String(args.password);

        const pwCheck = validatePassword(password);
        if (!pwCheck.ok) {
            return { success: false, output: pwCheck.error };
        }

        // List-before-act idempotency check
        const check = await checkSystemUserExists(serverId, userId(), username);
        if (check.alreadyExists) {
            return { success: true, output: `System user "${username}" already exists. No action taken.` };
        }

        try {
            const client = getCloudstickClient();
            const result = await client.createSystemUser(serverId, userId(), { name: username, password });
            return { success: true, output: `System user "${username}" created successfully.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create system user: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Change System User Password ─────────────────────────────────────────────

export const changeSystemUserPasswordTool: Tool = {
    name: 'change_system_user_password',
    description: 'Change the password of an existing system user on a Cloudstick-managed server. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            sys_user_id: { type: 'string', description: 'The Cloudstick system user ID to update' },
            username: { type: 'string', description: 'Username (for display in approval card)' },
            password: { type: 'string', description: `New password (min ${PASSWORD_MIN_LENGTH} chars, requires uppercase, digit, special char)` },
        },
        required: ['server_id', 'sys_user_id', 'password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will change the password for system user "${args.username ?? args.sys_user_id}" on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('change_system_user_password', {
            server_id: String(args.server_id),
            sys_user_id: String(args.sys_user_id),
            username: String(args.username ?? ''),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Change password for system user "${args.username ?? args.sys_user_id}" on ${args.server_label ?? args.server_id}.`,
    }),
    execute: async (args) => {
        const serverId = String(args.server_id);
        const sysUserId = String(args.sys_user_id);
        const password = String(args.password);

        const pwCheck = validatePassword(password);
        if (!pwCheck.ok) {
            return { success: false, output: pwCheck.error };
        }

        try {
            const client = getCloudstickClient();
            const result = await client.updateSystemUser(sysUserId, serverId, userId(), {
                password,
                confirm_password: password,
            });
            return {
                success: true,
                output: `Password changed for system user "${args.username ?? sysUserId}".\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return { success: false, output: `Failed to change system user password: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
