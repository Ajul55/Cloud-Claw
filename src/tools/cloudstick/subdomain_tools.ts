/**
 * Website Subdomain Listing Tool — Cloudstick API
 *
 * Confirmed in Insomnia:
 *   GET /list/website-subdomain/websites/{w}/servers/{s}/users/{u}
 */

import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    getEffectiveCloudstickUserId,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';

export const listWebsiteSubdomains = {
    name: 'list_website_subdomains',
    description:
        'List all subdomains configured for a website on a Cloudstick-managed server. ' +
        'Read-only. Use this to see what subdomains exist before creating or modifying them.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
        },
        required: ['website'],
    },
    tier: 1 as const,
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const result = await getCloudstickClient().listWebsiteSubdomains(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
            );
            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    server: context.serverLabel,
                    subdomains: result,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to list subdomains: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const listWebsiteSubdomainsTool: Tool = createCloudstickTool(listWebsiteSubdomains);
