/**
 * Server Activity Log Tool — Cloudstick API
 *
 * Confirmed in Insomnia:
 *   GET /activity/servers/{s}/users/{u}   → get_server_activity (Tier 1)
 *   Query params: page, limit, search, status, activity_type, duration
 */

import type { Tool } from '../types.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import { env } from '../../config/env.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set'); })();

export const getServerActivityTool: Tool = {
    name: 'get_server_activity',
    description:
        'Retrieve the activity log for a Cloudstick-managed server. Shows recent events like ' +
        'config changes, SSL issuance, deployments, website creation, and service restarts. ' +
        'Read-only. Use this for auditing or investigating recent server changes.',
    parameters: {
        type: 'object',
        properties: {
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            page: { type: 'number', description: 'Page number for pagination. Defaults to 1.' },
            limit: { type: 'number', description: 'Number of entries per page. Defaults to 20.' },
            search: { type: 'string', description: 'Search keyword to filter activity entries' },
            status: { type: 'string', description: 'Filter by status (e.g. "success", "failed")' },
            activity_type: { type: 'string', description: 'Filter by activity type (e.g. "MySQL", "SSL", "Website")' },
            duration: { type: 'string', description: 'Filter by time range (e.g. "24h", "7d", "30d")' },
        },
        required: ['server_id'],
    },
    approvalTier: 1,
    execute: async (args) => {
        try {
            const client = getCloudstickClient();
            const params: Record<string, unknown> = {};
            if (args.page !== undefined) params.page = Number(args.page);
            if (args.limit !== undefined) params.limit = Number(args.limit);
            if (args.search) params.search = String(args.search);
            if (args.status) params.status = String(args.status);
            if (args.activity_type) params.activity_type = String(args.activity_type);
            if (args.duration) params.duration = String(args.duration);

            const result = await client.getServerActivity(
                String(args.server_id), userId(),
                Object.keys(params).length > 0 ? params as any : undefined,
            );
            return {
                success: true,
                output: `Server activity log for ${args.server_label ?? args.server_id}:\n${JSON.stringify(result, null, 2)}`,
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to get server activity: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};
