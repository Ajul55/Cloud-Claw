/**
 * Security Headers Tool — Cloudstick API
 *
 * Confirmed in Insomnia:
 *   PATCH /changesecurity/websites/{w}/servers/{s}/users/{u}
 *   Body: { cj_protection, xss_protection, ms_protection, permissions_policy,
 *           content_security_policy, referrer_policy, cross_origin_opener_policy }
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
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

export const applySecurityHeaders = {
    name: 'apply_security_headers',
    description:
        'Enable or disable browser security headers for a website via the Cloudstick API. ' +
        'Requires HITL approval. Controls: Clickjacking (X-Frame-Options), XSS Protection, ' +
        'MIME Sniffing Protection, Permissions Policy, Content Security Policy, Referrer Policy, ' +
        'and Cross-Origin Opener Policy.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            cj_protection: { type: 'boolean', description: 'Enable Clickjacking / X-Frame-Options protection' },
            xss_protection: { type: 'boolean', description: 'Enable X-XSS-Protection header' },
            ms_protection: { type: 'boolean', description: 'Enable MIME Sniffing / X-Content-Type-Options protection' },
            permissions_policy: { type: 'boolean', description: 'Enable Permissions-Policy header' },
            content_security_policy: { type: 'boolean', description: 'Enable Content-Security-Policy header' },
            referrer_policy: { type: 'boolean', description: 'Enable Referrer-Policy header' },
            cross_origin_opener_policy: { type: 'boolean', description: 'Enable Cross-Origin-Opener-Policy header' },
        },
        required: ['website'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) => {
        const enabled: string[] = [];
        const disabled: string[] = [];
        for (const key of ['cj_protection', 'xss_protection', 'ms_protection', 'permissions_policy', 'content_security_policy', 'referrer_policy', 'cross_origin_opener_policy']) {
            if (args[key] !== undefined) {
                (args[key] ? enabled : disabled).push(key.replace(/_/g, ' '));
            }
        }
        const parts: string[] = [`Update security headers for ${args.website}.`];
        if (enabled.length > 0) parts.push(`Enable: ${enabled.join(', ')}.`);
        if (disabled.length > 0) parts.push(`Disable: ${disabled.join(', ')}.`);
        return parts.join(' ');
    },
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('apply_security_headers', {
            website: stringify(args.website),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Update browser security headers for ${args.website}.`,
    }),
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));

            const data: Record<string, boolean> = {};
            for (const key of ['cj_protection', 'xss_protection', 'ms_protection', 'permissions_policy', 'content_security_policy', 'referrer_policy', 'cross_origin_opener_policy'] as const) {
                if (args[key] !== undefined) {
                    data[key] = Boolean(args[key]);
                }
            }

            if (Object.keys(data).length === 0) {
                return {
                    success: false,
                    output: 'No security header settings provided. Specify at least one header toggle (e.g. xss_protection: true).',
                };
            }

            const result = await getCloudstickClient().applySecurityHeaders(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                data,
            );
            return {
                success: true,
                output: `Security headers updated for ${context.label}.\n${toPrettyJson(result)}`,
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to update security headers: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const applySecurityHeadersTool: Tool = createCloudstickTool(applySecurityHeaders);
