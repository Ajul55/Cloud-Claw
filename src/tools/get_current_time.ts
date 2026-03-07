/**
 * Tool: get_current_time
 *
 * A simple smoke-test tool to verify the agent tool-calling pipeline works.
 * Returns the current UTC ISO timestamp.
 */

import type { Tool, ToolResult } from './types.js';

export const getCurrentTimeTool: Tool = {
    name: 'get_current_time',
    description:
        'Returns the current UTC date and time as an ISO 8601 string. Use this to verify the agent pipeline is working, to timestamp events, or when a user asks for the current time.',
    parameters: {
        type: 'object',
        properties: {},
        required: [],
    },

    async execute(_args: Record<string, unknown>): Promise<ToolResult> {
        const now = new Date().toISOString();
        return {
            success: true,
            output: `Current UTC time: ${now}`,
        };
    },
};
