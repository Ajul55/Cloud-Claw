import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import { env } from '../config/env.js';

export const manageWebsiteSettingsTool: Tool = {
    name: 'manage_website_settings',
    description:
        'Manage website settings on a Cloudstick server. ' +
        'Supports: suspend, unsuspend, rebuild, change_stack, change_php_version, ' +
        'change_php_config, change_public_path. ' +
        'Use when the user wants to suspend/unsuspend a site, rebuild it, change its stack, or modify PHP settings.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['suspend', 'unsuspend', 'rebuild', 'change_stack', 'change_php_version', 'change_php_config', 'change_public_path'],
                description: 'The action to perform',
            },
            website_id: {
                type: 'string',
                description: 'Numeric website ID (from list websites)',
            },
            server_label: {
                type: 'string',
                description: 'Target server label',
            },
            server_id: {
                type: 'string',
                description: 'Numeric Cloudstick server ID',
            },
            stack_type: {
                type: 'string',
                description: 'Stack type for change_stack (e.g. "nginx", "apache")',
            },
            php_version: {
                type: 'string',
                description: 'PHP version for change_php_version (e.g. "8.2")',
            },
            php_config: {
                type: 'object',
                description: 'PHP config object for change_php_config',
            },
            public_path: {
                type: 'string',
                description: 'New public path for change_public_path (e.g. "/public")',
            },
        },
        required: ['action', 'website_id'],
    },
    approvalTier: 3, // Write operations — require HITL approval
    execute: async (args) => {
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
        if (!effectiveUserId) {
            return { success: false, output: 'Cloudstick user ID not configured. Run /setup first.' };
        }
        const websiteId = String(args.website_id).trim();
        if (!websiteId) {
            return { success: false, output: 'website_id is required.' };
        }
        try {
            const server = await resolveServerArg(args);
            const serverId = String(args.server_id ?? server.id ?? '').trim();
            const client = getCloudstickClient();

            switch (args.action) {
                case 'suspend': {
                    const r = await client.suspendWebsite(websiteId, serverId, effectiveUserId);
                    return { success: true, output: `Website ${websiteId} suspended.\n${JSON.stringify(r, null, 2)}` };
                }
                case 'unsuspend': {
                    const r = await client.unsuspendWebsite(websiteId, serverId, effectiveUserId);
                    return { success: true, output: `Website ${websiteId} unsuspended.\n${JSON.stringify(r, null, 2)}` };
                }
                case 'rebuild': {
                    const r = await client.rebuildWebsite(websiteId, serverId, effectiveUserId);
                    return { success: true, output: `Website ${websiteId} rebuild initiated.\n${JSON.stringify(r, null, 2)}` };
                }
                case 'change_stack': {
                    if (!args.stack_type) return { success: false, output: 'stack_type is required for change_stack.' };
                    const r = await client.changeStackType(websiteId, serverId, effectiveUserId, { stack_type: args.stack_type as string });
                    return { success: true, output: `Stack changed to ${args.stack_type}.\n${JSON.stringify(r, null, 2)}` };
                }
                case 'change_php_version': {
                    if (!args.php_version) return { success: false, output: 'php_version is required for change_php_version.' };
                    const r = await client.changePhpVersion(websiteId, serverId, effectiveUserId, args.php_version as string);
                    return { success: true, output: `PHP version changed to ${args.php_version}.\n${JSON.stringify(r, null, 2)}` };
                }
                case 'change_php_config': {
                    if (!args.php_config) return { success: false, output: 'php_config is required for change_php_config.' };
                    const r = await client.changePhpConfig(websiteId, serverId, effectiveUserId, args.php_config as Record<string, unknown>);
                    return { success: true, output: `PHP config updated.\n${JSON.stringify(r, null, 2)}` };
                }
                case 'change_public_path': {
                    if (!args.public_path) return { success: false, output: 'public_path is required for change_public_path.' };
                    const r = await client.changePublicPath(websiteId, serverId, effectiveUserId, { public_path: args.public_path as string });
                    return { success: true, output: `Public path changed to ${args.public_path}.\n${JSON.stringify(r, null, 2)}` };
                }
                default:
                    return { success: false, output: `Unknown action: ${args.action}` };
            }
        } catch (err: any) {
            return { success: false, output: `Website settings operation failed: ${err.message}` };
        }
    },
};
