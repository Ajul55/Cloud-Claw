/**
 * Website Management Tools — Cloudstick API
 *
 * - set_maintenance_mode (Tier 3)
 * - manage_ssl (Tier 1 for status, Tier 3 for issue/renew/revoke)
 * - add_subdomain (Tier 3)
 * - create_wordpress_site (Tier 3)
 * - create_custom_php_site (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Set Maintenance Mode (Tier 3) ──────────────────────────────────────────

export const setMaintenanceModeTool: Tool = {
    name: 'set_maintenance_mode',
    description:
        'Toggle maintenance mode for a website via the Cloudstick API. ' +
        'For WordPress sites, uses the WordPress manager endpoint. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            state: {
                type: 'string',
                enum: ['on', 'off'],
                description: 'Turn maintenance mode on or off',
            },
        },
        required: ['website_id', 'server_id', 'state'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will turn maintenance mode ${args.state} for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('set_maintenance_mode', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            state: String(args.state),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Turn maintenance mode ${args.state} for website ${args.website_id}.`,
    }),
    execute: async (args) => {
        const enabled = args.state === 'on';
        try {
            const client = getCloudstickClient();
            // Try WordPress manager endpoint first (toggles maintenance)
            // If that fails, fall back to generic maintenance endpoint
            try {
                const result = await client.toggleWpMaintenanceMode(
                    String(args.website_id), String(args.server_id), userId()
                );
                return {
                    success: true,
                    output: `Maintenance mode toggled (WordPress).\n${JSON.stringify(result, null, 2)}`,
                };
            } catch {
                // Not a WordPress site — try generic endpoint
                const result = await client.setMaintenanceMode(
                    String(args.website_id), String(args.server_id), userId(),
                    { enabled }
                );
                return {
                    success: true,
                    output: `Maintenance mode set to ${args.state}.\n${JSON.stringify(result, null, 2)}`,
                };
            }
        } catch (err) {
            return { success: false, output: `Maintenance mode failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Manage SSL (Tier 1 for status, Tier 3 for issue/renew/revoke) ──────────

export const manageSslTool: Tool = {
    name: 'manage_ssl',
    description:
        'Manage SSL certificate for a website via the Cloudstick API. ' +
        'Supported actions: issue, renew, revoke, status. ' +
        'status is read-only; issue/renew/revoke require HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            action: {
                type: 'string',
                enum: ['issue', 'renew', 'revoke', 'status'],
                description: 'SSL action',
            },
        },
        required: ['website_id', 'server_id', 'action'],
    },
    approvalTier: 3,
    getApprovalRequest: (args) => {
        if (args.action === 'status') return null; // Read-only
        return {
            command: encodeToolApprovalCommand('manage_ssl', {
                website_id: String(args.website_id),
                server_id: String(args.server_id),
                action: String(args.action),
            }),
            targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
            rationale: `SSL: ${String(args.action).toUpperCase()} certificate for website ${args.website_id}.`,
        };
    },
    getRationale: (args) =>
        `This will ${args.action} the SSL certificate for website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);

        try {
            const client = getCloudstickClient();

            switch (args.action) {
                case 'status': {
                    // Use server details to get SSL status
                    const details = await client.getServerDetails(serverId, userId());
                    const server = (details as any)?.message;
                    return {
                        success: true,
                        output: `SSL Status:\n${JSON.stringify({
                            is_ssl_installed: server?.is_ssl_installed,
                            ssl_provider: server?.ssl_provider,
                            ssl_created_at: server?.ssl_created_at,
                            ssl_expired_at: server?.ssl_expired_at,
                        }, null, 2)}`,
                    };
                }
                case 'issue': {
                    const result = await client.issueSSL(websiteId, serverId, userId(), {
                        authorisation: 'HTTP', access: 'HTTPS', brotli_enabled: true,
                    });
                    return { success: true, output: `SSL certificate issued.\n${JSON.stringify(result, null, 2)}` };
                }
                case 'renew': {
                    const result = await client.renewFreeSSL(websiteId, serverId, userId());
                    return { success: true, output: `SSL certificate renewed.\n${JSON.stringify(result, null, 2)}` };
                }
                case 'revoke': {
                    const result = await client.revokeSSL(websiteId, serverId, userId());
                    return { success: true, output: `SSL certificate revoked.\n${JSON.stringify(result, null, 2)}` };
                }
                default:
                    return { success: false, output: `Unknown SSL action: ${args.action}` };
            }
        } catch (err) {
            return { success: false, output: `SSL operation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Add Subdomain (Tier 3) ─────────────────────────────────────────────────

export const addSubdomainTool: Tool = {
    name: 'add_subdomain',
    description:
        'Add a subdomain to an existing website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID (parent domain)' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            subdomain: { type: 'string', description: 'Subdomain to add (e.g. "blog")' },
        },
        required: ['website_id', 'server_id', 'subdomain'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will add subdomain "${args.subdomain}" to website ${args.website_id} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('add_subdomain', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            subdomain: String(args.subdomain),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Add subdomain "${args.subdomain}".`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.addSubdomain(
                String(args.website_id), String(args.server_id), userId(),
                { subdomain: String(args.subdomain) }
            );
            return { success: true, output: `Subdomain "${args.subdomain}" added.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Subdomain creation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Create WordPress Site (Tier 3) ─────────────────────────────────────────

export const createWordPressSiteTool: Tool = {
    name: 'create_wordpress_site',
    description:
        'Create a full WordPress installation via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            email: { type: 'string', description: 'Cloudstick account email' },
            website_name: { type: 'string', description: 'Website name' },
            domain: { type: 'string', description: 'Domain or subdomain' },
            site_title: { type: 'string', description: 'WordPress site title' },
            admin_username: { type: 'string', description: 'WordPress admin username' },
            admin_password: { type: 'string', description: 'WordPress admin password' },
            admin_email: { type: 'string', description: 'WordPress admin email' },
            php_version: {
                type: 'string',
                enum: ['8.1', '8.2', '8.3', '8.4', '8.5'],
                description: 'PHP version',
            },
            web_app_server: {
                type: 'string',
                enum: ['native_nginx', 'nginx_apache'],
                description: 'Web application server type',
            },
        },
        required: ['server_id', 'email', 'website_name', 'domain', 'site_title', 'admin_username', 'admin_password', 'admin_email', 'php_version', 'web_app_server'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create a new WordPress site "${args.site_title}" at ${args.domain} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_wordpress_site', {
            server_id: String(args.server_id),
            domain: String(args.domain),
            site_title: String(args.site_title),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create WordPress site "${args.site_title}" at ${args.domain}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const { messages, final: lastMsg } = await client.createWordPressSite(
                String(args.server_id), userId(),
                {
                    email: String(args.email),
                    website_name: String(args.website_name),
                    domain: String(args.domain),
                    site_title: String(args.site_title),
                    admin_username: String(args.admin_username),
                    admin_password: String(args.admin_password),
                    admin_email: String(args.admin_email),
                    php_version: String(args.php_version),
                    web_app_server: String(args.web_app_server),
                }
            );

            // Empty response = WS connected but server sent nothing useful
            if (messages.length === 0) {
                return {
                    success: false,
                    output: `WordPress site creation FAILED: WebSocket connected but received 0 messages. `
                        + `The Cloudstick API may not support WordPress creation via this endpoint. `
                        + `Server ID: ${args.server_id}. Domain: ${args.domain}. `
                        + `Report this failure to the Pilot. Do NOT attempt SSH-based workarounds or verification.`,
                };
            }

            const allText = messages.join('\n');
            const hasError = /error|fail|denied|not allowed|unauthorized|already exists/i.test(allText)
                && !/success|completed|created/i.test(allText);

            const finalStr = typeof lastMsg === 'string' ? lastMsg : JSON.stringify(lastMsg, null, 2);
            const summary = [
                hasError
                    ? `RESULT: FAILED — WordPress site "${args.site_title}" at ${args.domain}`
                    : `RESULT: SUCCESS — WordPress site "${args.site_title}" created at ${args.domain}`,
                `WebSocket messages received: ${messages.length}`,
                `--- Server response ---`,
                ...messages.map((m: any, i: number) => `[${i + 1}] ${String(m).slice(0, 500)}`),
                `--- Final message ---`,
                finalStr,
                ``,
                `IMPORTANT: This operation was handled entirely by the Cloudstick API.`,
                `Do NOT run any SSH commands to verify or investigate this result.`,
                `Report the result above to the Pilot as-is.`,
            ].join('\n');

            return { success: !hasError, output: summary };
        } catch (err) {
            return { success: false, output: `WordPress site creation FAILED: ${err instanceof Error ? err.message : String(err)}. Do NOT attempt SSH verification.` };
        }
    },
};

// ─── Create Custom PHP Site (Tier 3) ────────────────────────────────────────

export const createCustomPhpSiteTool: Tool = {
    name: 'create_custom_php_site',
    description:
        'Create a new custom PHP website with specified security headers via the Cloudstick API. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            email: { type: 'string', description: 'Cloudstick account email' },
            website_name: { type: 'string', description: 'Website name' },
            domain_type: {
                type: 'string',
                enum: ['own_domain', 'temp_clone'],
                description: 'Domain type',
            },
            domain_name: { type: 'string', description: 'Domain name' },
            php_version: {
                type: 'string',
                enum: ['8.1', '8.2', '8.3', '8.4', '8.5'],
                description: 'PHP version',
            },
            web_app_server: {
                type: 'string',
                enum: ['native_nginx', 'nginx_apache'],
                description: 'Web application server type',
            },
            clickjacking_protection: { type: 'boolean', description: 'Enable clickjacking protection' },
            xss_protection: { type: 'boolean', description: 'Enable XSS protection' },
            mime_sniffing_protection: { type: 'boolean', description: 'Enable MIME sniffing protection' },
        },
        required: ['server_id', 'email', 'website_name', 'domain_type', 'domain_name', 'php_version', 'web_app_server'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create a new custom PHP site "${args.website_name}" at ${args.domain_name} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_custom_php_site', {
            server_id: String(args.server_id),
            domain_name: String(args.domain_name),
            website_name: String(args.website_name),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create custom PHP site "${args.website_name}" at ${args.domain_name}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const { messages, final: lastMsg } = await client.createCustomPhpSite(
                String(args.server_id), userId(),
                {
                    email: String(args.email),
                    website_name: String(args.website_name),
                    domain_type: String(args.domain_type),
                    domain_name: String(args.domain_name),
                    php_version: String(args.php_version),
                    web_app_server: String(args.web_app_server),
                    clickjacking_protection: args.clickjacking_protection === true,
                    xss_protection: args.xss_protection === true,
                    mime_sniffing_protection: args.mime_sniffing_protection === true,
                }
            );

            if (messages.length === 0) {
                return {
                    success: false,
                    output: `Custom PHP site creation FAILED: WebSocket connected but received 0 messages. `
                        + `The Cloudstick API may not support this creation via this endpoint. `
                        + `Server ID: ${args.server_id}. Domain: ${args.domain_name}. `
                        + `Report this failure to the Pilot. Do NOT attempt SSH-based workarounds or verification.`,
                };
            }

            const allText = messages.join('\n');
            const hasError = /error|fail|denied|not allowed|unauthorized|already exists/i.test(allText)
                && !/success|completed|created/i.test(allText);

            const finalStr = typeof lastMsg === 'string' ? lastMsg : JSON.stringify(lastMsg, null, 2);
            const summary = [
                hasError
                    ? `RESULT: FAILED — Custom PHP site "${args.website_name}" at ${args.domain_name}`
                    : `RESULT: SUCCESS — Custom PHP site "${args.website_name}" created at ${args.domain_name}`,
                `WebSocket messages received: ${messages.length}`,
                `--- Server response ---`,
                ...messages.map((m: any, i: number) => `[${i + 1}] ${String(m).slice(0, 500)}`),
                `--- Final message ---`,
                finalStr,
                ``,
                `IMPORTANT: This operation was handled entirely by the Cloudstick API.`,
                `Do NOT run any SSH commands to verify or investigate this result.`,
                `Report the result above to the Pilot as-is.`,
            ].join('\n');

            return { success: !hasError, output: summary };
        } catch (err) {
            return { success: false, output: `Custom PHP site creation FAILED: ${err instanceof Error ? err.message : String(err)}. Do NOT attempt SSH verification.` };
        }
    },
};
