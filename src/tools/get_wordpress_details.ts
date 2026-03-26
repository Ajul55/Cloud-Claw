import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import { env } from '../config/env.js';

export const getWordpressDetailsTool: Tool = {
    name: 'get_wordpress_details',
    description:
        'Retrieves WordPress site details including WP version, plugin count, user count, ' +
        'site URLs, debug/maintenance mode status. Requires a website_id and server reference. ' +
        'Use when the user asks about a WordPress site — version, plugins, or WP config.',
    parameters: {
        type: 'object',
        properties: {
            website_id: {
                type: 'string',
                description: 'Numeric website ID in Cloudstick (from list websites)',
            },
            server_label: {
                type: 'string',
                description: 'Target server label',
            },
            server_id: {
                type: 'string',
                description: 'Numeric Cloudstick server ID',
            },
        },
        required: ['website_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
        if (!effectiveUserId) {
            return { success: false, output: 'Cloudstick user ID not configured. Run /setup first.' };
        }
        const websiteId = String(args.website_id).trim();
        if (!websiteId) {
            return { success: false, output: 'website_id is required. List websites first to get the ID.' };
        }
        try {
            const server = await resolveServerArg(args);
            const serverId = String(args.server_id ?? server.id ?? '').trim();
            const client = getCloudstickClient();

            // Fetch all WP info in parallel
            const [details, version, pluginCount, usersCount, urls] = await Promise.allSettled([
                client.getWordpressDetails(websiteId, serverId, effectiveUserId),
                client.getWpVersion(websiteId, serverId, effectiveUserId),
                client.getWpPluginCount(websiteId, serverId, effectiveUserId),
                client.getWpUsersCount(websiteId, serverId, effectiveUserId),
                client.getWpUrls(websiteId, serverId, effectiveUserId),
            ]);

            const result: Record<string, unknown> = {};
            if (details.status === 'fulfilled') result.details = details.value;
            if (version.status === 'fulfilled') result.wp_version = version.value;
            if (pluginCount.status === 'fulfilled') result.plugin_count = pluginCount.value;
            if (usersCount.status === 'fulfilled') result.users_count = usersCount.value;
            if (urls.status === 'fulfilled') result.urls = urls.value;

            return {
                success: true,
                output: `WordPress details for site ${websiteId} on ${formatServerTarget(server)}:\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err: any) {
            return { success: false, output: `Failed to get WordPress details: ${err.message}` };
        }
    },
};
