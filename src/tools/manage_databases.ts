/**
 * Database Management Tools — V2 Server-Level API
 *
 * Refactored to use V2 createDatabaseWithUser (creates DB + user atomically).
 * deleteDatabase is not available in V2 — users must use the Cloudstick dashboard.
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

// ─── Create Database + User (V2) ─────────────────────────────────────────────

export const createDatabaseTool: Tool = {
    name: 'create_database',
    description:
        'Create a new database and its initial user via the Cloudstick V2 API. ' +
        'The V2 API creates a database and user atomically (createDatabaseWithUser). ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            name: { type: 'string', description: 'Database name to create' },
            db_collation: { type: 'string', description: 'Database collation (optional, e.g. "utf8mb4_unicode_ci")' },
            db_user_name: { type: 'string', description: 'Username for the initial database user' },
            password: { type: 'string', description: 'Password for the initial database user' },
            privileges: {
                type: 'array',
                items: { type: 'string' },
                description: 'Privileges to grant (default: ["ALL"])',
            },
        },
        required: ['website_id', 'server_id', 'name', 'db_user_name', 'password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create database "${args.name}" with user "${args.db_user_name}" for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_database', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            name: String(args.name),
            db_user_name: String(args.db_user_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create database "${args.name}" with user "${args.db_user_name}".`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const users = await client.listServerDatabaseUsers(String(args.server_id), userId());
            return JSON.stringify(users);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);
        const dbName = String(args.name);
        const dbUserName = String(args.db_user_name);
        const password = String(args.password);
        const privileges = (args.privileges as string[] | undefined) ?? ['ALL'];

        try {
            const client = getCloudstickClient();
            const result = await client.createDatabaseWithUser(websiteId, serverId, userId(), {
                database: {
                    db_name: dbName,
                    ...(args.db_collation ? { db_collation: String(args.db_collation) } : {}),
                },
                db_user: {
                    db_user_name: dbUserName,
                    password,
                    privileges,
                },
            });
            return { success: true, output: `Database "${dbName}" created with user "${dbUserName}".\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create database: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Delete Database — Not Available in V2 ───────────────────────────────────

export const deleteDatabaseTool: Tool = {
    name: 'delete_database',
    description:
        'Attempt to delete a database. NOTE: The Cloudstick V2 API does not have a dedicated database deletion endpoint. ' +
        'Direct users to the Cloudstick dashboard for this operation.',
    parameters: {
        type: 'object',
        properties: {
            db_id: { type: 'string', description: 'The Cloudstick database ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            name: { type: 'string', description: 'Database name (for display)' },
        },
        required: ['db_id', 'server_id'],
    },
    approvalTier: 1,
    execute: async (_args) => {
        return {
            success: false,
            output:
                'Deleting databases via the Cloudstick V2 API is not supported. ' +
                'Please use the Cloudstick dashboard to delete the database: ' +
                'Dashboard → Server → Databases → select the database → Delete.',
        };
    },
};
