/**
 * SSL Management Tools — Phase 3 (Lane 1: Cloudstick API)
 *
 * These tools use the Cloudstick API for SSL operations instead of SSH.
 * Includes a 24-hour renewal race-condition guard.
 * All write operations are approvalTier: 3 (HITL).
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => env.CLOUDSTICK_USER_ID ?? '';

// ─── Issue SSL (Tier 3) ──────────────────────────────────────────────────────

export const issueSSLTool: Tool = {
    name: 'issue_ssl',
    description:
        'Issue a new SSL/TLS certificate for a website via the Cloudstick API. ' +
        'Use this instead of certbot. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            domain: { type: 'string', description: 'Domain name (for display)' },
            ssl_type: { type: 'string', description: 'SSL type (e.g. "letsencrypt", "custom"). Defaults to letsencrypt.' },
        },
        required: ['website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will issue a new SSL certificate for ${args.domain ?? 'this website'} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('issue_ssl', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            domain: String(args.domain ?? ''),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Issue SSL certificate for ${args.domain ?? 'website'}.`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const status = await client.getSSLStatus(String(args.website_id), String(args.server_id), userId());
            return JSON.stringify(status);
        } catch { return '{}'; }
    },
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.issueSSL(
                String(args.website_id), String(args.server_id), userId(),
                { ssl_type: String(args.ssl_type ?? 'letsencrypt') }
            );

            // Post-issue verification
            const status = await client.getSSLStatus(String(args.website_id), String(args.server_id), userId());
            return {
                success: true,
                output: `SSL certificate issued.\nAPI response: ${JSON.stringify(result, null, 2)}\nCurrent SSL status: ${JSON.stringify(status, null, 2)}`
            };
        } catch (err) {
            return { success: false, output: `SSL issuance failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Renew SSL (Tier 3 + 24-hour race-condition guard) ───────────────────────

// In-memory tracker of recent SSL renewals to prevent race conditions.
const recentRenewals = new Map<string, number>();

export const renewSSLApiTool: Tool = {
    name: 'renew_ssl_api',
    description:
        'Renew an SSL/TLS certificate via the Cloudstick API. ' +
        'Includes a 24-hour guard to prevent renewal race conditions. ' +
        'Use this instead of certbot renew. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            domain: { type: 'string', description: 'Domain name (for display)' },
            force: { type: 'boolean', description: 'Set true to bypass the 24-hour guard (dangerous)' },
        },
        required: ['website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will renew the SSL certificate for ${args.domain ?? 'this website'} on server ${args.server_label ?? args.server_id}.`,
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const status = await client.getSSLStatus(String(args.website_id), String(args.server_id), userId());
            return JSON.stringify(status);
        } catch { return '{}'; }
    },
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);
        const force = args.force === true || args.force === 'true';
        const renewalKey = `${websiteId}:${serverId}`;

        // ─── 24-hour race-condition guard ─────────────────────────────────
        const lastRenewal = recentRenewals.get(renewalKey);
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

        if (lastRenewal && (Date.now() - lastRenewal) < TWENTY_FOUR_HOURS && !force) {
            const hoursAgo = ((Date.now() - lastRenewal) / (60 * 60 * 1000)).toFixed(1);
            return {
                success: false,
                output: `⚠️ SSL RENEWAL BLOCKED — Race Condition Guard\n\n`
                    + `This certificate was renewed ${hoursAgo} hours ago. `
                    + `Forcing another renewal within 24 hours risks breaking the certificate `
                    + `(two renewal processes may conflict).\n\n`
                    + `If you are absolutely certain, ask the user to confirm and set force=true.`,
            };
        }

        try {
            const client = getCloudstickClient();
            const result = await client.renewSSL(websiteId, serverId, userId());

            // Track successful renewal for race-condition guard
            recentRenewals.set(renewalKey, Date.now());

            // Post-renewal verification
            const status = await client.getSSLStatus(websiteId, serverId, userId());
            return {
                success: true,
                output: `SSL certificate renewed.\nAPI response: ${JSON.stringify(result, null, 2)}\nCurrent SSL status: ${JSON.stringify(status, null, 2)}`
            };
        } catch (err) {
            return { success: false, output: `SSL renewal failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Delete SSL (Tier 3) ─────────────────────────────────────────────────────

export const deleteSSLTool: Tool = {
    name: 'delete_ssl',
    description: 'Delete an SSL certificate from a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            domain: { type: 'string', description: 'Domain name (for display)' },
        },
        required: ['website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will DELETE the SSL certificate for ${args.domain ?? 'this website'}. The site will revert to HTTP only.`,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.deleteSSL(String(args.website_id), String(args.server_id), userId());
            return { success: true, output: `SSL certificate deleted.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `SSL deletion failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Update SSL Settings (Tier 3) ────────────────────────────────────────────

export const updateSSLSettingsTool: Tool = {
    name: 'update_ssl_settings',
    description: 'Update SSL settings (HSTS, redirect, etc.) for a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            settings: { type: 'object', description: 'SSL settings object to update' },
        },
        required: ['website_id', 'server_id', 'settings'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will update SSL settings for the website on server ${args.server_label ?? args.server_id}.`,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.updateSSLSettings(
                String(args.website_id), String(args.server_id), userId(),
                args.settings as Record<string, unknown>
            );
            return { success: true, output: `SSL settings updated.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `SSL settings update failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
