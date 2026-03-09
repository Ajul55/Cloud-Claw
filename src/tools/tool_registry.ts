/**
 * Tool Registry
 *
 * Central registry mapping tool names → Tool implementations.
 * Add new tools here to make them available to the agent loop.
 */

import type { Tool } from './types.js';
import { getCurrentTimeTool } from './get_current_time.js';
import { discoveryAgentTool } from './discovery_agent.js';
import { executeSshCommandTool } from './execute_ssh_command.js';
import { diagnoseNginxTool } from './diagnose_nginx.js';
import { fixNginxConfigTool } from './fix_nginx_config.js';
import { create_nginx_vhost } from './create_nginx_vhost.js';
import { sreSearchTool } from './sre_search.js';
import { fixMemorySearchTool } from '../memory/fix_memory.js';

const ALL_TOOLS: Tool[] = [
    getCurrentTimeTool,
    diagnoseNginxTool,
    fixNginxConfigTool,
    create_nginx_vhost,
    discoveryAgentTool,
    executeSshCommandTool,
    sreSearchTool,
    fixMemorySearchTool,
];

/** Map for O(1) lookup by name */
const TOOL_MAP = new Map<string, Tool>(
    ALL_TOOLS.map((t) => [t.name, t])
);

export function getToolByName(name: string): Tool | undefined {
    return TOOL_MAP.get(name);
}

export function getAllTools(): Tool[] {
    return ALL_TOOLS;
}

export function getAllToolNames(): string[] {
    return ALL_TOOLS.map((t) => t.name);
}

/** Returns OpenAI-compatible function definitions for the LLM */
export function getLLMToolDefinitions(): Array<{
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}> {
    return ALL_TOOLS.map((tool) => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}
