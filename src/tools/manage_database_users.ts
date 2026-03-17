/**
 * Database User Management Tools — Phase 2.5 Fix 2
 *
 * Wraps the Cloudstick API for creating, deleting, and changing
 * passwords on database users. All are classified as approvalTier: 3
 * because database access control changes are highly destructive.
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { checkDatabaseUserExists } from '../api/idempotency_guard.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => env.CLOUDSTICK_USER_ID ?? '';

// ─── Create Database User ────────────────────────────────────────────────────

export const createDatabaseUserTool: Tool = {
    name: 'create_database_user',
    description: 'Create a new database user for a website on a Cloudstick-managed server. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'The Cloudstick website ID' },
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            username: { type: 'string', description: 'Database username to create' },
            password: { type: 'string', description: 'Database user password' },
        },
        required: ['website_id', 'server_id', 'username', 'password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create a new database user "${args.username}" for website ${args.website_id} on server ${args.server_label ?? args.server_id}. This grants database access.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_database_user', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            username: String(args.username),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create database user "${args.username}" — grants database access on server.`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const users = await client.listDatabaseUsers(
                String(args.website_id), String(args.server_id), userId()
            );
            return JSON.stringify(users);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);
        const username = String(args.username);
        const password = String(args.password);

        // List-before-act
        const check = await checkDatabaseUserExists(websiteId, serverId, userId(), username);
        if (check.alreadyExists) {
            return { success: true, output: `Database user "${username}" already exists. No action taken.` };
        }

        try {
            const client = getCloudstickClient();
            const result = await client.createDatabaseUser(websiteId, serverId, userId(), { username, password });
            return { success: true, output: `Database user "${username}" created successfully.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create database user: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Delete Database User ────────────────────────────────────────────────────

export const deleteDatabaseUserTool: Tool = {
    name: 'delete_database_user',
    description: 'Delete a database user from a Cloudstick-managed server. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            db_user_id: { type: 'string', description: 'The Cloudstick database user ID to delete' },
            website_id: { type: 'string', description: 'The Cloudstick website ID' },
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            username: { type: 'string', description: 'Username being deleted (for display)' },
        },
        required: ['db_user_id', 'website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will permanently delete database user "${args.username ?? args.db_user_id}" from server ${args.server_label ?? args.server_id}. Applications using this user will lose database access.`,
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const users = await client.listDatabaseUsers(
                String(args.website_id), String(args.server_id), userId()
            );
            return JSON.stringify(users);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteDatabaseUser(
                String(args.db_user_id), String(args.website_id), String(args.server_id), userId()
            );
            return { success: true, output: `Database user deleted successfully.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete database user: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Change Database User Password ───────────────────────────────────────────

export const changeDatabaseUserPasswordTool: Tool = {
    name: 'change_database_user_password',
    description: 'Change the password of an existing database user. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            db_user_id: { type: 'string', description: 'The Cloudstick database user ID' },
            website_id: { type: 'string', description: 'The Cloudstick website ID' },
            server_id: { type: 'string', description: 'The Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            username: { type: 'string', description: 'Username (for display)' },
            password: { type: 'string', description: 'The new password' },
        },
        required: ['db_user_id', 'website_id', 'server_id', 'password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will change the password for database user "${args.username ?? args.db_user_id}" on server ${args.server_label ?? args.server_id}. Applications using the old password will stop connecting.`,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.updateDatabaseUser(
                String(args.db_user_id), String(args.website_id), String(args.server_id), userId(),
                { password: String(args.password) }
            );
            return { success: true, output: `Database user password changed successfully.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to change DB user password: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
