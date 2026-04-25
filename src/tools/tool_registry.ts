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
import { managePhpTool } from './manage_php.js';
import { repairMysqlTool } from './repair_mysql.js';
import { cleanupDiskTool } from './cleanup_disk.js';
import { executeSshWriteTool } from './execute_ssh_write.js';
import { diagnoseDomainTool } from './diagnose_domain.js';
import { cloudflareCachePurgeTool } from './cloudflare_cache_purge.js';
import { createSystemUserTool } from './manage_system_users.js';
import { createDatabaseUserTool, deleteDatabaseUserTool, changeDatabaseUserPasswordTool } from './manage_database_users.js';
import { checkSslApiTool, issueSSLTool, renewSSLApiTool, deleteSSLTool, updateSSLSettingsTool } from './ssl_api_tools.js';
import { createDatabaseTool, deleteDatabaseTool } from './manage_databases.js';
import { switchPhpApiTool } from './switch_php_api.js';
import { emergencyRestartTool } from './emergency_restart.js';
import { listCronJobsTool, createCronJobTool, deleteCronJobTool } from './manage_cron_jobs.js';
import { checkCloudstickConnectionTool } from './check_cloudstick_connection.js';
import { getCloudstickAccountDetailsTool } from './get_cloudstick_account_details.js';
import { getCloudstickServersTool } from './get_cloudstick_servers.js';
import { getCloudstickWebsitesTool } from './get_cloudstick_websites.js';
import { getServerDetailsTool } from './get_server_details.js';
import { getWordpressDetailsTool } from './get_wordpress_details.js';
import { manageCloudflareDnsTool } from './manage_cloudflare_dns.js';
import { manageWebsiteSettingsTool } from './manage_website_settings.js';
// Phase 5: Cloudstick API Tools (endpoints pending confirmation from backend team)
import { managePhpExtensionTool, changePhpCliVersionTool } from './cloudstick/php_tools.js';
import { configureTimezoneTool, cleanupServerTool, getHostnameTool, runAutoUpdateTool } from './cloudstick/server_settings_tools.js';
import { setMaintenanceModeTool, manageSslTool } from './cloudstick/website_tools.js';
import { createEmailAccountTool } from './cloudstick/email_tools.js';
import {
    listServerSupervisorJobsTool,
    listWebsiteSupervisorJobsTool,
    createSupervisorJobTool,
    createWebsiteSupervisorJobTool,
    rebuildAllSupervisorJobsTool,
    rebuildSupervisorJobsTool,
    handleSupervisorJobTool,
    deleteSupervisorJobTool,
    deleteWebsiteSupervisorJobTool,
    rebuildWebsiteSupervisorJobsTool,
} from './cloudstick/supervisor_tools.js';
import {
    listUserBackupsTool,
    listWebsiteBackupsTool,
    listDatabaseBackupsTool,
    enableWebsiteBackupTool,
    disableWebsiteBackupTool,
    enableDatabaseBackupTool,
    disableDatabaseBackupTool,
    createManualWebsiteBackupTool,
    createManualDatabaseBackupTool,
    restoreWebsiteBackupTool,
    restoreDatabaseBackupTool,
} from './cloudstick/backup_tools.js';
import { createFtpAccountTool } from './cloudstick/ftp_tools.js';
import { listNginxConfigFilesTool, getNginxConfigFileTool, updateNginxConfigFileTool } from './cloudstick/nginx_config_tools.js';
import { getPhpSettingsTool, updatePhpSettingsTool } from './cloudstick/php_settings_tools.js';
import { getNginxSecuritySettingsTool, updateNginxSecuritySettingsTool } from './cloudstick/nginx_security_tools.js';
import { getSslConfigurationTool, setAccessMethodTool, setTlsProtocolVersionTool, setCipherSuiteTool, setBrotliCompressionTool } from './cloudstick/ssl_access_tools.js';
import { changeWebsitePhpVersionTool, changeWebStackTool, addDomainToWebsiteTool, changePublicPathTool } from './cloudstick/app_settings_tools.js';
import { listWordpressPluginsTool, manageWordpressPluginTool } from './cloudstick/wordpress_plugin_tools.js';
import { getWebsiteActivityLogsTool } from './cloudstick/website_activity_tools.js';
// Phase 6: New tools built from Insomnia API audit (all confirmed working)
import { getMysqlStatusTool, updateMysqlRootPasswordTool, toggleMysqlRemoteAccessTool } from './cloudstick/mysql_management_tools.js';
import { listEmailAccountsTool, deleteEmailAccountTool, updateEmailPasswordTool, updateEmailQuotaTool, createEmailForwardTool, listEmailForwardsTool, getEmailConfigTool } from './cloudstick/email_management_tools.js';
import { listDatabaseUsersServerTool, grantDatabasePrivilegeTool, revokeDatabasePrivilegeTool, removeUserFromDatabaseTool } from './cloudstick/database_privilege_tools.js';
import { updateSudoPermissionTool } from './cloudstick/sudo_permission_tools.js';
import { getServerActivityTool } from './cloudstick/server_activity_tools.js';
import { listWebsiteSubdomainsTool } from './cloudstick/subdomain_tools.js';
import { applySecurityHeadersTool } from './cloudstick/security_headers_tools.js';
import {
    getWordpressStatsTool,
    changeWordpressSiteUrlTool,
    changeWordpressDomainUrlTool,
    setWordpressDebugModeTool,
    setWordpressMaintenanceModeTool,
    setWordpressSearchLoginModeTool,
} from './cloudstick/wordpress_manager_tools.js';
import {
    listServerCronJobsTool,
    createServerCronJobTool,
    updateServerCronJobTool,
    deleteServerCronJobTool,
} from './cloudstick/server_cron_tools.js';
import { createServerAuditScriptTool } from './cloudstick/create_server_audit_script.js';
// ── Support Ticket Tools ──────────────────────────────────────────────────────
import { manageDnsRecordsTool } from './manage_dns_records.js';
import { diagnoseSslDnsTool } from './diagnose_ssl_dns.js';
import { managePhpDirectivesTool } from './manage_php_directives.js';
import { fixWordPressSslRedirectsTool } from './fix_wordpress_ssl_redirects.js';
import { analyzeHighServerLoadTool } from './analyze_high_server_load.js';
import { manageVhostRewriteRulesTool } from './manage_vhost_rewrite_rules.js';
import { diagnoseMysqlAuthTool } from './diagnose_mysql_auth.js';
import { fixWordpressDbTool } from './fix_wordpress_db.js';
import { diagnosePhpPoolTool } from './diagnose_php_pool.js';
import { manageCsfFirewallTool } from './manage_csf_firewall.js';
import { readCloudstickLogsTool } from './read_cloudstick_logs.js';

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
    diagnosePhpPoolTool,
    manageCsfFirewallTool,
    fixWordpressTool,
    managePhpTool,
    repairMysqlTool,
    cleanupDiskTool,
    // Phase 2.5: System & DB User Management (Tier 3)
    createSystemUserTool,
    createDatabaseUserTool,
    deleteDatabaseUserTool,
    changeDatabaseUserPasswordTool,
    // Phase 3: Full API Surface (Tier 3)
    checkSslApiTool,
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
    checkCloudstickConnectionTool,
    getCloudstickAccountDetailsTool,
    getCloudstickServersTool,
    getCloudstickWebsitesTool,
    getServerDetailsTool,
    getWordpressDetailsTool,
    manageCloudflareDnsTool,
    manageWebsiteSettingsTool,
    // Phase 5: Cloudstick API Tools (pending backend endpoint confirmation)
    // PHP Management
    managePhpExtensionTool,
    changePhpCliVersionTool,
    // Server Settings
    configureTimezoneTool,
    cleanupServerTool,
    getHostnameTool,
    runAutoUpdateTool,
    // Website Management
    setMaintenanceModeTool,
    manageSslTool,
    // Email Accounts
    createEmailAccountTool,
    // FTP Accounts
    createFtpAccountTool,
    // NGINX Config Manager
    listNginxConfigFilesTool,
    getNginxConfigFileTool,
    updateNginxConfigFileTool,
    // Website PHP Settings
    getPhpSettingsTool,
    updatePhpSettingsTool,
    // NGINX Security Headers
    getNginxSecuritySettingsTool,
    updateNginxSecuritySettingsTool,
    // SSL & Access Configuration
    getSslConfigurationTool,
    setAccessMethodTool,
    setTlsProtocolVersionTool,
    setCipherSuiteTool,
    setBrotliCompressionTool,
    // App Settings
    changeWebsitePhpVersionTool,
    changeWebStackTool,
    addDomainToWebsiteTool,
    changePublicPathTool,
    // WordPress Plugin Manager
    listWordpressPluginsTool,
    manageWordpressPluginTool,
    // Website Activity Logs
    getWebsiteActivityLogsTool,
    // WordPress Manager
    getWordpressStatsTool,
    changeWordpressSiteUrlTool,
    changeWordpressDomainUrlTool,
    setWordpressDebugModeTool,
    setWordpressMaintenanceModeTool,
    setWordpressSearchLoginModeTool,
    // ── Phase 6: New tools from Insomnia API audit (all confirmed) ────────
    // MySQL Management
    getMysqlStatusTool,
    updateMysqlRootPasswordTool,
    toggleMysqlRemoteAccessTool,
    // Email Management (full suite)
    listEmailAccountsTool,
    deleteEmailAccountTool,
    updateEmailPasswordTool,
    updateEmailQuotaTool,
    createEmailForwardTool,
    listEmailForwardsTool,
    getEmailConfigTool,
    // Database Privilege Management
    listDatabaseUsersServerTool,
    grantDatabasePrivilegeTool,
    revokeDatabasePrivilegeTool,
    removeUserFromDatabaseTool,
    // System User Sudo
    updateSudoPermissionTool,
    // Server Activity Log
    getServerActivityTool,
    // Website Subdomains
    listWebsiteSubdomainsTool,
    // Security Headers
    applySecurityHeadersTool,
    // ── Server Cron Jobs (API-based, replaces raw SSH) ────────────────────────
    listServerCronJobsTool,
    createServerCronJobTool,
    updateServerCronJobTool,
    deleteServerCronJobTool,
    // ── Server Audit Script ──────────────────────────────────────────────────
    createServerAuditScriptTool,
    // ── Support Ticket Tools ─────────────────────────────────────────────────
    manageDnsRecordsTool,
    diagnoseSslDnsTool,
    managePhpDirectivesTool,
    fixWordPressSslRedirectsTool,
    analyzeHighServerLoadTool,
    manageVhostRewriteRulesTool,
    diagnoseMysqlAuthTool,
    fixWordpressDbTool,
    // ── Cloudstick Internal Logs ─────────────────────────────────────────
    readCloudstickLogsTool,
    // ── Tier 1 Fix + Tier 2: Supervisor Jobs ────────────────────────────────
    listServerSupervisorJobsTool,
    listWebsiteSupervisorJobsTool,
    createSupervisorJobTool,
    createWebsiteSupervisorJobTool,
    rebuildAllSupervisorJobsTool,
    rebuildSupervisorJobsTool,
    handleSupervisorJobTool,
    deleteSupervisorJobTool,
    deleteWebsiteSupervisorJobTool,
    rebuildWebsiteSupervisorJobsTool,
    // ── Tier 2: Backups ───────────────────────────────────────────────────
    listUserBackupsTool,
    listWebsiteBackupsTool,
    listDatabaseBackupsTool,
    enableWebsiteBackupTool,
    disableWebsiteBackupTool,
    enableDatabaseBackupTool,
    disableDatabaseBackupTool,
    createManualWebsiteBackupTool,
    createManualDatabaseBackupTool,
    restoreWebsiteBackupTool,
    restoreDatabaseBackupTool,
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

// MED-12: Tool groups keyed by intent toolHint — limits tokens sent to LLM per request
const INTENT_TOOL_GROUPS: Record<string, string[]> = {
    diagnose_nginx:      ['diagnose_nginx', 'fix_nginx_config', 'execute_ssh_command', 'get_server_details', 'create_nginx_vhost'],
    diagnose_domain:     ['diagnose_domain', 'diagnose_nginx', 'renew_ssl', 'check_ssl_api', 'cloudflare_cache_purge', 'execute_ssh_command'],
    diagnose_services:   ['diagnose_services', 'execute_ssh_command', 'manage_services', 'repair_mysql', 'manage_php', 'get_server_details'],
    cloudflare_cache_purge: ['cloudflare_cache_purge', 'diagnose_domain', 'execute_ssh_command'],
    check_cloudstick_connection: ['check_cloudstick_connection', 'get_cloudstick_websites', 'get_server_details'],
    check_ssl_api:       ['check_ssl_api', 'renew_ssl', 'diagnose_domain'],
    get_cloudstick_websites: ['get_cloudstick_websites', 'get_wordpress_details', 'get_server_details'],
    get_server_details:  ['get_server_details', 'execute_ssh_command', 'diagnose_services'],
    get_wordpress_details: ['get_wordpress_details', 'fix_wordpress', 'diagnose_nginx', 'execute_ssh_command'],
    execute_ssh_command: ['execute_ssh_command', 'execute_ssh_write', 'get_server_details', 'diagnose_services'],
};

/** Returns OpenAI-compatible function definitions for the LLM.
 *  Pass intentHint to limit the tool list to the most relevant subset. */
export function getLLMToolDefinitions(intentHint?: string): Array<{
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}> {
    let tools = ALL_TOOLS;
    if (intentHint && intentHint !== 'none' && INTENT_TOOL_GROUPS[intentHint]) {
        const allowed = new Set(INTENT_TOOL_GROUPS[intentHint]);
        tools = ALL_TOOLS.filter(t => allowed.has(t.name));
    }
    return tools.map((tool) => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}
