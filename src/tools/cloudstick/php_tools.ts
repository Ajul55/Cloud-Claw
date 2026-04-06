/**
 * PHP Management Tools — Cloudstick API
 *
 * - manage_php_extension: enable/disable PHP extensions (Tier 3)
 * - change_php_cli_version: change server-wide PHP CLI version (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Manage PHP Extension (Tier 3) ──────────────────────────────────────────

export const managePhpExtensionTool: Tool = {
    name: 'manage_php_extension',
    description:
        'Enable or disable a PHP extension for a specific website via the Cloudstick API. ' +
        'Supported extensions: imap, ldap, odbc, pcntl, pdo_dblib, pdo_odbc, pdo_dbc, pdo_pgsql, pdo_sqlite, pgsql. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            extension: {
                type: 'string',
                enum: ['imap', 'ldap', 'odbc', 'pcntl', 'pdo_dblib', 'pdo_odbc', 'pdo_dbc', 'pdo_pgsql', 'pdo_sqlite', 'pgsql'],
                description: 'PHP extension name',
            },
            action: {
                type: 'string',
                enum: ['enable', 'disable'],
                description: 'Whether to enable or disable the extension',
            },
        },
        required: ['website_id', 'server_id', 'extension', 'action'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will ${args.action} the PHP extension "${args.extension}" for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('manage_php_extension', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            extension: String(args.extension),
            action: String(args.action),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `${args.action === 'enable' ? 'Enable' : 'Disable'} PHP extension "${args.extension}".`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.managePhpExtension(
                String(args.website_id), String(args.server_id), userId(),
                { extension: String(args.extension), action: String(args.action) }
            );
            return {
                success: true,
                output: `PHP extension "${args.extension}" ${args.action}d successfully.\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return { success: false, output: `PHP extension operation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Change PHP CLI Version (Tier 3) ─────────────────────────────────────────

export const changePhpCliVersionTool: Tool = {
    name: 'change_php_cli_version',
    description:
        'Change the server-wide PHP CLI version via the Cloudstick API. ' +
        'Supported versions: 8.1, 8.2, 8.3, 8.4, 8.5. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            php_version: {
                type: 'string',
                enum: ['8.1', '8.2', '8.3', '8.4', '8.5'],
                description: 'Target PHP CLI version',
            },
        },
        required: ['server_id', 'php_version'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will change the server-wide PHP CLI version to ${args.php_version} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('change_php_cli_version', {
            server_id: String(args.server_id),
            php_version: String(args.php_version),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Change PHP CLI version to ${args.php_version}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.changePhpCliVersion(
                String(args.server_id), userId(),
                { php_version: String(args.php_version) }
            );
            return {
                success: true,
                output: `PHP CLI version changed to ${args.php_version}.\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return { success: false, output: `PHP CLI version change failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
