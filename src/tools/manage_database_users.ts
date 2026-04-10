/**
 * Database User Management Tools — V2 Server-Level API
 *
 * Refactored from website-level V1 legacy endpoints to V2 server-level endpoints.
 * - createDatabaseUserTool  → createDatabaseWithUser (creates DB + initial user together)
 * - deleteDatabaseUserTool  → removeUserFromDatabase (server-level, no website_id)
 * - changeDatabaseUserPasswordTool → not available in V2; returns informative error
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { checkDatabaseUserExists } from '../api/idempotency_guard.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

// ─── Create Database + User (V2) ─────────────────────────────────────────────

export const createDatabaseUserTool: Tool = {
    name: 'create_database_user',
    description:
        'Create a new database and its initial user via the Cloudstick V2 API. ' +
        'The V2 API always creates a database and user together (createDatabaseWithUser). ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'The Cloudstick website ID' },
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            db_name: { type: 'string', description: 'Database name to create' },
            db_collation: { type: 'string', description: 'Database collation (optional, e.g. "utf8mb4_unicode_ci")' },
            username: { type: 'string', description: 'Database username to create' },
            password: { type: 'string', description: 'Database user password' },
            privileges: {
                type: 'array',
                items: { type: 'string' },
                description: 'Privileges to grant (default: ["ALL"])',
            },
        },
        required: ['website_id', 'server_id', 'db_name', 'username', 'password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create database "${args.db_name}" with user "${args.username}" for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_database_user', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            db_name: String(args.db_name),
            username: String(args.username),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create database "${args.db_name}" with user "${args.username}" on server.`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const users = await client.listServerDatabaseUsers(String(args.server_id), userId());
            return JSON.stringify(users);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        const serverId = String(args.server_id);
        const websiteId = String(args.website_id);
        const username = String(args.username);
        const password = String(args.password);
        const dbName = String(args.db_name);
        const privileges = (args.privileges as string[] | undefined) ?? ['ALL'];

        // List-before-act
        const check = await checkDatabaseUserExists(serverId, userId(), username);
        if (check.alreadyExists) {
            return { success: true, output: `Database user "${username}" already exists. No action taken.` };
        }

        try {
            const client = getCloudstickClient();
            const result = await client.createDatabaseWithUser(websiteId, serverId, userId(), {
                database: {
                    db_name: dbName,
                    ...(args.db_collation ? { db_collation: String(args.db_collation) } : {}),
                },
                db_user: {
                    db_user_name: username,
                    password,
                    privileges,
                },
            });
            return { success: true, output: `Database "${dbName}" with user "${username}" created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create database user: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Delete Database User (V2) ───────────────────────────────────────────────

export const deleteDatabaseUserTool: Tool = {
    name: 'delete_database_user',
    description:
        'Remove a database user from a database via the Cloudstick V2 server-level API. ' +
        'Requires database_id and db_user_id (get them from list_server_database_users). ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            db_user_id: { type: 'number', description: 'The Cloudstick database user ID to remove' },
            database_id: { type: 'number', description: 'The Cloudstick database ID to remove the user from' },
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            username: { type: 'string', description: 'Username being removed (for display)' },
        },
        required: ['db_user_id', 'database_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will remove database user "${args.username ?? args.db_user_id}" from database ${args.database_id} on server ${args.server_label ?? args.server_id}. Applications using this user will lose database access.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('delete_database_user', {
            db_user_id: String(args.db_user_id),
            database_id: String(args.database_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            username: String(args.username ?? ''),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Remove database user "${args.username ?? args.db_user_id}" from database ${args.database_id}. Applications using this user will lose access.`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const users = await client.listServerDatabaseUsers(String(args.server_id), userId());
            return JSON.stringify(users);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.removeUserFromDatabase(String(args.server_id), userId(), {
                database_id: Number(args.database_id),
                db_user_id: Number(args.db_user_id),
            });
            return { success: true, output: `Database user removed.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to remove database user: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Change Database User Password — Not Available in V2 ─────────────────────

export const changeDatabaseUserPasswordTool: Tool = {
    name: 'change_database_user_password',
    description:
        'Attempt to change the password of a database user. ' +
        'NOTE: The Cloudstick V2 API does not have a dedicated endpoint for changing database user passwords. ' +
        'This operation must be performed via the Cloudstick dashboard or directly on the server.',
    parameters: {
        type: 'object',
        properties: {
            db_user_id: { type: 'string', description: 'The Cloudstick database user ID' },
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            username: { type: 'string', description: 'Username (for display)' },
            password: { type: 'string', description: 'The new password' },
        },
        required: ['db_user_id', 'server_id', 'password'],
    },
    approvalTier: 1,
    execute: async (_args) => {
        return {
            success: false,
            output:
                'Changing database user passwords via the Cloudstick V2 API is not supported. ' +
                'Please use the Cloudstick dashboard to update the password, or connect directly to MySQL ' +
                'on the server and run: ALTER USER \'username\'@\'localhost\' IDENTIFIED BY \'newpassword\';',
        };
    },
};
