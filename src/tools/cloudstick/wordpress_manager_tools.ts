import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';
import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    findFirstValueByKeys,
    getEffectiveCloudstickUserId,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';

function validateWordpressUrl(raw: unknown, fieldName: string): { ok: true; value: string } | { ok: false; error: string } {
    const value = stringify(raw);
    if (!value) {
        return { ok: false, error: `${fieldName} is required.` };
    }
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { ok: false, error: `${fieldName} must be a valid URL (e.g. https://example.com).` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: `${fieldName} must use http or https.` };
    }
    // Reject credentials embedded in URL (e.g. https://user:pass@host)
    if (parsed.username || parsed.password) {
        return { ok: false, error: `${fieldName} must not contain credentials.` };
    }
    return { ok: true, value };
}


function extractCount(raw: unknown, totalKeys: string[], activeKeys: string[]): { total: unknown; active: unknown } {
    return {
        total: findFirstValueByKeys(raw, totalKeys) ?? 'Unavailable',
        active: findFirstValueByKeys(raw, activeKeys) ?? 'Unavailable',
    };
}

function coerceBoolean(value: unknown, fallback = false): boolean {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.toLowerCase() === 'true' || value === '1';
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    return Boolean(value);
}

export const getWordpressStats = {
    name: 'get_wordpress_stats',
    description:
        'Return WordPress user and plugin counts for a Cloudstick-hosted WordPress website.',
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
            const client = getCloudstickClient();
            const userId = getEffectiveCloudstickUserId();
            const [usersCountResult, pluginCountResult] = await Promise.allSettled([
                client.getWpUsersCount(context.websiteId, context.serverId, userId),
                client.getWpPluginCount(context.websiteId, context.serverId, userId),
            ]);
            const usersCountRaw = usersCountResult.status === 'fulfilled' ? usersCountResult.value : null;
            const pluginCountRaw = pluginCountResult.status === 'fulfilled' ? pluginCountResult.value : null;
            const userStats = extractCount(usersCountRaw, ['total_users', 'users_count', 'total'], ['active_users', 'active']);
            const pluginStats = extractCount(pluginCountRaw, ['total_plugins', 'plugins_count', 'total'], ['active_plugins', 'active']);

            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    website_id: context.websiteId,
                    server: context.serverLabel,
                    stats: {
                        total_users: userStats.total,
                        active_users: userStats.active,
                        total_plugins: pluginStats.total,
                        active_plugins: pluginStats.active,
                    },
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to get WordPress stats: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const changeWordpressSiteUrl = {
    name: 'change_wordpress_site_url',
    description:
        'Update the WordPress siteurl option for a Cloudstick-hosted WordPress website. ' +
        'If the new URL is wrong the site will break.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            new_site_url: { type: 'string', description: 'Full new siteurl value including protocol' },
        },
        required: ['website', 'new_site_url'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will update the WordPress siteurl for ${stringify(args.website)} to ${stringify(args.new_site_url)}. If the new URL is wrong the site will break.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('change_wordpress_site_url', {
            website: stringify(args.website),
            new_site_url: stringify(args.new_site_url),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Update WordPress siteurl for ${stringify(args.website)}. If the URL is wrong the site will break.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            return JSON.stringify(
                await getCloudstickClient().getWpUrls(context.websiteId, context.serverId, getEffectiveCloudstickUserId())
            );
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        const urlCheck = validateWordpressUrl(args.new_site_url, 'new_site_url');
        if (!urlCheck.ok) {
            return { success: false, output: urlCheck.error };
        }
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().updateWpUrls(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { site_url: urlCheck.value },
            );

            return {
                success: true,
                output: [
                    `Updated WordPress siteurl for ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to change WordPress site URL: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const changeWordpressDomainUrl = {
    name: 'change_wordpress_domain_url',
    description:
        'Update the WordPress home option for a Cloudstick-hosted WordPress website. ' +
        'If the new URL is wrong the site will break.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            new_domain_url: { type: 'string', description: 'Full new home URL including protocol' },
        },
        required: ['website', 'new_domain_url'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will update the WordPress home URL for ${stringify(args.website)} to ${stringify(args.new_domain_url)}. If the new URL is wrong the site will break.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('change_wordpress_domain_url', {
            website: stringify(args.website),
            new_domain_url: stringify(args.new_domain_url),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Update WordPress home URL for ${stringify(args.website)}. If the URL is wrong the site will break.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            return JSON.stringify(
                await getCloudstickClient().getWpUrls(context.websiteId, context.serverId, getEffectiveCloudstickUserId())
            );
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        const urlCheck = validateWordpressUrl(args.new_domain_url, 'new_domain_url');
        if (!urlCheck.ok) {
            return { success: false, output: urlCheck.error };
        }
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().updateWpUrls(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { home_url: urlCheck.value },
            );

            return {
                success: true,
                output: [
                    `Updated WordPress home URL for ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to change WordPress domain URL: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const setWordpressDebugMode = {
    name: 'set_wordpress_debug_mode',
    description:
        'Enable or disable WordPress debug mode for a Cloudstick-hosted WordPress website.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            enabled: { type: 'boolean', description: 'Whether WP_DEBUG should be enabled' },
        },
        required: ['website', 'enabled'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will ${args.enabled ? 'enable' : 'disable'} WordPress debug mode for ${stringify(args.website)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('set_wordpress_debug_mode', {
            website: stringify(args.website),
            enabled: String(Boolean(args.enabled)),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `${args.enabled ? 'Enable' : 'Disable'} WordPress debug mode for ${stringify(args.website)}.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            return JSON.stringify(
                await getCloudstickClient().getWpDebugInfo(context.websiteId, context.serverId, getEffectiveCloudstickUserId())
            );
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const current = await getCloudstickClient().getWpDebugInfo(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
            );
            const response = await getCloudstickClient().updateWpDebugInfo(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                {
                    debug_enabled: Boolean(args.enabled),
                    debug_log: coerceBoolean(findFirstValueByKeys(current, ['debug_log']), true),
                    debug_display: coerceBoolean(findFirstValueByKeys(current, ['debug_display']), true),
                    debug_log_path: stringify(findFirstValueByKeys(current, ['debug_log_path'])) || undefined,
                },
            );

            return {
                success: true,
                output: [
                    `${Boolean(args.enabled) ? 'Enabled' : 'Disabled'} WordPress debug mode for ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to set WordPress debug mode: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const setWordpressMaintenanceMode = {
    name: 'set_wordpress_maintenance_mode',
    description:
        'Turn WordPress maintenance mode on or off for a Cloudstick-hosted WordPress website.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            state: {
                type: 'string',
                enum: ['on', 'off'],
                description: 'Target maintenance mode state',
            },
        },
        required: ['website', 'state'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will turn WordPress maintenance mode ${stringify(args.state)} for ${stringify(args.website)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('set_wordpress_maintenance_mode', {
            website: stringify(args.website),
            state: stringify(args.state),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Turn WordPress maintenance mode ${stringify(args.state)} for ${stringify(args.website)}.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            return JSON.stringify(
                await getCloudstickClient().getWpMaintenanceMode(context.websiteId, context.serverId, getEffectiveCloudstickUserId())
            );
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().updateWpMaintenanceMode(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { maintanance_enabled: args.state === 'on' },
            );

            return {
                success: true,
                output: [
                    `Turned WordPress maintenance mode ${stringify(args.state)} for ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to set WordPress maintenance mode: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const setWordpressSearchLoginMode = {
    name: 'set_wordpress_search_login_mode',
    description:
        'Set the WordPress front-end access mode for a Cloudstick-hosted WordPress website.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            mode: {
                type: 'string',
                enum: ['search', 'login', 'visit'],
                description: 'Front-end access mode to apply',
            },
        },
        required: ['website', 'mode'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will set the WordPress front-end access mode for ${stringify(args.website)} to ${stringify(args.mode)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('set_wordpress_search_login_mode', {
            website: stringify(args.website),
            mode: stringify(args.mode),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Set the WordPress front-end access mode for ${stringify(args.website)} to ${stringify(args.mode)}.`,
    }),
    handler: async (args: Record<string, unknown>) => {
        const context = await resolveWebsiteContext(stringify(args.website));
        return {
            success: false,
            output: [
                `set_wordpress_search_login_mode is not yet implemented.`,
                `Requested mode: ${stringify(args.mode)} for website ${context.label}.`,
                `Cloudstick endpoint for WordPress front-end access mode (search/login/visit) needs confirmation.`,
            ].join('\n'),
        };
    },
};

export const getWordpressStatsTool: Tool = createCloudstickTool(getWordpressStats);
export const changeWordpressSiteUrlTool: Tool = createCloudstickTool(changeWordpressSiteUrl);
export const changeWordpressDomainUrlTool: Tool = createCloudstickTool(changeWordpressDomainUrl);
export const setWordpressDebugModeTool: Tool = createCloudstickTool(setWordpressDebugMode);
export const setWordpressMaintenanceModeTool: Tool = createCloudstickTool(setWordpressMaintenanceMode);
export const setWordpressSearchLoginModeTool: Tool = createCloudstickTool(setWordpressSearchLoginMode);
