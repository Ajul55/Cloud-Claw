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
import { diagnoseServicesTool } from './diagnose_services.js';
import { fixWordpressTool } from './fix_wordpress.js';
import { checkSslTool, renewSslTool } from './ssl_tools.js';
import { managePhpTool } from './manage_php.js';
import { repairMysqlTool } from './repair_mysql.js';
import { cleanupDiskTool } from './cleanup_disk.js';
import { executeSshWriteTool } from './execute_ssh_write.js';
import { diagnoseDomainTool } from './diagnose_domain.js';
import { cloudflareCachePurgeTool } from './cloudflare_cache_purge.js';
import { createSystemUserTool, deleteSystemUserTool, changeSystemUserPasswordTool } from './manage_system_users.js';
import { createDatabaseUserTool, deleteDatabaseUserTool, changeDatabaseUserPasswordTool } from './manage_database_users.js';
import { issueSSLTool, renewSSLApiTool, deleteSSLTool, updateSSLSettingsTool } from './ssl_api_tools.js';
import { createDatabaseTool, deleteDatabaseTool } from './manage_databases.js';
import { switchPhpApiTool } from './switch_php_api.js';
import { emergencyRestartTool } from './emergency_restart.js';
import { listCronJobsTool, createCronJobTool, deleteCronJobTool } from './manage_cron_jobs.js';

const ALL_TOOLS: Tool[] = [
    getCurrentTimeTool,
    diagnoseDomainTool,
    cloudflareCachePurgeTool,
    diagnoseNginxTool,
    fixNginxConfigTool,
    create_nginx_vhost,
    discoveryAgentTool,
    executeSshCommandTool,
    executeSshWriteTool,
    sreSearchTool,
    fixMemorySearchTool,
    diagnoseServicesTool,
    fixWordpressTool,
    checkSslTool,
    renewSslTool,
    managePhpTool,
    repairMysqlTool,
    cleanupDiskTool,
    // Phase 2.5: System & DB User Management (Tier 3)
    createSystemUserTool,
    deleteSystemUserTool,
    changeSystemUserPasswordTool,
    createDatabaseUserTool,
    deleteDatabaseUserTool,
    changeDatabaseUserPasswordTool,
    // Phase 3: Full API Surface (Tier 3)
    issueSSLTool,
    renewSSLApiTool,
    deleteSSLTool,
    updateSSLSettingsTool,
    createDatabaseTool,
    deleteDatabaseTool,
    switchPhpApiTool,
    emergencyRestartTool,
    // Phase 4: Cron Job Management
    listCronJobsTool,
    createCronJobTool,
    deleteCronJobTool,
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
