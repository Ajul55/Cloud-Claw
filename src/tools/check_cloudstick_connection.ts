import { z } from 'zod';
import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { env } from '../config/env.js';

export const checkCloudstickConnectionTool: Tool = {
    name: 'check_cloudstick_connection',
    description: 'Diagnoses whether the Cloudstick API is connected and responding correctly by testing the credentials in the .env file against the live API.',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    },
    approvalTier: 1,
    execute: async () => {
        if (!env.CLOUDSTICK_API_KEY || !env.CLOUDSTICK_API_SECRET || !env.CLOUDSTICK_USER_ID) {
            return {
                success: false,
                output: 'Missing Cloudstick API credentials in .env file. Ensure CLOUDSTICK_API_KEY, CLOUDSTICK_API_SECRET, and CLOUDSTICK_USER_ID are set.',
            };
        }

        try {
            const client = getCloudstickClient();
            // Test connection with a lightweight read operation
            await client.listPlans(env.CLOUDSTICK_USER_ID);
            return {
                success: true,
                output: `Cloudstick API connection successful! Credentials for User ID ${env.CLOUDSTICK_USER_ID} are mapped and API requests are succeeding.`,
            };
        } catch (error: any) {
            return {
                success: false,
                output: `Cloudstick API connection failed.\nError: ${error.message}`,
            };
        }
    }
};
