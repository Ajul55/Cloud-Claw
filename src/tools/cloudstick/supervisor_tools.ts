/**
 * Supervisor Jobs Tools — Cloudstick API
 *
 * Server-level and website-level supervisor job management.
 * Read operations (list) = Tier 1, all write operations = Tier 3 (HITL required).
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Shared builder ───────────────────────────────────────────────────────────

function buildTool(definition: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    tier: 1 | 3;
    getRationale?: (args: Record<string, unknown>) => string;
    getApprovalRequest?: (args: Record<string, unknown>) => {
        command: string;
        targetHost: string;
        rationale: string;
    } | null;
    handler: (args: Record<string, unknown>) => Promise<{ success: boolean; output: string }>;
}): Tool {
    return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as Tool['parameters'],
        approvalTier: definition.tier,
        getRationale: definition.getRationale,
        getApprovalRequest: definition.getApprovalRequest,
        execute: definition.handler,
    };
}

// ─── List Server Supervisor Jobs (Tier 1) ────────────────────────────────────

const listServerSupervisorJobsTool = buildTool({
    name: 'list_server_supervisor_jobs',
    description:
        'List all supervisor jobs at the server level on a Cloudstick server. ' +
        'Returns job names, commands, status, and process counts. Use this to inspect ' +
        'what background workers are configured before creating, rebuilding, or stopping them.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['server_id'],
    },
    tier: 1,
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.listSupervisorJobs(String(args.server_id), userId());
            return { success: true, output: JSON.stringify(result, null, 2) };
        } catch (err) {
            return { success: false, output: `Failed to list server supervisor jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── List Website Supervisor Jobs (Tier 1) ───────────────────────────────────

const listWebsiteSupervisorJobsTool = buildTool({
    name: 'list_website_supervisor_jobs',
    description:
        'List all supervisor jobs for a specific website on a Cloudstick server. ' +
        'Returns job names, commands, status, and process counts. Use this to inspect ' +
        'what background workers are configured for a website before managing them.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['website', 'server_id'],
    },
    tier: 1,
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.listWebsiteSupervisorJobs(String(args.website), String(args.server_id), userId());
            return { success: true, output: JSON.stringify(result, null, 2) };
        } catch (err) {
            return { success: false, output: `Failed to list website supervisor jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Create Server Supervisor Job (Tier 3) ────────────────────────────────────

const createSupervisorJobTool = buildTool({
    name: 'create_supervisor_job',
    description:
        'Create a new server-level supervisor job on a Cloudstick server. ' +
        'Supervisor jobs keep background processes running persistently. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            job_name: { type: 'string', description: 'Unique name for the supervisor job (e.g. myqueue-worker)' },
            command: { type: 'string', description: 'Full command to run (e.g. /usr/bin/php /path/to/queue:work)' },
            username: { type: 'string', description: 'System username to run the job as' },
            num_procs: { type: 'number', description: 'Number of parallel processes to spawn. Default: 1' },
            directory: { type: 'string', description: 'Working directory for the command. Default: empty' },
            auto_start: { type: 'boolean', description: 'Auto-start the job when supervisor starts. Default: false' },
            auto_restart: { type: 'boolean', description: 'Auto-restart the job if it crashes. Default: false' },
        },
        required: ['server_id', 'job_name', 'command', 'username'],
    },
    tier: 3,
    getRationale: (args) =>
        `Create supervisor job "${args.job_name}" running "${args.command}" as ${args.username} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_supervisor_job', {
            server_id: String(args.server_id),
            job_name: String(args.job_name),
            command: String(args.command),
            username: String(args.username),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create supervisor job "${args.job_name}" running "${args.command}" as ${args.username}.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createSupervisorJob(String(args.server_id), userId(), {
                job_name: String(args.job_name),
                command: String(args.command),
                username: String(args.username),
                num_procs: args.num_procs !== undefined ? Number(args.num_procs) : 1,
                directory: args.directory !== undefined ? String(args.directory) : '',
                auto_start: args.auto_start === true,
                auto_restart: args.auto_restart === true,
            });
            return { success: true, output: `Supervisor job "${args.job_name}" created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create supervisor job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Create Website Supervisor Job (Tier 3) ──────────────────────────────────

const createWebsiteSupervisorJobTool = buildTool({
    name: 'create_website_supervisor_job',
    description:
        'Create a new website-level supervisor job on a Cloudstick server. ' +
        'Website-level jobs are associated with a specific website and run under that site\'s user. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            job_name: { type: 'string', description: 'Unique name for the supervisor job' },
            command: { type: 'string', description: 'Full command to run' },
            username: { type: 'string', description: 'System username to run the job as' },
            num_procs: { type: 'number', description: 'Number of parallel processes. Default: 1' },
            directory: { type: 'string', description: 'Working directory. Default: empty' },
            auto_start: { type: 'boolean', description: 'Auto-start on supervisor boot. Default: false' },
            auto_restart: { type: 'boolean', description: 'Auto-restart on crash. Default: false' },
        },
        required: ['website', 'server_id', 'job_name', 'command', 'username'],
    },
    tier: 3,
    getRationale: (args) =>
        `Create website supervisor job "${args.job_name}" for ${args.website} running "${args.command}".`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_website_supervisor_job', {
            website: String(args.website),
            server_id: String(args.server_id),
            job_name: String(args.job_name),
            command: String(args.command),
            username: String(args.username),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create website supervisor job "${args.job_name}" for ${args.website} running "${args.command}".`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createWebsiteSupervisorJob(
                String(args.website), String(args.server_id), userId(), {
                    job_name: String(args.job_name),
                    command: String(args.command),
                    username: String(args.username),
                    num_procs: args.num_procs !== undefined ? Number(args.num_procs) : 1,
                    directory: args.directory !== undefined ? String(args.directory) : '',
                    auto_start: args.auto_start === true,
                    auto_restart: args.auto_restart === true,
                }
            );
            return { success: true, output: `Website supervisor job "${args.job_name}" created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to create website supervisor job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Rebuild All Supervisor Jobs (Tier 3) ─────────────────────────────────────

const rebuildAllSupervisorJobsTool = buildTool({
    name: 'rebuild_all_supervisor_jobs',
    description:
        'Rebuild all server-level supervisor jobs on a Cloudstick server. ' +
        'This rereads the supervisor configuration and restarts all managed processes. ' +
        'Use this after adding or modifying job configurations. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['server_id'],
    },
    tier: 3,
    getRationale: (args) =>
        `Rebuild all server-level supervisor jobs on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('rebuild_all_supervisor_jobs', {
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Rebuild all server-level supervisor jobs — rereads config and restarts all managed processes.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.rebuildAllSupervisorJobs(String(args.server_id), userId());
            return { success: true, output: `All server-level supervisor jobs rebuilt.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to rebuild supervisor jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Rebuild Supervisor Jobs (Tier 3) ─────────────────────────────────────────

const rebuildSupervisorJobsTool = buildTool({
    name: 'rebuild_supervisor_jobs',
    description:
        'Trigger a rebuild of server-level supervisor jobs on a Cloudstick server. ' +
        'Use this to apply configuration changes made to job definitions. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['server_id'],
    },
    tier: 3,
    getRationale: (args) =>
        `Rebuild server-level supervisor jobs on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('rebuild_supervisor_jobs', {
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Rebuild server-level supervisor jobs — applies configuration changes.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.rebuildSupervisorJobs(String(args.server_id), userId());
            return { success: true, output: `Server-level supervisor jobs rebuilt.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to rebuild supervisor jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Handle Supervisor Job — start/stop (Tier 3) ─────────────────────────────

const handleSupervisorJobTool = buildTool({
    name: 'handle_supervisor_job',
    description:
        'Start or stop a named supervisor job on a Cloudstick server. ' +
        'Use list_server_supervisor_jobs first to find the exact job name. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            job_name: { type: 'string', description: 'Exact supervisor job name (e.g. myqueue-worker:myqueue-worker_1)' },
            action: { type: 'string', enum: ['start', 'stop'], description: 'Action: start or stop the job' },
        },
        required: ['server_id', 'job_name', 'action'],
    },
    tier: 3,
    getRationale: (args) =>
        `${args.action === 'start' ? 'Start' : 'Stop'} supervisor job "${args.job_name}" on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('handle_supervisor_job', {
            server_id: String(args.server_id),
            job_name: String(args.job_name),
            action: String(args.action),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `${args.action === 'start' ? 'Start' : 'Stop'} supervisor job "${args.job_name}".`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.handleSupervisorJob(String(args.server_id), userId(), {
                name: String(args.job_name),
                action: String(args.action),
            });
            return {
                success: true,
                output: `Supervisor job "${args.job_name}" ${args.action === 'start' ? 'started' : 'stopped'}.\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return { success: false, output: `Failed to ${args.action} supervisor job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Delete Server Supervisor Job (Tier 3) ────────────────────────────────────

const deleteSupervisorJobTool = buildTool({
    name: 'delete_supervisor_job',
    description:
        'Delete a server-level supervisor job from a Cloudstick server. ' +
        'The job will be stopped and removed from the supervisor configuration. ' +
        'Use list_server_supervisor_jobs first to confirm the exact job name. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            job_name: { type: 'string', description: 'Exact supervisor job name to delete' },
        },
        required: ['server_id', 'job_name'],
    },
    tier: 3,
    getRationale: (args) =>
        `Delete server-level supervisor job "${args.job_name}" from ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('delete_supervisor_job', {
            server_id: String(args.server_id),
            job_name: String(args.job_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Delete supervisor job "${args.job_name}" — this will stop and remove the job.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteSupervisorJob(String(args.job_name), String(args.server_id), userId());
            return { success: true, output: `Supervisor job "${args.job_name}" deleted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete supervisor job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Delete Website Supervisor Job (Tier 3) ───────────────────────────────────

const deleteWebsiteSupervisorJobTool = buildTool({
    name: 'delete_website_supervisor_job',
    description:
        'Delete a website-level supervisor job from a Cloudstick server. ' +
        'The job will be stopped and removed. Use list_website_supervisor_jobs first ' +
        'to confirm the exact job name. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            job_name: { type: 'string', description: 'Exact supervisor job name to delete' },
        },
        required: ['website', 'server_id', 'job_name'],
    },
    tier: 3,
    getRationale: (args) =>
        `Delete website supervisor job "${args.job_name}" for ${args.website}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('delete_website_supervisor_job', {
            website: String(args.website),
            server_id: String(args.server_id),
            job_name: String(args.job_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Delete website supervisor job "${args.job_name}" for ${args.website} — this will stop and remove the job.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteWebsiteSupervisorJob(
                String(args.job_name), String(args.website), String(args.server_id), userId()
            );
            return { success: true, output: `Website supervisor job "${args.job_name}" deleted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete website supervisor job: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Rebuild Website Supervisor Jobs (Tier 3) ─────────────────────────────────

const rebuildWebsiteSupervisorJobsTool = buildTool({
    name: 'rebuild_website_supervisor_jobs',
    description:
        'Rebuild all supervisor jobs for a specific website on a Cloudstick server. ' +
        'Use this to apply website-level job configuration changes. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['website', 'server_id'],
    },
    tier: 3,
    getRationale: (args) =>
        `Rebuild website supervisor jobs for ${args.website} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('rebuild_website_supervisor_jobs', {
            website: String(args.website),
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Rebuild website supervisor jobs for ${args.website} — applies configuration changes.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.rebuildWebsiteSupervisorJobs(
                String(args.website), String(args.server_id), userId()
            );
            return { success: true, output: `Website supervisor jobs rebuilt for ${args.website}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to rebuild website supervisor jobs: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
    listServerSupervisorJobsTool,
    listWebsiteSupervisorJobsTool,
    createSupervisorJobTool,
    createWebsiteSupervisorJobTool,
    rebuildAllSupervisorJobsTool,
    rebuildSupervisorJobsTool,
    handleSupervisorJobTool,
    deleteSupervisorJobTool,
    deleteWebsiteSupervisorJobTool,
    rebuildWebsiteSupervisorJobsTool,
};
