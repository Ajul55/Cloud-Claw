import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import { env } from '../config/env.js';

export const getServerDetailsTool: Tool = {
    name: 'get_server_details',
    description:
        'Retrieves full details for a specific Cloudstick-managed server, including ' +
        'OS version, PHP version, SSL status, hostname, timezone, and MySQL remote access status. ' +
        'Use this when the user asks about server configuration, PHP version, or server info.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (e.g. "Cloud-Claw-Test")',
            },
            server_id: {
                type: 'string',
                description: 'Numeric Cloudstick server ID (e.g. "191")',
            },
        },
        required: [],
    },
    approvalTier: 1,
    execute: async (args) => {
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
        if (!effectiveUserId) {
            return { success: false, output: 'Cloudstick user ID not configured. Run /setup first.' };
        }
        try {
            const server = await resolveServerArg(args);
            const serverId = String(args.server_id ?? server.id ?? '').trim();
            if (!serverId || serverId === '0') {
                return { success: false, output: 'Could not resolve server. Specify server_label or server_id.' };
            }
            const client = getCloudstickClient();
            const details = await client.getServerDetails(serverId, effectiveUserId);
            return {
                success: true,
                output: `Server details for ${formatServerTarget(server)}:\n${JSON.stringify(details, null, 2)}`,
            };
        } catch (err: any) {
            return { success: false, output: `Failed to get server details: ${err.message}` };
        }
    },
};
