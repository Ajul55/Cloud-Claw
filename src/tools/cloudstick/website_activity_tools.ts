import { getCloudstickClient } from '../../api/cloudstick_client.js';
import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    getEffectiveCloudstickUserId,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';

export const getWebsiteActivityLogs = {
    name: 'get_website_activity_logs',
    description:
        'Return recent Cloudstick activity logs for a website, including config changes, SSL events, and deployments when the API endpoint is available.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            limit: { type: 'number', description: 'Maximum number of log entries to return. Defaults to 50.' },
            offset: { type: 'number', description: 'Pagination offset for older log entries.' },
        },
        required: ['website'],
    },
    tier: 1 as const,
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().getWebsiteActivityLogs(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                {
                    limit: args.limit === undefined ? 50 : Number(args.limit),
                    offset: args.offset === undefined ? 0 : Number(args.offset),
                },
            );

            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    website_id: context.websiteId,
                    server: context.serverLabel,
                    activity: response,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: [
                    'Failed to get website activity logs.',
                    err instanceof Error ? err.message : String(err),
                    'No SSH fallback has been used. This tool stays API-only until the website activity endpoint is confirmed.',
                ].join('\n'),
            };
        }
    },
};

export const getWebsiteActivityLogsTool: Tool = createCloudstickTool(getWebsiteActivityLogs);
