/**
 * Server Settings Tools — Cloudstick API
 *
 * - configure_timezone (Tier 3)
 * - cleanup_server (Tier 3)
 * - get_hostname (Tier 1 — read-only)
 * - run_auto_update (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Configure Timezone (Tier 3) ────────────────────────────────────────────

export const configureTimezoneTool: Tool = {
    name: 'configure_timezone',
    description:
        'Update the server timezone via the Cloudstick API. ' +
        'Use an IANA timezone string (e.g. "Asia/Kolkata", "UTC", "America/New_York"). ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            timezone: { type: 'string', description: 'IANA timezone (e.g. "Asia/Kolkata")' },
        },
        required: ['server_id', 'timezone'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will change the server timezone to "${args.timezone}" on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('configure_timezone', {
            server_id: String(args.server_id),
            timezone: String(args.timezone),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Change server timezone to "${args.timezone}".`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.configureTimezone(
                String(args.server_id), userId(),
                { timezone: String(args.timezone) }
            );
            return { success: true, output: `Timezone updated to "${args.timezone}".\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Timezone configuration failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Cleanup Server (Tier 3) ────────────────────────────────────────────────

export const cleanupServerTool: Tool = {
    name: 'cleanup_server',
    description:
        'Run a cleanup operation on the server for a specified target via the Cloudstick API. ' +
        'Targets: all_logs, app_cache, journal. Optional log_retention_period (e.g. "7d", "30d"). ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            target: {
                type: 'string',
                enum: ['all_logs', 'app_cache', 'journal'],
                description: 'Cleanup target',
            },
            log_retention_period: {
                type: 'string',
                description: 'Log retention period (e.g. "7d", "30d"). Optional.',
            },
        },
        required: ['server_id', 'target'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will run a ${args.target} cleanup on server ${args.server_label ?? args.server_id}.` +
        (args.log_retention_period ? ` Log retention: ${args.log_retention_period}.` : ''),
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('cleanup_server', {
            server_id: String(args.server_id),
            target: String(args.target),
            ...(args.log_retention_period ? { log_retention_period: String(args.log_retention_period) } : {}),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Cleanup: ${args.target}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.cleanupServer(
                String(args.server_id), userId(),
                {
                    target: String(args.target),
                    ...(args.log_retention_period ? { log_retention_period: String(args.log_retention_period) } : {}),
                }
            );
            return { success: true, output: `Server cleanup (${args.target}) completed.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Server cleanup failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Get Hostname (Tier 1) ──────────────────────────────────────────────────

export const getHostnameTool: Tool = {
    name: 'get_hostname',
    description: 'Returns the current server hostname via the Cloudstick API. Read-only.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
        },
        required: ['server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.getHostname(String(args.server_id), userId());
            return { success: true, output: `Server hostname:\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to get hostname: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Run Auto Update (Tier 3) ───────────────────────────────────────────────

export const runAutoUpdateTool: Tool = {
    name: 'run_auto_update',
    description:
        'Trigger the Cloudstick auto-update routine via the API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will trigger the Cloudstick auto-update on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('run_auto_update', {
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: 'Trigger Cloudstick auto-update.',
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.runAutoUpdate(String(args.server_id), userId());
            return { success: true, output: `Auto-update triggered.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Auto-update failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
