import { z } from 'zod';
import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';

export const getCloudstickAccountDetailsTool: Tool = {
    name: 'get_cloudstick_account_details',
    description: 'Retrieves the Cloudstick account details and profile information for the configured user. Call this when the user asks for their account information or details.',
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
            const response = await client.request({
                method: 'GET',
                url: `/users/${effectiveUserId}`
            });

            return {
                success: true,
                output: `Account Details:\n${JSON.stringify(response.user || response, null, 2)}`,
            };
        } catch (error: any) {
            return {
                success: false,
                output: `Failed to retrieve account details.\nError: ${error.message}`,
            };
        }
    }
};
