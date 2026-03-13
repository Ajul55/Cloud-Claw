import { env } from '../config/env.js';
import type { Tool, ToolResult } from './types.js';

function normalizeUrls(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((entry) => String(entry).trim()).filter(Boolean);
            }
        } catch {
            // fall through
        }

        return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
    }

    return [];
}

export const cloudflareCachePurgeTool: Tool = {
    name: 'cloudflare_cache_purge',
    description: 'Purge Cloudflare cache for a specific URL or the entire zone. Use after diagnose_domain detects a cache mismatch.',
    approvalTier: 3,
    getRationale: (args: Record<string, unknown>) => {
        const mode = String(args.mode ?? 'url');
        if (mode === 'everything') {
            return `This action will purge the entire Cloudflare cache for ${env.CLOUDFLARE_DOMAIN ?? 'the configured zone'}.`;
        }

        const urls = normalizeUrls(args.urls);
        return `This action will purge Cloudflare cache for: ${urls.join(', ') || 'the requested URLs'}.`;
    },
    parameters: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['url', 'everything'],
                description: 'Whether to purge specific URLs or the entire zone.',
            },
            urls: {
                type: 'array',
                description: 'Required when mode=url. Example: ["https://pro.ajul.site", "https://pro.ajul.site/"]',
                items: { type: 'string' },
            },
        },
        required: ['mode'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const apiToken = env.CLOUDFLARE_API_TOKEN;
        const zoneId = env.CLOUDFLARE_ZONE_ID;
        const domain = env.CLOUDFLARE_DOMAIN;
        const mode = String(args.mode ?? 'url');
        const urls = normalizeUrls(args.urls);

        if (!apiToken || !zoneId) {
            return {
                success: false,
                output: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not configured in .env',
            };
        }

        if (mode !== 'everything' && urls.length === 0) {
            return {
                success: false,
                output: 'urls is required when mode is "url"',
            };
        }

        try {
            const body = mode === 'everything'
                ? { purge_everything: true }
                : { files: urls };

            const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            const data = await response.json() as { success?: boolean; errors?: unknown };

            if (!response.ok || !data.success) {
                return {
                    success: false,
                    output: `Cloudflare API error: ${JSON.stringify(data.errors ?? data)}`,
                };
            }

            return {
                success: true,
                output: mode === 'everything'
                    ? `Cloudflare cache purged for entire zone ${domain ?? zoneId}`
                    : `Cloudflare cache purged for: ${urls.join(', ')}`,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: `Cloudflare purge failed: ${message}`,
            };
        }
    },
};
