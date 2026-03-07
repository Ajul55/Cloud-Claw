import { env } from '../config/env.js';
import type { Tool, ToolResult } from './types.js';

export const sreSearchTool: Tool = {
    name: 'sre_search',
    description: 'Perform a web search targeting DevOps and SRE domains like ServerFault, StackOverflow, Nginx docs, and GitHub issues. Use this when you encounter unfamiliar error messages or need to check for known bugs.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The error message or technical query to search for.',
            },
        },
        required: ['query'],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const query = args.query as string | undefined;

        if (!query) {
            return {
                success: false,
                output: 'Missing "query" parameter.',
            };
        }

        if (!env.SERPAPI_KEY) {
            return {
                success: false,
                output: 'SRE Search is disabled because SERPAPI_KEY is not configured in the environment.',
            };
        }

        try {
            // Append domain restricts to focus the search on SRE-relevant resources
            const searchQuery = `${query} site:stackoverflow.com OR site:serverfault.com OR site:github.com OR site:nginx.org`;

            const params = new URLSearchParams({
                api_key: env.SERPAPI_KEY,
                engine: 'google',
                q: searchQuery,
                num: '5', // Get top 5 results to keep context clean
            });

            const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
            if (!res.ok) {
                return {
                    success: false,
                    output: `SerpAPI request failed with status: ${res.status}`,
                };
            }

            const data = await res.json() as any;
            const organicResults = data.organic_results || [];

            if (organicResults.length === 0) {
                return {
                    success: true,
                    output: `No SRE-specific results found for "${query}".`,
                };
            }

            let outputText = `🔍 **SRE Search Results for "${query}"**\n\n`;
            for (const result of organicResults) {
                outputText += `• **${result.title}**\n  ${result.snippet}\n  [Link](${result.link})\n\n`;
            }

            return {
                success: true,
                output: outputText.trim(),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: `Failed to execute web search: ${msg}`,
            };
        }
    },
};
