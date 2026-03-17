/**
 * Cron Job Management Tools — Phase 4
 *
 * Provides tools for listing and managing cron jobs on Cloudstick-managed
 * servers. List is read-only (Tier 1), create/delete are Tier 3 (HITL).
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => env.CLOUDSTICK_USER_ID ?? '';

// ─── List Cron Jobs (Read-Only) ──────────────────────────────────────────────

export const listCronJobsTool: Tool = {
    name: 'list_cron_jobs',
    description:
        'List all cron jobs configured for a website on a Cloudstick-managed server. ' +
        'This is a read-only API call (Lane 1).',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['website_id', 'server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.listCronJobs(String(args.website_id), String(args.server_id), userId());
            return { success: true, output: `Cron jobs:\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to list cron jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Create Cron Job (Tier 3) ────────────────────────────────────────────────

export const createCronJobTool: Tool = {
    name: 'create_cron_job',
    description: 'Create a new cron job for a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            command: { type: 'string', description: 'The command the cron job should execute' },
            schedule: { type: 'string', description: 'Cron schedule expression (e.g. "0 * * * *" for hourly)' },
        },
        required: ['website_id', 'server_id', 'command', 'schedule'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create a new cron job running "${args.command}" on schedule "${args.schedule}" on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_cron_job', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            cron_command: String(args.command),
            schedule: String(args.schedule),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create cron job: "${args.schedule} ${args.command}".`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const jobs = await client.listCronJobs(String(args.website_id), String(args.server_id), userId());
            return JSON.stringify(jobs);
        } catch { return '[]'; }
    },
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createCronJob(
                String(args.website_id), String(args.server_id), userId(),
                { command: String(args.command), schedule: String(args.schedule) }
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
    description: 'Delete a cron job from a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            cron_id: { type: 'string', description: 'The Cloudstick cron job ID to delete' },
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['cron_id', 'website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will delete cron job ${args.cron_id} from server ${args.server_label ?? args.server_id}.`,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteCronJob(
                String(args.cron_id), String(args.website_id), String(args.server_id), userId()
            );
            return { success: true, output: `Cron job deleted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete cron job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
