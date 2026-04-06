import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';
import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    findFirstValueByKeys,
    getEffectiveCloudstickUserId,
    loadWebsiteDetailCandidates,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';

type SecuritySettingField = {
    arg: string;
    apiKey: string;
    readKeys: string[];
    confirmed: boolean;
};

const SECURITY_SETTINGS: SecuritySettingField[] = [
    {
        arg: 'clickjacking_protection',
        apiKey: 'cj_protection',
        readKeys: ['cj_protection', 'clickjacking_protection', 'x_frame_options'],
        confirmed: true,
    },
    {
        arg: 'xss_filter',
        apiKey: 'xss_protection',
        readKeys: ['xss_protection', 'xss_filter'],
        confirmed: true,
    },
    {
        arg: 'mime_sniffing_protection',
        apiKey: 'ms_protection',
        readKeys: ['ms_protection', 'mime_sniffing_protection', 'mime_sniffing'],
        confirmed: true,
    },
    {
        arg: 'permission_policy',
        apiKey: 'permissions_policy',
        readKeys: ['permissions_policy', 'permission_policy'],
        confirmed: true,
    },
    {
        arg: 'content_security_policy',
        apiKey: 'content_security_policy',
        readKeys: ['content_security_policy'],
        confirmed: true,
    },
    {
        arg: 'referrer_policy',
        apiKey: 'referrer_policy',
        readKeys: ['referrer_policy'],
        confirmed: true,
    },
    {
        arg: 'cross_origin_opener_policy',
        apiKey: 'cross_origin_opener_policy',
        readKeys: ['cross_origin_opener_policy'],
        confirmed: false,
    },
];

function buildSecuritySnapshot(candidates: unknown[]): Record<string, unknown> {
    return Object.fromEntries(SECURITY_SETTINGS.map((setting) => [
        setting.arg,
        coerceBoolean(findFirstValueByKeys(candidates, setting.readKeys)),
    ]));
}

function buildSecurityPayload(args: Record<string, unknown>): {
    payload: Record<string, boolean>;
    changedSettings: Record<string, boolean>;
    unconfirmedMappings: string[];
} {
    const payload: Record<string, boolean> = {};
    const changedSettings: Record<string, boolean> = {};
    const unconfirmedMappings: string[] = [];

    for (const setting of SECURITY_SETTINGS) {
        if (!Object.prototype.hasOwnProperty.call(args, setting.arg) || args[setting.arg] === undefined) {
            continue;
        }
        const value = coerceBoolean(args[setting.arg]);
        payload[setting.apiKey] = value;
        changedSettings[setting.arg] = value;
        if (!setting.confirmed) {
            unconfirmedMappings.push(`${setting.arg} -> ${setting.apiKey}`);
        }
    }

    return { payload, changedSettings, unconfirmedMappings };
}

async function getSecuritySnapshotForWebsite(website: string): Promise<Record<string, unknown>> {
    const context = await resolveWebsiteContext(website);
    const userId = getEffectiveCloudstickUserId();
    const client = getCloudstickClient();

    // Security header toggles are stored in the website record from listWebsitesByServer.
    let websiteRecord: unknown = {};
    try {
        const response = await client.listWebsitesByServer(context.serverId, userId) as any;
        const websites: unknown[] = response?.message?.Websites ?? response?.data ?? [];
        websiteRecord = websites.find((w: any) => String(w.id) === String(context.websiteId)) ?? {};
    } catch {
        websiteRecord = {};
    }

    // Supplement with app-type detail candidates (WordPress/CustomPHP/Laravel may also return headers)
    const candidates = [websiteRecord, ...(await loadWebsiteDetailCandidates(context))];
    return buildSecuritySnapshot(candidates);
}

export const getNginxSecuritySettings = {
    name: 'get_nginx_security_settings',
    description:
        'Return the current per-website NGINX security header toggle state for a Cloudstick website.',
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
            const context = await resolveWebsiteContext(stringify(args.website));
            const candidates = await loadWebsiteDetailCandidates(context);
            const settings = buildSecuritySnapshot(candidates);

            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    website_id: context.websiteId,
                    server: context.serverLabel,
                    settings,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to get NGINX security settings: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const updateNginxSecuritySettings = {
    name: 'update_nginx_security_settings',
    description:
        'Update one or more per-website NGINX security header toggles for a Cloudstick website. Only provided fields are changed.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            clickjacking_protection: { type: 'boolean', description: 'Toggle X-Frame-Options' },
            xss_filter: { type: 'boolean', description: 'Toggle X-XSS-Protection' },
            mime_sniffing_protection: { type: 'boolean', description: 'Toggle X-Content-Type-Options' },
            permission_policy: { type: 'boolean', description: 'Toggle Permissions-Policy' },
            content_security_policy: { type: 'boolean', description: 'Toggle Content-Security-Policy' },
            referrer_policy: { type: 'boolean', description: 'Toggle Referrer-Policy' },
            cross_origin_opener_policy: { type: 'boolean', description: 'Toggle Cross-Origin-Opener-Policy (COOP) header' },
        },
        required: ['website'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will update NGINX security header settings for ${stringify(args.website)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => {
        const { changedSettings } = buildSecurityPayload(args);
        return {
            command: encodeToolApprovalCommand('update_nginx_security_settings', {
                website: stringify(args.website),
                changes: JSON.stringify(changedSettings),
            }),
            targetHost: stringify(args.website) || 'website',
            rationale: `Update NGINX security headers for ${stringify(args.website)}.`,
        };
    },
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getSecuritySnapshotForWebsite(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const { payload, changedSettings, unconfirmedMappings } = buildSecurityPayload(args);

            if (Object.keys(payload).length === 0) {
                return { success: false, output: 'No NGINX security settings were provided to update.' };
            }

            const response = await getCloudstickClient().applySecurityHeaders(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                payload,
            );

            return {
                success: true,
                output: [
                    `Updated NGINX security settings for ${context.label}.`,
                    `Changed settings: ${toPrettyJson(changedSettings)}`,
                    ...(unconfirmedMappings.length > 0 ? [
                        'Note: the following mapping is best-effort and should be verified against the Cloudstick API if the request fails:',
                        ...unconfirmedMappings,
                    ] : []),
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to update NGINX security settings: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

function toBoolean(value: unknown): boolean | 'Unavailable' {
    if (value === undefined || value === null || value === '') {
        return 'Unavailable';
    }
    return coerceBoolean(value);
}

function coerceBoolean(value: unknown): boolean {
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

export const getNginxSecuritySettingsTool: Tool = createCloudstickTool(getNginxSecuritySettings);
export const updateNginxSecuritySettingsTool: Tool = createCloudstickTool(updateNginxSecuritySettings);
