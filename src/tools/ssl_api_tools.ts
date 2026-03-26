/**
 * SSL Management Tools — Phase 3 (Lane 1: Cloudstick API)
 *
 * These tools use the Cloudstick API for SSL operations instead of SSH.
 * Includes a 24-hour renewal race-condition guard.
 * All write operations are approvalTier: 3 (HITL).
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

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
            server_name: { type: 'string', description: 'Human-readable server label' },
            domain: { type: 'string', description: 'Domain name (for display)' },
        },
        required: ['website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will issue a new SSL certificate for ${args.domain ?? 'this website'} on server ${args.server_name ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('issue_ssl', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_name: String(args.server_name ?? ''),
            domain: String(args.domain ?? ''),
        }),
        targetHost: String(args.server_name ?? args.server_id ?? 'unknown'),
        rationale: `Issue SSL certificate for ${args.domain ?? 'website'}.`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const details = await client.getServerDetails(String(args.server_id), userId());
            return JSON.stringify({ ssl_installed: details?.message?.is_ssl_installed ?? 'unknown' });
        } catch { return '{}'; }
    },
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.issueSSL(
                String(args.website_id), String(args.server_id), userId(),
                { authorisation: 'HTTP', access: 'HTTPS', brotli_enabled: true }
            );

            return {
                success: true,
                output: `SSL certificate issued successfully.\nAPI response: ${JSON.stringify(result, null, 2)}`
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
            server_name: { type: 'string', description: 'Human-readable server label' },
            domain: { type: 'string', description: 'Domain name (for display)' },
            force: { type: 'boolean', description: 'Set true to bypass the 24-hour guard (dangerous)' },
        },
        required: ['website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will renew the SSL certificate for ${args.domain ?? 'this website'} on server ${args.server_name ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('renew_ssl_api', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_name: String(args.server_name ?? ''),
            domain: String(args.domain ?? ''),
            force: String(args.force ?? false),
        }),
        targetHost: String(args.server_name && args.server_name !== 'undefined' ? args.server_name : args.server_id),
        rationale: `Renew SSL certificate for ${args.domain ?? 'website'}.`,
    }),
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const details = await client.getServerDetails(String(args.server_id), userId());
            return JSON.stringify({ ssl_installed: details?.message?.is_ssl_installed ?? 'unknown' });
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
            const result = await client.issueSSL(websiteId, serverId, userId(), { authorisation: 'HTTP', access: 'HTTPS', brotli_enabled: true });

            // Track successful renewal for race-condition guard
            recentRenewals.set(renewalKey, Date.now());

            return {
                success: true,
                output: `SSL certificate renewed successfully.\nAPI response: ${JSON.stringify(result, null, 2)}`
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
            server_name: { type: 'string', description: 'Human-readable server label' },
            domain: { type: 'string', description: 'Domain name (for display)' },
        },
        required: ['website_id', 'server_id'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will DELETE the SSL certificate for ${args.domain ?? 'this website'}. The site will revert to HTTP only.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('delete_ssl', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_name: String(args.server_name ?? ''),
            domain: String(args.domain ?? ''),
        }),
        targetHost: String(args.server_name && args.server_name !== 'undefined' ? args.server_name : args.server_id),
        rationale: `DELETE SSL certificate for ${args.domain ?? 'website'}. Reverting to HTTP.`,
    }),
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
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('update_ssl_settings', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            server_label: String(args.server_label ?? ''),
            settings: JSON.stringify(args.settings ?? {}),
        }),
        targetHost: String(args.server_label && args.server_label !== 'undefined' ? args.server_label : args.server_id),
        rationale: `Update SSL settings for website ID ${args.website_id}.`,
    }),
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

// ─── Check SSL Status (Tier 1) ───────────────────────────────────────────────

export const checkSslApiTool: Tool = {
    name: 'check_ssl_api',
    description: 'Check if an SSL certificate is present and get its status via the Cloudstick API. Use this instead of SSH check_ssl.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            website_id: { type: 'string', description: 'Cloudstick website ID (optional if checking server-level SSL)' },
        },
        required: ['server_id'],
    },
    approvalTier: 1, // Read-only
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            // Use server details to get SSL info (legacy /ssl/status/ endpoint doesn't exist)
            const response = await client.getServerDetails(String(args.server_id), userId());
            const server = response?.message;
            if (!server) {
                return { success: false, output: `Server ID ${args.server_id} not found.` };
            }
            const sslInfo = {
                is_ssl_installed: server.is_ssl_installed,
                ssl_provider: server.ssl_provider,
                ssl_created_at: server.ssl_created_at,
                ssl_expired_at: server.ssl_expired_at,
                host_name: server.host_name,
            };
            return { success: true, output: `SSL Status for Server ${args.server_id}:\n${JSON.stringify(sslInfo, null, 2)}` };
        } catch (err) {
            return { success: false, output: `API check failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
