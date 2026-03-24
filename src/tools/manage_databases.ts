/**
 * Database Management Tools — Phase 3 (Lane 1: Cloudstick API)
 *
 * Create and delete databases via the Cloudstick API.
 * Both operations are approvalTier: 3 (HITL).
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

// ─── Create Database (Tier 3) ────────────────────────────────────────────────

export const createDatabaseTool: Tool = {
    name: 'create_database',
    description: 'Create a new database for a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            name: { type: 'string', description: 'Database name to create' },
        },
        required: ['website_id', 'server_id', 'name'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create a new database "${args.name}" for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_database', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            name: String(args.name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create database "${args.name}".`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const dbs = await client.listDatabases(String(args.website_id), String(args.server_id), userId());
            return JSON.stringify(dbs);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);
        const dbName = String(args.name);

        // List-before-act: check if DB already exists
        try {
            const client = getCloudstickClient();
            const existing: any = await client.listDatabases(websiteId, serverId, userId());
            const found = (existing?.data ?? existing ?? []).find(
                (db: any) => db.name?.toLowerCase() === dbName.toLowerCase()
            );
            if (found) {
                return { success: true, output: `Database "${dbName}" already exists. No action taken.\n${JSON.stringify(found, null, 2)}` };
            }
        } catch { /* proceed anyway */ }

        try {
            const client = getCloudstickClient();
            const result = await client.createDatabase(websiteId, serverId, userId(), { name: dbName });
            return { success: true, output: `Database "${dbName}" created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create database: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Delete Database (Tier 3) ────────────────────────────────────────────────

export const deleteDatabaseTool: Tool = {
    name: 'delete_database',
    description: 'Delete a database via the Cloudstick API. This is DESTRUCTIVE and permanent. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            db_id: { type: 'string', description: 'The Cloudstick database ID to delete' },
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            name: { type: 'string', description: 'Database name (for display)' },
        },
        required: ['db_id', 'website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will PERMANENTLY DELETE database "${args.name ?? args.db_id}" from server ${args.server_label ?? args.server_id}. All data will be lost.`,
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const dbs = await client.listDatabases(String(args.website_id), String(args.server_id), userId());
            return JSON.stringify(dbs);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteDatabase(
                String(args.db_id), String(args.website_id), String(args.server_id), userId()
            );
            return { success: true, output: `Database deleted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete database: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
