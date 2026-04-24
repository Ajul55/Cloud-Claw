/**
 * Email Account Tools — Cloudstick API
 * - create_email_account (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

// ─── Create Email Account (Tier 3) ──────────────────────────────────────────

export const createEmailAccountTool: Tool = {
    name: 'create_email_account',
    description:
        'Create a new email address on the server via the Cloudstick API. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID for the domain' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            username: { type: 'string', description: 'Email username (local part)' },
            password: { type: 'string', description: 'Email account password' },
            authentication_method: {
                type: 'string',
                enum: ['unlimited', 'limited'],
                description: 'Quota type — unlimited or limited',
            },
        },
        required: ['website_id', 'server_id', 'username', 'password'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create a new email account "${args.username}" on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_email_account', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            username: String(args.username),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create email account "${args.username}".`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createEmailAccount(
                String(args.website_id), String(args.server_id), userId(),
                {
                    name: String(args.username),
                    password: String(args.password),
                    quota_type: String(args.authentication_method ?? 'unlimited'),
                }
            );
            return { success: true, output: `Email account "${args.username}" created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `Email account creation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
