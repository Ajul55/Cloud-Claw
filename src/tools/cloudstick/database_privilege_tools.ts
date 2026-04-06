/**
 * Database Privilege Management Tools — Cloudstick API
 *
 * Confirmed in Insomnia (server-level):
 *   GET    /database/db-user/list/servers/{s}/users/{u}        → list_database_users_server (Tier 1)
 *   PATCH  /database/grantedprivilege/servers/{s}/users/{u}    → grant_database_privilege (Tier 3)
 *   PATCH  /database/revokeprivilege/servers/{s}/users/{u}     → revoke_database_privilege (Tier 3)
 *   DELETE /database/removeuser/servers/{s}/users/{u}           → remove_user_from_database (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── List Database Users at Server Level (Tier 1) ───────────────────────────

export const listDatabaseUsersServerTool: Tool = {
    name: 'list_database_users_server',
    description:
        'List all database users and their associated databases at the server level via the Cloudstick API. ' +
        'Read-only. Use this to discover database_id and db_user_id values needed for privilege management.',
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
            const result = await client.listServerDatabaseUsers(String(args.server_id), userId());
            return {
                success: true,
                output: `Database users for server ${args.server_label ?? args.server_id}:\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to list database users: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

// ─── Grant Database Privilege (Tier 3) ──────────────────────────────────────

export const grantDatabasePrivilegeTool: Tool = {
    name: 'grant_database_privilege',
    description:
        'Grant SQL privileges to a database user on a specific database via the Cloudstick API. ' +
        'Requires HITL approval. Use list_database_users_server first to get the IDs. ' +
        'Available privileges: SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, ' +
        'CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, CREATE VIEW, SHOW VIEW, ' +
        'CREATE ROUTINE, ALTER ROUTINE, EVENT, TRIGGER, DELETE HISTORY.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            database_id: { type: 'number', description: 'Cloudstick database ID' },
            db_user_id: { type: 'number', description: 'Cloudstick database user ID' },
            privileges: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of SQL privileges to grant (e.g. ["SELECT", "INSERT", "UPDATE"])',
            },
        },
        required: ['server_id', 'database_id', 'db_user_id', 'privileges'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will grant ${(args.privileges as string[]).length} privilege(s) to db_user ${args.db_user_id} on database ${args.database_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('grant_database_privilege', {
            server_id: String(args.server_id),
            database_id: String(args.database_id),
            db_user_id: String(args.db_user_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Grant privileges: ${(args.privileges as string[]).join(', ')} to db_user ${args.db_user_id} on database ${args.database_id}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.grantDatabasePrivilege(
                String(args.server_id), userId(),
                {
                    database_id: Number(args.database_id),
                    db_user_id: Number(args.db_user_id),
                    privileges: args.privileges as string[],
                }
            );
            return { success: true, output: `Privileges granted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to grant privileges: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Revoke Database Privilege (Tier 3) ─────────────────────────────────────

export const revokeDatabasePrivilegeTool: Tool = {
    name: 'revoke_database_privilege',
    description:
        'Revoke SQL privileges from a database user on a specific database via the Cloudstick API. ' +
        'Requires HITL approval. Use list_database_users_server to check current privileges first.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            database_id: { type: 'number', description: 'Cloudstick database ID' },
            db_user_id: { type: 'number', description: 'Cloudstick database user ID' },
            privileges: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of SQL privileges to revoke',
            },
        },
        required: ['server_id', 'database_id', 'db_user_id', 'privileges'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will REVOKE ${(args.privileges as string[]).length} privilege(s) from db_user ${args.db_user_id} on database ${args.database_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('revoke_database_privilege', {
            server_id: String(args.server_id),
            database_id: String(args.database_id),
            db_user_id: String(args.db_user_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Revoke privileges: ${(args.privileges as string[]).join(', ')} from db_user ${args.db_user_id}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.revokeDatabasePrivilege(
                String(args.server_id), userId(),
                {
                    database_id: Number(args.database_id),
                    db_user_id: Number(args.db_user_id),
                    privileges: args.privileges as string[],
                }
            );
            return { success: true, output: `Privileges revoked.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to revoke privileges: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Remove User from Database (Tier 3) ─────────────────────────────────────

export const removeUserFromDatabaseTool: Tool = {
    name: 'remove_user_from_database',
    description:
        'Remove a database user from a specific database entirely via the Cloudstick API. ' +
        'Requires HITL approval. This removes all access for that user to the given database.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            database_id: { type: 'number', description: 'Cloudstick database ID' },
            db_user_id: { type: 'number', description: 'Cloudstick database user ID to remove' },
        },
        required: ['server_id', 'database_id', 'db_user_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will remove db_user ${args.db_user_id} from database ${args.database_id} on server ${args.server_label ?? args.server_id}. The user will lose all access to this database.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('remove_user_from_database', {
            server_id: String(args.server_id),
            database_id: String(args.database_id),
            db_user_id: String(args.db_user_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Remove db_user ${args.db_user_id} from database ${args.database_id}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.removeUserFromDatabase(
                String(args.server_id), userId(),
                {
                    database_id: Number(args.database_id),
                    db_user_id: Number(args.db_user_id),
                }
            );
            return { success: true, output: `Database user removed.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to remove user from database: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
