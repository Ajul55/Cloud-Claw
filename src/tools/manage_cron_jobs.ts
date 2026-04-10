/**
 * Cron Job Management Tools — V2 Server-Level API
 *
 * Refactored from website-level V1 endpoints to server-level V2 endpoints:
 *   GET    /cron/servers/{serverId}/users/{userId}
 *   POST   /cron/servers/{serverId}/users/{userId}
 *   DELETE /cron/{cronId}/servers/{serverId}/users/{userId}
 *
 * `website_id` is no longer required or used.
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

// ─── List Cron Jobs (Read-Only) ──────────────────────────────────────────────

export const listCronJobsTool: Tool = {
    name: 'list_cron_jobs',
    description:
        'List all cron jobs configured on a Cloudstick-managed server (V2 server-level API). ' +
        'This is a read-only call. Use this before creating or deleting cron jobs to get existing IDs.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label (for context only)' },
        },
        required: ['server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.listServerCronJobs(String(args.server_id), userId());
            return { success: true, output: `Cron jobs:\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to list cron jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Create Cron Job (Tier 3) ────────────────────────────────────────────────

export const createCronJobTool: Tool = {
    name: 'create_cron_job',
    description:
        'Create a new server-level cron job via the Cloudstick V2 API. Requires HITL approval. ' +
        'Parameters: user_name (OS user), label (human name), binary (e.g. php), path (script path), schedule (cron expression).',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label (for approval card)' },
            user_name: { type: 'string', description: 'OS user that will run the cron job (e.g. "www-data", "root")' },
            label: { type: 'string', description: 'Human-readable name for this cron job (e.g. "Daily backup")' },
            binary: { type: 'string', description: 'Executable to run (e.g. "php", "bash", "/usr/bin/python3")' },
            path: { type: 'string', description: 'Path to the script or file to execute (e.g. "/home/sites/example.com/artisan")' },
            schedule: { type: 'string', description: 'Cron schedule expression (e.g. "0 * * * *" for hourly, "*/5 * * * *" for every 5 min)' },
        },
        required: ['server_id', 'user_name', 'label', 'binary', 'path', 'schedule'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Create cron job "${args.label}" — runs "${args.binary} ${args.path}" as ${args.user_name} on schedule "${args.schedule}" on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_cron_job', {
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            user_name: String(args.user_name),
            label: String(args.label),
            binary: String(args.binary),
            path: String(args.path),
            schedule: String(args.schedule),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create cron job "${args.label}": ${args.schedule} → ${args.binary} ${args.path} (as ${args.user_name}).`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const jobs = await client.listServerCronJobs(String(args.server_id), userId());
            return JSON.stringify(jobs);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createServerCronJob(
                String(args.server_id),
                userId(),
                {
                    user_name: String(args.user_name),
                    label: String(args.label),
                    binary: String(args.binary),
                    path: String(args.path),
                    schedule: String(args.schedule),
                }
            );
            return { success: true, output: `Cron job created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create cron job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Delete Cron Job (Tier 3) ────────────────────────────────────────────────

export const deleteCronJobTool: Tool = {
    name: 'delete_cron_job',
    description:
        'Delete a server-level cron job by ID via the Cloudstick V2 API. Requires HITL approval. ' +
        'Use list_cron_jobs first to get the cron job ID.',
    parameters: {
        type: 'object',
        properties: {
            cron_id: { type: 'string', description: 'The Cloudstick cron job ID to delete (get from list_cron_jobs)' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label (for approval card)' },
        },
        required: ['cron_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Delete cron job ${args.cron_id} from server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('delete_cron_job', {
            cron_id: String(args.cron_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Delete cron job ID ${args.cron_id}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteServerCronJob(
                String(args.cron_id),
                String(args.server_id),
                userId()
            );
            return { success: true, output: `Cron job deleted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete cron job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
