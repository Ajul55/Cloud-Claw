/**
 * FTP Account Tool — Cloudstick API
 *
 * - create_ftp_account (Tier 3)
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

export const createFtpAccountTool: Tool = {
    name: 'create_ftp_account',
    description:
        'Create a new FTP account via the Cloudstick API. ' +
        'The FTP user is restricted to the specified directory. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            ftp_username: { type: 'string', description: 'FTP username' },
            ftp_password: { type: 'string', description: 'FTP password' },
            directory: { type: 'string', description: 'Directory path the FTP user is restricted to' },
        },
        required: ['website_id', 'server_id', 'ftp_username', 'ftp_password', 'directory'],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will create FTP account "${args.ftp_username}" restricted to ${args.directory} on server ${args.server_label ?? args.server_id}.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('create_ftp_account', {
            website_id: String(args.website_id),
            server_id: String(args.server_id),
            ftp_username: String(args.ftp_username),
            directory: String(args.directory),
        }),
        targetHost: String(args.server_label ?? args.server_id ?? 'unknown'),
        rationale: `Create FTP account "${args.ftp_username}" in ${args.directory}.`,
    }),
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const result = await client.createFtpAccount(
                String(args.website_id), String(args.server_id), userId(),
                {
                    ftp_username: String(args.ftp_username),
                    ftp_password: String(args.ftp_password),
                    directory: String(args.directory),
                }
            );
            return { success: true, output: `FTP account "${args.ftp_username}" created.\n${JSON.stringify(result, null, 2)}` };
        } catch (err) {
            return { success: false, output: `FTP account creation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
