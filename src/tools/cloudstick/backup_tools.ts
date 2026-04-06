/**
 * Backup Tools — Cloudstick API
 *
 * User-level, website-level, and database-level backup management.
 * Read operations (list) = Tier 1, all write operations = Tier 3 (HITL required).
 *
 * Backup period values: "1 HR", "2 HR", "4 HR", "6 HR", "12 HR", "24 HR", "1 WK"
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

const BACKUP_PERIODS = ['1 HR', '2 HR', '4 HR', '6 HR', '12 HR', '24 HR', '1 WK'] as const;

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

// ─── List User Backups (Tier 1) ─────────────────────────────────────────────

const listUserBackupsTool = buildTool({
    name: 'list_user_backups',
    description:
        'List all backups for the current Cloudstick user account. ' +
        'Returns a summary of all website and database backups across all servers.',
    parameters: {
        type: 'object',
        properties: {},
        required: [],
    },
    tier: 1,
    handler: async () => {
        try {
            const client = getCloudstickClient();
            const result = await client.listUserBackups(userId());
            return { success: true, output: JSON.stringify(result, null, 2) };
        } catch (err) {
            return { success: false, output: `Failed to list user backups: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── List Website Backups (Tier 1) ───────────────────────────────────────────

const listWebsiteBackupsTool = buildTool({
    name: 'list_website_backups',
    description:
        'List all backup files and their status for a specific website on a Cloudstick server. ' +
        'Returns backup file IDs, dates, and sizes. Use restore_website_backup to recover.',
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
            const result = await client.listWebsiteBackups(String(args.website), String(args.server_id), userId());
            return { success: true, output: JSON.stringify(result, null, 2) };
        } catch (err) {
            return { success: false, output: `Failed to list website backups: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── List Database Backups (Tier 1) ─────────────────────────────────────────

const listDatabaseBackupsTool = buildTool({
    name: 'list_database_backups',
    description:
        'List all backup files and their status for a specific database on a Cloudstick server. ' +
        'Returns backup file IDs, dates, and sizes. Use restore_database_backup to recover.',
    parameters: {
        type: 'object',
        properties: {
            database_id: { type: 'string', description: 'Cloudstick database ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['database_id', 'server_id'],
    },
    tier: 1,
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.listDatabaseBackups(String(args.database_id), String(args.server_id), userId());
            return { success: true, output: JSON.stringify(result, null, 2) };
        } catch (err) {
            return { success: false, output: `Failed to list database backups: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Enable Website Backup (Tier 3) ─────────────────────────────────────────

const enableWebsiteBackupTool = buildTool({
    name: 'enable_website_backup',
    description:
        'Enable or update automatic backups for a Cloudstick website. ' +
        'Set the backup period (e.g. "1 HR", "6 HR", "1 WK") and optionally ' +
        'request full backups and email notifications. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            backup_period: {
                type: 'string',
                enum: [...BACKUP_PERIODS],
                description: 'Backup frequency. Examples: "1 HR", "6 HR", "24 HR", "1 WK"',
            },
            is_full_backup: { type: 'boolean', description: 'Perform full backup (including all files). Default: true' },
            success_backup_email: { type: 'boolean', description: 'Send email on successful backup. Default: false' },
            failed_backup_email: { type: 'boolean', description: 'Send email on failed backup. Default: false' },
        },
        required: ['website', 'server_id', 'backup_period'],
    },
    tier: 3,
    getRationale: (args) =>
        `Enable ${args.backup_period} automatic backups for ${args.website} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('enable_website_backup', {
            website: String(args.website),
            server_id: String(args.server_id),
            backup_period: String(args.backup_period),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Enable ${args.backup_period} automatic backups for ${args.website}.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.enableWebsiteBackup(
                String(args.website), String(args.server_id), userId(), {
                    backup_period: String(args.backup_period),
                    is_full_backup: args.is_full_backup !== false,
                    success_backup_email: args.success_backup_email === true,
                    failed_backup_email: args.failed_backup_email === true,
                }
            );
            return { success: true, output: `Website backup enabled for ${args.website} (${args.backup_period}).\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to enable website backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Disable Website Backup (Tier 3) ─────────────────────────────────────────

const disableWebsiteBackupTool = buildTool({
    name: 'disable_website_backup',
    description:
        'Disable automatic backups for a Cloudstick website. ' +
        'Requires HITL approval.',
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
        `Disable automatic backups for ${args.website} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('disable_website_backup', {
            website: String(args.website),
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Disable automatic backups for ${args.website}.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.disableWebsiteBackup(String(args.website), String(args.server_id), userId());
            return { success: true, output: `Website backup disabled for ${args.website}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to disable website backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Enable Database Backup (Tier 3) ─────────────────────────────────────────

const enableDatabaseBackupTool = buildTool({
    name: 'enable_database_backup',
    description:
        'Enable or update automatic backups for a Cloudstick database. ' +
        'Set the backup period and email notification preferences. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            database_id: { type: 'string', description: 'Cloudstick database ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            backup_period: {
                type: 'string',
                enum: [...BACKUP_PERIODS],
                description: 'Backup frequency. Examples: "1 HR", "6 HR", "24 HR", "1 WK"',
            },
            success_backup_email: { type: 'boolean', description: 'Send email on successful backup. Default: false' },
            failed_backup_email: { type: 'boolean', description: 'Send email on failed backup. Default: false' },
        },
        required: ['database_id', 'server_id', 'backup_period'],
    },
    tier: 3,
    getRationale: (args) =>
        `Enable ${args.backup_period} automatic backups for database ${args.database_id} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('enable_database_backup', {
            database_id: String(args.database_id),
            server_id: String(args.server_id),
            backup_period: String(args.backup_period),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Enable ${args.backup_period} automatic database backups for DB ${args.database_id}.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.enableDatabaseBackup(
                String(args.database_id), String(args.server_id), userId(), {
                    backup_period: String(args.backup_period),
                    success_backup_email: args.success_backup_email === true,
                    failed_backup_email: args.failed_backup_email === true,
                }
            );
            return { success: true, output: `Database backup enabled for ${args.database_id} (${args.backup_period}).\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to enable database backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Disable Database Backup (Tier 3) ────────────────────────────────────────

const disableDatabaseBackupTool = buildTool({
    name: 'disable_database_backup',
    description:
        'Disable automatic backups for a Cloudstick database. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            database_id: { type: 'string', description: 'Cloudstick database ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['database_id', 'server_id'],
    },
    tier: 3,
    getRationale: (args) =>
        `Disable automatic backups for database ${args.database_id} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('disable_database_backup', {
            database_id: String(args.database_id),
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Disable automatic database backups for DB ${args.database_id}.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.disableDatabaseBackup(String(args.database_id), String(args.server_id), userId());
            return { success: true, output: `Database backup disabled for ${args.database_id}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to disable database backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Create Manual Website Backup (Tier 3) ────────────────────────────────────

const createManualWebsiteBackupTool = buildTool({
    name: 'create_manual_website_backup',
    description:
        'Trigger an immediate manual backup for a Cloudstick website. ' +
        'The backup runs in the background and may take several minutes depending on site size. ' +
        'Requires HITL approval.',
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
        `Trigger immediate manual backup for ${args.website} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_manual_website_backup', {
            website: String(args.website),
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Trigger immediate manual backup for ${args.website}.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createManualWebsiteBackup(String(args.website), String(args.server_id), userId());
            return { success: true, output: `Manual website backup triggered for ${args.website}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to trigger manual website backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Create Manual Database Backup (Tier 3) ───────────────────────────────────

const createManualDatabaseBackupTool = buildTool({
    name: 'create_manual_database_backup',
    description:
        'Trigger an immediate manual backup for a Cloudstick database. ' +
        'The backup runs in the background. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            database_id: { type: 'string', description: 'Cloudstick database ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
        },
        required: ['database_id', 'server_id'],
    },
    tier: 3,
    getRationale: (args) =>
        `Trigger immediate manual backup for database ${args.database_id} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_manual_database_backup', {
            database_id: String(args.database_id),
            server_id: String(args.server_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Trigger immediate manual backup for database ${args.database_id}.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createManualDatabaseBackup(String(args.database_id), String(args.server_id), userId());
            return { success: true, output: `Manual database backup triggered for ${args.database_id}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to trigger manual database backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Restore Website Backup (Tier 3) ─────────────────────────────────────────

const restoreWebsiteBackupTool = buildTool({
    name: 'restore_website_backup',
    description:
        'Restore a website from an existing backup file. ' +
        'Use list_website_backups first to find the correct backup file_id. ' +
        'This will overwrite the current website files with the backup. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            file_id: { type: 'string', description: 'Backup file ID to restore (from list_website_backups)' },
        },
        required: ['website', 'server_id', 'file_id'],
    },
    tier: 3,
    getRationale: (args) =>
        `Restore website ${args.website} from backup file ${args.file_id} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('restore_website_backup', {
            website: String(args.website),
            server_id: String(args.server_id),
            file_id: String(args.file_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `RESTORE website ${args.website} from backup file ${args.file_id}. This will overwrite current files.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.restoreWebsiteBackup(
                String(args.file_id), String(args.website), String(args.server_id), userId()
            );
            return { success: true, output: `Website ${args.website} restore initiated from backup ${args.file_id}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to restore website backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Restore Database Backup (Tier 3) ───────────────────────────────────────

const restoreDatabaseBackupTool = buildTool({
    name: 'restore_database_backup',
    description:
        'Restore a database from an existing backup file. ' +
        'Use list_database_backups first to find the correct backup file_id. ' +
        'This will overwrite the current database with the backup. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            database_id: { type: 'string', description: 'Cloudstick database ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            file_id: { type: 'string', description: 'Backup file ID to restore (from list_database_backups)' },
        },
        required: ['database_id', 'server_id', 'file_id'],
    },
    tier: 3,
    getRationale: (args) =>
        `Restore database ${args.database_id} from backup file ${args.file_id} on ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('restore_database_backup', {
            database_id: String(args.database_id),
            server_id: String(args.server_id),
            file_id: String(args.file_id),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `RESTORE database ${args.database_id} from backup file ${args.file_id}. This will overwrite current data.`,
    }),
    handler: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.restoreDatabaseBackup(
                String(args.file_id), String(args.database_id), String(args.server_id), userId()
            );
            return { success: true, output: `Database ${args.database_id} restore initiated from backup ${args.file_id}.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to restore database backup: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
});

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
    listUserBackupsTool,
    listWebsiteBackupsTool,
    listDatabaseBackupsTool,
    enableWebsiteBackupTool,
    disableWebsiteBackupTool,
    enableDatabaseBackupTool,
    disableDatabaseBackupTool,
    createManualWebsiteBackupTool,
    createManualDatabaseBackupTool,
    restoreWebsiteBackupTool,
    restoreDatabaseBackupTool,
};
