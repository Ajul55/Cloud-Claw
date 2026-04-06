import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';
import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    getEffectiveCloudstickUserId,
    normalizePluginList,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';

async function listPluginsForWebsite(website: string): Promise<{
    context: Awaited<ReturnType<typeof resolveWebsiteContext>>;
    raw: unknown;
    normalized: Array<Record<string, unknown>>;
}> {
    const context = await resolveWebsiteContext(website);
    const raw = await getCloudstickClient().listWpPlugins(
        context.websiteId,
        context.serverId,
        getEffectiveCloudstickUserId(),
    );
    return {
        context,
        raw,
        normalized: normalizePluginList(raw),
    };
}

export const listWordpressPlugins = {
    name: 'list_wordpress_plugins',
    description:
        'List installed WordPress plugins for a Cloudstick-hosted WordPress website, including activation status and version when available.',
    parameters: {
        type: 'object',
        properties: {
            website: {
                type: 'string',
                description: 'Website domain or site identifier in Cloudstick',
            },
        },
        required: ['website'],
    },
    tier: 1 as const,
    handler: async (args: Record<string, unknown>) => {
        try {
            const { context, raw, normalized } = await listPluginsForWebsite(stringify(args.website));
            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    website_id: context.websiteId,
                    server: context.serverLabel,
                    plugins: normalized.length > 0 ? normalized : raw,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to list WordPress plugins: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const manageWordpressPlugin = {
    name: 'manage_wordpress_plugin',
    description:
        'Activate, deactivate, or delete a WordPress plugin on a Cloudstick-hosted WordPress website. ' +
        'All actions require approval because even activation can break the site.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            plugin_slug: { type: 'string', description: 'WordPress plugin slug' },
            action: {
                type: 'string',
                enum: ['activate', 'deactivate', 'delete'],
                description: 'Plugin action to perform',
            },
        },
        required: ['website', 'plugin_slug', 'action'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) => {
        const warning = args.action === 'delete'
            ? ' This permanently removes the plugin and cannot be recovered without reinstalling it.'
            : '';
        return `This will ${stringify(args.action)} the WordPress plugin ${stringify(args.plugin_slug)} on ${stringify(args.website)}.${warning}`;
    },
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('manage_wordpress_plugin', {
            website: stringify(args.website),
            plugin_slug: stringify(args.plugin_slug),
            action: stringify(args.action),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale:
            `${stringify(args.action)} WordPress plugin ${stringify(args.plugin_slug)} on ${stringify(args.website)}.`
            + (args.action === 'delete'
                ? ' This is irreversible without reinstalling the plugin.'
                : ''),
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            const { normalized, raw } = await listPluginsForWebsite(stringify(args.website));
            return JSON.stringify(normalized.length > 0 ? normalized : raw);
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().managePlugins(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                stringify(args.action),
                { plugin_name: [stringify(args.plugin_slug)] },
            );

            return {
                success: true,
                output: [
                    `${stringify(args.action)} completed for plugin ${stringify(args.plugin_slug)} on ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to manage WordPress plugin: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const listWordpressPluginsTool: Tool = createCloudstickTool(listWordpressPlugins);
export const manageWordpressPluginTool: Tool = createCloudstickTool(manageWordpressPlugin);
