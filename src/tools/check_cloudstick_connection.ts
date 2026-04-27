import { z } from 'zod';
import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
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
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
        if (!effectiveUserId) {
            return {
                success: false,
                output: 'Cloudstick user ID not configured. Run /setup first to add your Cloudstick API credentials.',
            };
        }

        try {
            const client = getCloudstickClient();
            const timeoutMs = 10_000;
            const timeoutSignal = AbortSignal.timeout(timeoutMs);

            await Promise.race([
                client.listPlans(effectiveUserId),
                new Promise<never>((_, reject) =>
                    timeoutSignal.addEventListener('abort', () =>
                        reject(new Error(`Connection check timed out after ${timeoutMs / 1000}s`))
                    )
                ),
            ]);
            return {
                success: true,
                output: `Cloudstick API connection successful! Credentials for User ID ${effectiveUserId} are mapped and API requests are succeeding.`,
            };
        } catch (error: any) {
            return {
                success: false,
                output: `Cloudstick API connection failed.\nError: ${error.message}`,
            };
        }
    }
};
