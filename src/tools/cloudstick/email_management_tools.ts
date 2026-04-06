/**
 * Email Management Tools — Cloudstick API
 *
 * Confirmed in Insomnia:
 *   GET    /email/websites/{w}/servers/{s}/users/{u}               → list_email_accounts (Tier 1)
 *   DELETE /email/websites/{w}/servers/{s}/users/{u}               → delete_email_account (Tier 3)
 *   PATCH  /email/password/websites/{w}/servers/{s}/users/{u}      → update_email_password (Tier 3)
 *   PATCH  /email/quota/websites/{w}/servers/{s}/users/{u}         → update_email_quota (Tier 3)
 *   POST   /email/forward/websites/{w}/servers/{s}/users/{u}       → create_email_forward (Tier 3)
 *   POST   /email/forward/list/websites/{w}/servers/{s}/users/{u}  → list_email_forwards (Tier 1)
 *   DELETE /email/forward/websites/{w}/servers/{s}/users/{u}       → delete_email_forward (Tier 3)
 *   GET    /email/configure/websites/{w}/servers/{s}/users/{u}     → get_email_config (Tier 1)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import {
    createCloudstickTool,
    getEffectiveCloudstickUserId,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

// ─── List Email Accounts (Tier 1 — Read-Only) ──────────────────────────────

export const listEmailAccounts = {
    name: 'list_email_accounts',
    description:
        'List all email accounts configured for a website on a Cloudstick-managed server. ' +
        'Read-only. Use this to see what email accounts exist before creating or modifying them.',
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
            const result = await getCloudstickClient().listEmailAccounts(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
            );
            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    server: context.serverLabel,
                    email_accounts: result,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to list email accounts: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

// ─── Delete Email Account (Tier 3) ──────────────────────────────────────────

export const deleteEmailAccount = {
    name: 'delete_email_account',
    description:
        'Delete an email account from a website via the Cloudstick API. Requires HITL approval. ' +
        'Provide the email username (local part, e.g. "info").',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            username: { type: 'string', description: 'Email username (local part) to delete' },
        },
        required: ['website', 'username'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will permanently delete the email account "${args.username}" on ${args.website}. All emails in this mailbox will be lost.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('delete_email_account', {
            website: stringify(args.website),
            username: stringify(args.username),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Delete email account "${args.username}" on ${args.website}.`,
    }),
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const client = getCloudstickClient();
            const result = await client.deleteEmailAccount(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { name: stringify(args.username) },
            );
            return { success: true, output: `Email account "${args.username}" deleted.\n${toPrettyJson(result)}` };
        } catch (err) {
            return { success: false, output: `Failed to delete email account: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Update Email Password (Tier 3) ─────────────────────────────────────────

export const updateEmailPassword = {
    name: 'update_email_password',
    description:
        'Change the password for an email account on a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            username: { type: 'string', description: 'Email username (local part) whose password to change' },
            password: { type: 'string', description: 'New password for the email account' },
        },
        required: ['website', 'username', 'password'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will change the password for email account "${args.username}" on ${args.website}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('update_email_password', {
            website: stringify(args.website),
            username: stringify(args.username),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Change password for email account "${args.username}" on ${args.website}.`,
    }),
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const result = await getCloudstickClient().updateEmailPassword(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { name: stringify(args.username), password: stringify(args.password) },
            );
            return { success: true, output: `Email password updated for "${args.username}".\n${toPrettyJson(result)}` };
        } catch (err) {
            return { success: false, output: `Failed to update email password: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Update Email Quota (Tier 3) ────────────────────────────────────────────

export const updateEmailQuota = {
    name: 'update_email_quota',
    description:
        'Update the mailbox quota for an email account on a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            username: { type: 'string', description: 'Email username (local part) whose quota to change' },
            quota_type: {
                type: 'string',
                enum: ['unlimited', 'limited'],
                description: 'Quota type',
            },
            quota_value: { type: 'number', description: 'Quota value (required if quota_type is "limited")' },
            quota_unit: {
                type: 'string',
                enum: ['MB', 'GB', 'TB'],
                description: 'Quota unit (MB, GB, or TB)',
            },
        },
        required: ['website', 'username', 'quota_type'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will change the mailbox quota for "${args.username}" on ${args.website} to ${args.quota_type === 'unlimited' ? 'unlimited' : `${args.quota_value} ${args.quota_unit}`}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('update_email_quota', {
            website: stringify(args.website),
            username: stringify(args.username),
            quota_type: stringify(args.quota_type),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Change quota for email account "${args.username}" on ${args.website}.`,
    }),
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const data: Record<string, unknown> = {
                name: stringify(args.username),
                quota_type: stringify(args.quota_type),
            };
            if (args.quota_value !== undefined) data.quota_value = Number(args.quota_value);
            if (args.quota_unit !== undefined) data.quota_unit = stringify(args.quota_unit);

            const result = await getCloudstickClient().updateEmailQuota(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                data as { quota: number },
            );
            return { success: true, output: `Email quota updated for "${args.username}".\n${toPrettyJson(result)}` };
        } catch (err) {
            return { success: false, output: `Failed to update email quota: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Create Email Forward (Tier 3) ──────────────────────────────────────────

export const createEmailForward = {
    name: 'create_email_forward',
    description:
        'Set up email forwarding for an email account on a website via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            username: { type: 'string', description: 'Email username (local part) to forward from' },
            forward_email: { type: 'string', description: 'Destination email address to forward to' },
        },
        required: ['website', 'username', 'forward_email'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will set up email forwarding: "${args.username}@..." → "${args.forward_email}" on ${args.website}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('create_email_forward', {
            website: stringify(args.website),
            username: stringify(args.username),
            forward_email: stringify(args.forward_email),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Forward "${args.username}" to "${args.forward_email}".`,
    }),
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const result = await getCloudstickClient().forwardEmail(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { name: stringify(args.username), forwardemail: stringify(args.forward_email) },
            );
            return { success: true, output: `Email forwarding set up: "${args.username}" → "${args.forward_email}".\n${toPrettyJson(result)}` };
        } catch (err) {
            return { success: false, output: `Failed to create email forward: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── List Email Forwards (Tier 1) ───────────────────────────────────────────

export const listEmailForwards = {
    name: 'list_email_forwards',
    description:
        'List email forwarding rules for an email account on a website. Read-only. ' +
        'Note: this endpoint uses POST with a body containing the username.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            username: { type: 'string', description: 'Email username (local part) to check forwards for' },
        },
        required: ['website', 'username'],
    },
    tier: 1 as const,
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const result = await getCloudstickClient().listForwardedEmails(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
            );
            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    username: stringify(args.username),
                    forwards: result,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to list email forwards: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

// ─── Get Email Configuration (Tier 1) ───────────────────────────────────────

export const getEmailConfig = {
    name: 'get_email_config',
    description:
        'Get the email service configuration for a website (SMTP/IMAP settings, relay, etc.). Read-only.',
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
            const result = await getCloudstickClient().getEmailConfig(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
            );
            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    email_config: result,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to get email config: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

// ─── Tool exports ───────────────────────────────────────────────────────────

export const listEmailAccountsTool: Tool = createCloudstickTool(listEmailAccounts);
export const deleteEmailAccountTool: Tool = createCloudstickTool(deleteEmailAccount);
export const updateEmailPasswordTool: Tool = createCloudstickTool(updateEmailPassword);
export const updateEmailQuotaTool: Tool = createCloudstickTool(updateEmailQuota);
export const createEmailForwardTool: Tool = createCloudstickTool(createEmailForward);
export const listEmailForwardsTool: Tool = createCloudstickTool(listEmailForwards);
export const getEmailConfigTool: Tool = createCloudstickTool(getEmailConfig);
