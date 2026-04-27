/**
 * Server Cron Tools — Cloudstick API
 *
 * Server-level cron job management via the Cloudstick API.
 * List is Tier 1 (read-only), create/update/delete are Tier 3 (HITL required).
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── List Server Cron Jobs (Tier 1) ──────────────────────────────────────────

const PAGE_SIZE_DEFAULT = 20;

const listServerCronJobsTool: Tool = {
    name: 'list_server_cron_jobs',
    description:
        'List server-level cron jobs on a Cloudstick server with pagination. ' +
        'Returns job IDs, labels, schedules, and commands. ' +
        'Use page/page_size to avoid context exhaustion on servers with many cron jobs.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            page: { type: 'number', description: 'Page number (1-based, default: 1)' },
            page_size: { type: 'number', description: `Jobs per page (default: ${PAGE_SIZE_DEFAULT}, max: 100)` },
        },
        required: ['server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.listServerCronJobs(String(args.server_id), userId());

            // Extract the jobs array from whatever the API returns
            let jobs: unknown[] = [];
            if (Array.isArray(result)) {
                jobs = result;
            } else if (result && typeof result === 'object') {
                const r = result as Record<string, unknown>;
                const candidate = r.cron_jobs ?? r.crons ?? r.data ?? r.message;
                if (Array.isArray(candidate)) {
                    jobs = candidate;
                }
            }

            const totalJobs = jobs.length;

            if (totalJobs === 0) {
                return { success: true, output: 'No cron jobs found on this server.' };
            }

            const page = Math.max(1, Number(args.page ?? 1));
            const pageSize = Math.min(100, Math.max(1, Number(args.page_size ?? PAGE_SIZE_DEFAULT)));
            const totalPages = Math.ceil(totalJobs / pageSize);
            const offset = (page - 1) * pageSize;
            const pageJobs = jobs.slice(offset, offset + pageSize);

            const header = `Server cron jobs (page ${page}/${totalPages}, showing ${pageJobs.length} of ${totalJobs}):`;
            return { success: true, output: `${header}\n${JSON.stringify(pageJobs, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to list server cron jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Create Server Cron Job (Tier 3) ─────────────────────────────────────────

const createServerCronJobTool: Tool = {
    name: 'create_server_cron_job',
    description:
        'Create a new server-level cron job on a Cloudstick server. ' +
        'The schedule follows standard cron syntax (e.g. "0 10 * * *" for 10 AM daily). ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            user_name: { type: 'string', description: 'System username to run the cron job as' },
            label: { type: 'string', description: 'A label/name for this cron job (e.g. "daily-server-audit")' },
            binary: { type: 'string', description: 'Path to the binary to execute (e.g. /bin/bash)' },
            path: { type: 'string', description: 'Path to the script or command to run' },
            schedule: { type: 'string', description: 'Cron schedule expression (e.g. "0 10 * * *" for 10 AM daily, "*/5 * * * *" for every 5 minutes)' },
        },
        required: ['server_id', 'user_name', 'label', 'binary', 'path', 'schedule'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Create server cron job "${args.label}" — schedule: "${args.schedule}", command: ${args.path} as ${args.user_name}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_server_cron_job', {
            server_id: String(args.server_id),
            user_name: String(args.user_name),
            label: String(args.label),
            binary: String(args.binary),
            path: String(args.path),
            schedule: String(args.schedule),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create server cron job "${args.label}" — "${args.schedule} ${args.binary} ${args.path}" as ${args.user_name}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createServerCronJob(String(args.server_id), userId(), {
                user_name: String(args.user_name),
                label: String(args.label),
                binary: String(args.binary),
                path: String(args.path),
                schedule: String(args.schedule),
            });
            return { success: true, output: `Server cron job "${args.label}" created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create server cron job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Update Server Cron Job (Tier 3) ─────────────────────────────────────────

const updateServerCronJobTool: Tool = {
    name: 'update_server_cron_job',
    description:
        'Update the schedule or label of an existing server-level cron job on a Cloudstick server. ' +
        'Use list_server_cron_jobs first to find the cron job ID. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            cron_id: { type: 'string', description: 'The Cloudstick cron job ID to update' },
            label: { type: 'string', description: 'New label for the cron job' },
            schedule: { type: 'string', description: 'New cron schedule expression (e.g. "0 10 * * *")' },
        },
        required: ['server_id', 'cron_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Update server cron job ${args.cron_id} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('update_server_cron_job', {
            server_id: String(args.server_id),
            cron_id: String(args.cron_id),
            ...(args.label !== undefined ? { label: String(args.label) } : {}),
            ...(args.schedule !== undefined ? { schedule: String(args.schedule) } : {}),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Update cron job ${args.cron_id}${args.schedule ? ` — new schedule: "${args.schedule}"` : ''}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const data: Record<string, string> = {};
            if (args.schedule !== undefined) data.schedule = String(args.schedule);
            if (args.label !== undefined) data.label = String(args.label);
            const result = await client.updateServerCronJob(String(args.cron_id), String(args.server_id), userId(), data);
            return { success: true, output: `Server cron job ${args.cron_id} updated.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to update server cron job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Delete Server Cron Job (Tier 3) ─────────────────────────────────────────

const deleteServerCronJobTool: Tool = {
    name: 'delete_server_cron_job',
    description:
        'Delete a server-level cron job from a Cloudstick server. ' +
        'Use list_server_cron_jobs first to find the cron job ID. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            cron_id: { type: 'string', description: 'The Cloudstick cron job ID to delete' },
        },
        required: ['server_id', 'cron_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `Delete server cron job ${args.cron_id} from ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('delete_server_cron_job', {
            server_id: String(args.server_id),
            cron_id: String(args.cron_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Delete server cron job ${args.cron_id}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteServerCronJob(String(args.cron_id), String(args.server_id), userId());
            return { success: true, output: `Server cron job ${args.cron_id} deleted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete server cron job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

export {
    listServerCronJobsTool,
    createServerCronJobTool,
    updateServerCronJobTool,
    deleteServerCronJobTool,
};
