/**
 * Firewall & Security Tools — Cloudstick API
 *
 * - get_firewall_status (Tier 1 — read-only)
 * - manage_brute_force_shield (Tier 1 for status, Tier 3 for writes)
 * - manage_ip_rule (Tier 3)
 * - add_temporary_ip_rule (Tier 3)
 * - list_temporary_ip_rules (Tier 1 — read-only)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Get Firewall Status (Tier 1) ───────────────────────────────────────────

export const getFirewallStatusTool: Tool = {
    name: 'get_firewall_status',
    description: 'Returns the current firewall status and active rules summary via the Cloudstick API. Read-only.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
        },
        required: ['server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.getFirewallStatus(String(args.server_id), userId());
            return { success: true, output: `Firewall status:\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to get firewall status: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Manage Brute Force Shield ──────────────────────────────────────────────

export const manageBruteForceShieldTool: Tool = {
    name: 'manage_brute_force_shield',
    description:
        'Query, flush blocked IPs, or restart the brute force shield service via the Cloudstick API. ' +
        'action=status is read-only. action=flush_blocks or restart requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            action: {
                type: 'string',
                enum: ['status', 'flush_blocks', 'restart'],
                description: 'Brute force shield action',
            },
        },
        required: ['server_id', 'action'],
    },
    // Dynamic tier: status=1, flush_blocks/restart=3
    approvalTier: 3,
    getApprovalRequest: (args) => {
        if (args.action === 'status') return null; // Skip approval for read-only
        return {
            command: encodeToolApprovalCommand('manage_brute_force_shield', {
                server_id: String(args.server_id),
                action: String(args.action),
            }),
            targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
            rationale: `${args.action === 'flush_blocks' ? 'Flush all blocked IPs from' : 'Restart'} the brute force shield.`,
        };
    },
    getRationale: (args) =>
        `This will ${args.action === 'flush_blocks' ? 'flush all blocked IPs from' : 'restart'} the brute force shield on server ${args.server_label ?? args.server_id}.`,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.manageBruteForceShield(
                String(args.server_id), userId(), String(args.action)
            );
            return { success: true, output: `Brute force shield ${args.action}:\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Brute force shield operation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Manage IP Rule (Tier 3) ────────────────────────────────────────────────

export const manageIpRuleTool: Tool = {
    name: 'manage_ip_rule',
    description:
        'Apply a firewall rule to a specified IP address via the Cloudstick API. ' +
        'Supported actions: whitelist, block, ignore, drop, unblock, unignore, cleanup. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            ip: { type: 'string', description: 'Target IP address' },
            action: {
                type: 'string',
                enum: ['whitelist', 'block', 'ignore', 'drop', 'unblock', 'unignore', 'cleanup'],
                description: 'Firewall rule action',
            },
        },
        required: ['server_id', 'ip', 'action'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will ${args.action} IP ${args.ip} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('manage_ip_rule', {
            server_id: String(args.server_id),
            ip: String(args.ip),
            action: String(args.action),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `${String(args.action).toUpperCase()} IP ${args.ip}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.manageIpRule(
                String(args.server_id), userId(),
                { ip: String(args.ip), action: String(args.action) }
            );
            return { success: true, output: `IP rule applied: ${args.action} ${args.ip}\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `IP rule operation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── Add Temporary IP Rule (Tier 3) ─────────────────────────────────────────

export const addTemporaryIpRuleTool: Tool = {
    name: 'add_temporary_ip_rule',
    description:
        'Add a temporary firewall rule with automatic expiry via the Cloudstick API. ' +
        'Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            ip: { type: 'string', description: 'Target IP address' },
            action: {
                type: 'string',
                enum: ['block', 'allow'],
                description: 'Block or allow the IP temporarily',
            },
            duration: {
                type: 'string',
                enum: ['1_week', '1_month', '3_months', '3_years', '6_years', '10_years'],
                description: 'Duration of the temporary rule',
            },
        },
        required: ['server_id', 'ip', 'action', 'duration'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will temporarily ${args.action} IP ${args.ip} for ${String(args.duration).replace(/_/g, ' ')} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('add_temporary_ip_rule', {
            server_id: String(args.server_id),
            ip: String(args.ip),
            action: String(args.action),
            duration: String(args.duration),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Temporarily ${args.action} IP ${args.ip} for ${String(args.duration).replace(/_/g, ' ')}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.addTemporaryIpRule(
                String(args.server_id), userId(),
                { ip: String(args.ip), action: String(args.action), duration: String(args.duration) }
            );
            return {
                success: true,
                output: `Temporary IP rule added: ${args.action} ${args.ip} for ${String(args.duration).replace(/_/g, ' ')}\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return { success: false, output: `Temporary IP rule failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

// ─── List Temporary IP Rules (Tier 1) ───────────────────────────────────────

export const listTemporaryIpRulesTool: Tool = {
    name: 'list_temporary_ip_rules',
    description: 'Returns a list of all currently active temporary IP rules via the Cloudstick API. Read-only.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
        },
        required: ['server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.listTemporaryIpRules(String(args.server_id), userId());
            return { success: true, output: `Temporary IP rules:\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Failed to list temporary IP rules: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
