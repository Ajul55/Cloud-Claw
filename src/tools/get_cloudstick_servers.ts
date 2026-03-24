import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';

export const getCloudstickServersTool: Tool = {
    name: 'get_cloudstick_servers',
    description: 'Retrieves the list of all servers owned by the configured Cloudstick user. Crucial for finding the server_id to use in other tools when the user only knows the server name or IP.',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    },
    approvalTier: 1, // Read-only
    execute: async () => {
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
        if (!effectiveUserId) {
            return {
                success: false,
                output: 'Cloudstick user ID not configured. Run /setup first to add your Cloudstick API credentials.',
            };
        }

        try {
            const client = getCloudstickClient();
            const response = await client.listServersByUser(effectiveUserId);

            return {
                success: true,
                output: `Servers List:\n${JSON.stringify(response, null, 2)}`,
            };
        } catch (error: any) {
            return {
                success: false,
                output: `Failed to retrieve servers list.\nError: ${error.message}`,
            };
        }
    }
};
