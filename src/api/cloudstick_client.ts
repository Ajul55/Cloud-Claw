import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { env } from '../config/env.js';
import { getCloudstickUser } from './cloudstick_context.js';
import { getDecryptedCloudstickCredentials } from '../services/user_service.js';

export interface CloudstickClientOptions {
    apiKey?: string;
    apiSecret?: string;
    baseURL?: string;
}

export class CloudstickApiClient {
    private client: AxiosInstance;
    private apiKey: string;
    private apiSecret: string;

    /**
     * @param options.apiKey     - Cloudstick API key (falls back to env)
     * @param options.apiSecret  - Cloudstick API secret (falls back to env)
     * @param options.baseURL    - API base URL (falls back to env CLOUDSTICK_API_BASE)
     */
    constructor(options: CloudstickClientOptions = {}) {
        const baseURL = options.baseURL ?? env.CLOUDSTICK_API_BASE ?? 'https://api.cloudstick.io';
        this.apiKey = options.apiKey ?? env.CLOUDSTICK_API_KEY ?? '';
        this.apiSecret = options.apiSecret ?? env.CLOUDSTICK_API_SECRET ?? '';

        this.client = axios.create({
            baseURL: `${baseURL}/api/v2`,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Core request wrapper using API Key + Secret authentication.
     * Uses instance-level credentials (from constructor or env fallback).
     */
    public async request<T = any>(config: AxiosRequestConfig): Promise<T> {
        // Per-user context takes priority; fall back to instance credentials (env)
        const ctx = getCloudstickUser();
        const ctxCreds = ctx ? getDecryptedCloudstickCredentials(ctx) : null;
        const effectiveKey = ctxCreds?.apiKey ?? this.apiKey;
        const effectiveSecret = ctxCreds?.apiSecret ?? this.apiSecret;

        if (!effectiveKey || !effectiveSecret) {
            throw new Error('Cloudstick API_KEY and API_SECRET are required (set in .env or per-user via /setup)');
        }

        const authHeader = `Basic ${Buffer.from(`${effectiveKey}:${effectiveSecret}`).toString('base64')}`;

        try {
            const response: AxiosResponse<T> = await this.client.request({
                ...config,
                headers: {
                    ...config.headers,
                    'APIKey': effectiveKey,
                    'APISecret': effectiveSecret,
                    'Authorization': authHeader,
                }
            });
            return response.data;
        } catch (error: any) {
             if (error.response) {
                console.error(`[Cloudstick API] Request failed: ${config.method} ${config.url}`, error.response.data);
                throw new Error(JSON.stringify(error.response.data));
            }
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. Server Discovery & Actions
    // ═══════════════════════════════════════════════════════════════════════════

    /** List all servers for a user */
    public async listServersByUser(userId: string) {
        return this.request({ method: 'GET', url: `/serverslist/byuser/users/${userId}` });
    }

    /** Get full server details by ID */
    public async getServerDetails(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/servers/${serverId}/users/${userId}` });
    }

    /** Get server activity log */
    public async getServerActivity(serverId: string, userId: string, params?: { page?: number; limit?: number; search?: string; status?: string; activity_type?: string; duration?: string }) {
        return this.request({ method: 'GET', url: `/activity/servers/${serverId}/users/${userId}`, params });
    }

    /** List all websites for a specific server */
    public async listWebsitesByServer(
        serverId: string,
        userId: string,
        params?: { page?: number; limit?: number; search?: string; status?: string; website_type?: string }
    ) {
        return this.request({ method: 'GET', url: `/list/websites/servers/${serverId}/users/${userId}`, params });
    }

    /** List website subdomains */
    public async listWebsiteSubdomains(
        websiteId: string,
        serverId: string,
        userId: string,
        params?: { page?: number; limit?: number; search?: string; status?: string; website_type?: string }
    ) {
        return this.request({ method: 'GET', url: `/list/website-subdomain/websites/${websiteId}/servers/${serverId}/users/${userId}`, params });
    }

    /** Reboot a server */
    public async rebootServer(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/reboot/servers/${serverId}/users/${userId}` });
    }

    /** Change PHP version at website level */
    public async changePhpVersion(websiteId: string, serverId: string, userId: string, phpVersion: string) {
        return this.request({
            method: 'PATCH',
            url: `/changephp/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data: { php_version: phpVersion }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. Database Provisioning (App Databases)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Create database & initial user */
    public async createDatabaseWithUser(
        websiteId: string,
        serverId: string,
        userId: string,
        data: {
            database: { db_name: string; db_collation?: string };
            db_user: { db_user_name: string; password: string; privileges: string[] };
        }
    ) {
        return this.request({
            method: 'POST',
            url: `/appdatabase/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    /** Assign existing user to database */
    public async assignUserToDatabase(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { database_id: number; db_user_id: number; privileges: string[] }
    ) {
        return this.request({
            method: 'POST',
            url: `/appdatabase/assignusers/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. WordPress Lifecycle Management
    // ═══════════════════════════════════════════════════════════════════════════

    /** Create WordPress admin/user */
    public async createWpUser(
        managerId: string,
        serverId: string,
        userId: string,
        data: { user_name: string; email: string; role: string; password: string }
    ) {
        return this.request({
            method: 'POST',
            url: `/wordpress/wpusers/${managerId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    /** Manage plugins (enable/disable/update) */
    public async managePlugins(
        managerId: string,
        serverId: string,
        userId: string,
        actionType: string,
        data: { plugin_name: string[] }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/wordpress/wpusers/${managerId}/plugins/servers/${serverId}/users/${userId}?action=${actionType}`,
            data
        });
    }

    /** Toggle maintenance mode (note: API uses "maintanance" spelling) */
    public async toggleMaintenanceMode(
        managerId: string,
        serverId: string,
        userId: string,
        enabled: boolean
    ) {
        return this.request({
            method: 'PATCH',
            url: `/wordpress/manager/maintanance/${managerId}/servers/${serverId}/users/${userId}`,
            data: { maintanance_enabled: enabled }
        });
    }

    /** Update WordPress core version */
    public async updateWpCoreVersion(
        managerId: string,
        serverId: string,
        userId: string,
        actionType: string
    ) {
        return this.request({
            method: 'PATCH',
            url: `/wordpress/manager/version/${managerId}/servers/${serverId}/users/${userId}?type=${actionType}`,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. Domain & Security Operations
    // ═══════════════════════════════════════════════════════════════════════════

    /** Add domain to website */
    public async addDomain(
        websiteId: string,
        serverId: string,
        userId: string,
        domains: string[],
        requireSsl?: boolean
    ) {
        return this.request({
            method: 'PATCH',
            url: `/adddomain/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            params: requireSsl !== undefined ? { require_ssl: requireSsl } : undefined,
            data: { domains }
        });
    }

    /** Apply security headers */
    public async applySecurityHeaders(
        websiteId: string,
        serverId: string,
        userId: string,
        data: {
            cj_protection?: boolean;
            xss_protection?: boolean;
            ms_protection?: boolean;
            permissions_policy?: boolean;
            content_security_policy?: boolean;
            referrer_policy?: boolean;
            cross_origin_opener_policy?: boolean;
        }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/changesecurity/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Plans (from earlier Insomnia dump)
    // ═══════════════════════════════════════════════════════════════════════════

    public async createPlan(userId: string, data: { plan_id: number; name: string; description: string; monthly_price: number; yearly_price: number; backup_storage_value: number; backup_storage_unit: string; features?: any }) {
        return this.request({ method: 'POST', url: `/cloudstickplans/users/${userId}`, data });
    }

    public async listPlans(userId: string) {
        return this.request({ method: 'GET', url: `/listcloudstickplans/users/${userId}` });
    }

    public async getPlan(planId: string) {
        return this.request({ method: 'GET', url: `/cloudstickplan/${planId}` });
    }

    public async updatePlan(planId: string, userId: string, data: { features: string[] }) {
        return this.request({ method: 'PATCH', url: `/cloudstickplan/${planId}/users/${userId}`, data });
    }

    public async deletePlan(planId: string, data?: { changed_plan_id: string }) {
        let url = `/cloudstickplan/${planId}`;
        if (data && data.changed_plan_id) {
            url += `?changed_plan_id=${data.changed_plan_id}`;
        }
        return this.request({ method: 'DELETE', url });
    }

    public async addPlanFeature(planId: string, userId: string, data: { features: string[] }) {
        return this.request({ method: 'POST', url: `/cloudstickplan/${planId}/feature/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // User Logs (from earlier Insomnia dump)
    // ═══════════════════════════════════════════════════════════════════════════

    public async getUserLoginEntries(userId: string) {
        return this.request({ method: 'GET', url: `/users/${userId}/login-entries/` });
    }

    public async getUserAccountActivity(userId: string) {
        return this.request({ method: 'GET', url: `/users/${userId}/account-activity/` });
    }

    public async getAdminLoginEntries(userId: string, adminId: string) {
        return this.request({ method: 'GET', url: `/users/${userId}/login-entries/admin/${adminId}` });
    }

    public async getAdminAccountActivity(userId: string) {
        return this.request({ method: 'GET', url: `/users/${userId}/account-activity/admin/` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. SSL Certificate Management (official v2)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Issue free SSL (Let's Encrypt) */
    public async issueSSL(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { authorisation: string; access: string; brotli_enabled?: boolean }
    ) {
        return this.request({
            method: 'POST',
            url: `/ssl/free-certificate/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    /** Update SSL settings (Force HTTPS / TLS / Ciphers) */
    public async updateSSLSettings(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { brotli_enabled?: boolean; access?: string; tls_version?: string; cipher_suite?: string }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/ssl/update-certificate-settings/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    /** Remove SSL certificate */
    public async deleteSSL(websiteId: string, serverId: string, userId: string) {
        return this.request({
            method: 'DELETE',
            url: `/ssl/remove-certificate/websites/${websiteId}/servers/${serverId}/users/${userId}`,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. Email Account Provisioning (official v2)
    // ═══════════════════════════════════════════════════════════════════════════

    /** List email accounts */
    public async listEmailAccounts(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/email/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Create email account */
    public async createEmailAccount(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { name: string; password: string; quota_type?: string; quota_value?: number; quota_unit?: string }
    ) {
        return this.request({
            method: 'POST',
            url: `/email/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    /** Update email password */
    public async updateEmailPassword(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { name: string; password: string }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/email/password/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. System User Access — SSH/SFTP (official v2)
    // ═══════════════════════════════════════════════════════════════════════════

    /** List system users */
    public async listSystemUsers(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/systemuser/servers/${serverId}/users/${userId}` });
    }

    /** Create system user */
    public async createSystemUser(serverId: string, userId: string, data: { name: string; password: string }) {
        return this.request({ method: 'POST', url: `/systemuser/servers/${serverId}/users/${userId}`, data });
    }

    /** Update system user password */
    public async updateSystemUser(sysUserId: string, serverId: string, userId: string, data: { password: string; confirm_password: string }) {
        return this.request({ method: 'PATCH', url: `/systemuser/${sysUserId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Delete system user */
    public async deleteSystemUser(sysUserId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/systemuser/${sysUserId}/servers/${serverId}/users/${userId}` });
    }

    /** Update sudo permission for a system user (confirmed in Insomnia) */
    public async updateSudoPermission(sysUserId: string, serverId: string, userId: string, data: { sudo_permission: boolean }) {
        return this.request({ method: 'PATCH', url: `/sudo-permission/systemuser/${sysUserId}/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7b. Server-Level Database Management (confirmed in Insomnia)
    // ═══════════════════════════════════════════════════════════════════════════

    /** List all database users at server level (confirmed in Insomnia) */
    public async listServerDatabaseUsers(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/database/db-user/list/servers/${serverId}/users/${userId}` });
    }

    /** Grant privileges to a database user (confirmed in Insomnia) */
    public async grantDatabasePrivilege(serverId: string, userId: string, data: { database_id: number; db_user_id: number; privileges: string[] }) {
        return this.request({ method: 'PATCH', url: `/database/grantedprivilege/servers/${serverId}/users/${userId}`, data });
    }

    /** Revoke privileges from a database user (confirmed in Insomnia) */
    public async revokeDatabasePrivilege(serverId: string, userId: string, data: { database_id: number; db_user_id: number; privileges: string[] }) {
        return this.request({ method: 'PATCH', url: `/database/revokeprivilege/servers/${serverId}/users/${userId}`, data });
    }

    /** Remove a database user from a database (confirmed in Insomnia) */
    public async removeUserFromDatabase(serverId: string, userId: string, data: { database_id: number; db_user_id: number }) {
        return this.request({ method: 'DELETE', url: `/database/removeuser/servers/${serverId}/users/${userId}`, data });
    }

    /** Delete email account (confirmed in Insomnia) */
    public async deleteEmailAccount(websiteId: string, serverId: string, userId: string, data: { name: string }) {
        return this.request({ method: 'DELETE', url: `/email/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Delete email forward (confirmed in Insomnia) */
    public async deleteEmailForward(websiteId: string, serverId: string, userId: string, params: { name: string; forwardemail: string }) {
        return this.request({ method: 'DELETE', url: `/email/forward/websites/${websiteId}/servers/${serverId}/users/${userId}`, params });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 26b. Server-Level Cron Jobs (confirmed in Insomnia)
    // ═══════════════════════════════════════════════════════════════════════════

    /** List server-level cron jobs */
    public async listServerCronJobs(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/cron/servers/${serverId}/users/${userId}` });
    }

    /** Create a server-level cron job */
    public async createServerCronJob(serverId: string, userId: string, data: {
        user_name: string;
        label: string;
        binary: string;
        path: string;
        schedule: string;
    }) {
        return this.request({ method: 'POST', url: `/cron/servers/${serverId}/users/${userId}`, data });
    }

    /** Update a server-level cron job by ID */
    public async updateServerCronJob(cronId: string, serverId: string, userId: string, data: { schedule?: string; label?: string }) {
        return this.request({ method: 'PATCH', url: `/cron/${cronId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Delete a server-level cron job by ID */
    public async deleteServerCronJob(cronId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/cron/${cronId}/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. Team Collaboration & Access (official v2)
    // ═══════════════════════════════════════════════════════════════════════════

    /** List user's teams */
    public async listTeams(userId: string) {
        return this.request({ method: 'GET', url: `/teams/users/${userId}` });
    }

    /** Create team */
    public async createTeam(userId: string, data: { name: string; members: string[]; servers: number[] }) {
        return this.request({ method: 'POST', url: `/team/users/${userId}`, data });
    }

    /** Add member to existing team */
    public async addTeamMember(teamId: string, userId: string, data: { members: string[] }) {
        return this.request({ method: 'PATCH', url: `/team/${teamId}/add-user/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Legacy stubs — no v2 docs provided yet.
    // TODO: Replace once backend team confirms v2 paths.
    // ═══════════════════════════════════════════════════════════════════════════

    // > Database Users (legacy)
    public async listDatabaseUsers(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/appdbusers/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }
    public async createDatabaseUser(websiteId: string, serverId: string, userId: string, data: { username: string; password: string }) {
        return this.request({ method: 'POST', url: `/appdbusers/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }
    public async deleteDatabaseUser(dbUserId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/appdbusers/${dbUserId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }
    public async updateDatabaseUser(dbUserId: string, websiteId: string, serverId: string, userId: string, data: { password?: string }) {
        return this.request({ method: 'PATCH', url: `/appdbusers/${dbUserId}/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    // > Databases (legacy)
    public async listDatabases(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/appdatabase/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }
    public async createDatabase(websiteId: string, serverId: string, userId: string, data: { name: string }) {
        return this.request({ method: 'POST', url: `/appdatabase/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }
    public async deleteDatabase(dbId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/appdatabase/${dbId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Cron Jobs (legacy)
    public async listCronJobs(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/cronjobs/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }
    public async createCronJob(websiteId: string, serverId: string, userId: string, data: { command: string; schedule: string }) {
        return this.request({ method: 'POST', url: `/cronjobs/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }
    public async deleteCronJob(cronId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/cronjobs/${cronId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > SSL Status (legacy — no v2 equivalent provided)
    public async getSSLStatus(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/ssl/status/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > PHP (legacy — getPhpVersion and switchPhpVersion kept for downstream tools)
    public async getPhpVersion(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/php/version/${websiteId}/servers/${serverId}/users/${userId}` });
    }
    public async switchPhpVersion(websiteId: string, serverId: string, userId: string, data: { php_version: string }) {
        return this.request({ method: 'POST', url: `/php/switch/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. WordPress Management
    // ═══════════════════════════════════════════════════════════════════════════

    /** Get WordPress site details */
    public async getWordpressDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/details/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress plugin count */
    public async getWpPluginCount(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/plugins/count/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress version */
    public async getWpVersion(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/version/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress users */
    public async getWpUsers(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/wpusers/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress users count */
    public async getWpUsersCount(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/users/count/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress magic login link */
    public async getWpMagicLink(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/magiclink/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress site URLs */
    public async getWpUrls(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/urls/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Update WordPress site URLs */
    public async updateWpUrls(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { home_url?: string; site_url?: string }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/wordpress/manager/urls/${websiteId}/servers/${serverId}/users/${userId}`,
            data,
        });
    }

    /** Get WordPress debug configuration */
    public async getWpDebugInfo(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/debug/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Update WordPress debug configuration */
    public async updateWpDebugInfo(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { debug_enabled: boolean; debug_log?: boolean; debug_display?: boolean; debug_log_path?: string }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/wordpress/manager/debug/${websiteId}/servers/${serverId}/users/${userId}`,
            data,
        });
    }

    /** Toggle WordPress maintenance mode */
    public async toggleWpMaintenanceMode(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/wordpress/manager/maintanance/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress maintenance mode */
    public async getWpMaintenanceMode(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/maintanance/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Update WordPress maintenance mode */
    public async updateWpMaintenanceMode(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { maintanance_enabled: boolean }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/wordpress/manager/maintanance/${websiteId}/servers/${serverId}/users/${userId}`,
            data,
        });
    }

    /** Toggle WordPress debug mode */
    public async toggleWpDebugMode(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/wordpress/manager/debug/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Update WordPress search index */
    public async updateWpSearchIndex(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/wordpress/manager/searchindex/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WordPress search index mode */
    public async getWpSearchIndexMode(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/searchindex/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Update WordPress search index mode */
    public async updateWpSearchIndexMode(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { search_index_enabled: boolean }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/wordpress/manager/searchindex/${websiteId}/servers/${serverId}/users/${userId}`,
            data,
        });
    }

    /** List WordPress plugins for a site */
    public async listWpPlugins(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/wpusers/${websiteId}/plugins/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 10. Website Management (suspend, rebuild, settings)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Suspend a website */
    public async suspendWebsite(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/suspend/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Unsuspend a website */
    public async unsuspendWebsite(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/unsuspend/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Rebuild a website */
    public async rebuildWebsite(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/rebuild/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Change website stack type (e.g. nginx, apache) */
    public async changeStackType(websiteId: string, serverId: string, userId: string, data: { stack_type: string }) {
        return this.request({ method: 'PATCH', url: `/changestack/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Change website PHP config */
    public async changePhpConfig(websiteId: string, serverId: string, userId: string, data: Record<string, unknown>) {
        return this.request({ method: 'PATCH', url: `/changephpconfig/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Change website public path */
    public async changePublicPath(websiteId: string, serverId: string, userId: string, data: { public_path: string }) {
        return this.request({ method: 'PATCH', url: `/changepublicpath/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Get website activity log */
    public async getWebsiteActivityLogs(
        websiteId: string,
        serverId: string,
        userId: string,
        params?: { limit?: number; offset?: number }
    ) {
        return this.request({
            method: 'GET',
            url: `/nginx-logs/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            params,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 26. Supervisor Jobs (confirmed in Insomnia)
    // ═══════════════════════════════════════════════════════════════════════════

    /** List server-level supervisor jobs */
    public async listSupervisorJobs(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/svjobs/servers/${serverId}/users/${userId}` });
    }

    /** List website-level supervisor jobs */
    public async listWebsiteSupervisorJobs(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/svjobs/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Create a server-level supervisor job */
    public async createSupervisorJob(serverId: string, userId: string, data: {
        job_name: string;
        command: string;
        username: string;
        num_procs?: number;
        directory?: string;
        auto_start?: boolean;
        auto_restart?: boolean;
    }) {
        return this.request({ method: 'POST', url: `/svjobs/servers/${serverId}/users/${userId}`, data });
    }

    /** Create a website-level supervisor job */
    public async createWebsiteSupervisorJob(websiteId: string, serverId: string, userId: string, data: {
        job_name: string;
        command: string;
        username: string;
        num_procs?: number;
        directory?: string;
        auto_start?: boolean;
        auto_restart?: boolean;
    }) {
        return this.request({ method: 'POST', url: `/svjobs/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Rebuild server-level supervisor jobs */
    public async rebuildSupervisorJobs(serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/svjobs/rebuild/servers/${serverId}/users/${userId}` });
    }

    /** Rebuild all server-level supervisor jobs */
    public async rebuildAllSupervisorJobs(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/svjobs/rebuildall/servers/${serverId}/users/${userId}` });
    }

    /** Handle (start/stop) a supervisor job */
    public async handleSupervisorJob(serverId: string, userId: string, data: { name: string; action: string }) {
        return this.request({ method: 'PATCH', url: `/svjobs/handle/servers/${serverId}/users/${userId}`, data });
    }

    /** Delete a server-level supervisor job by job name */
    public async deleteSupervisorJob(jobName: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/svjobs/${encodeURIComponent(jobName)}/servers/${serverId}/users/${userId}` });
    }

    /** Delete a website-level supervisor job */
    public async deleteWebsiteSupervisorJob(jobName: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/svjobs/${encodeURIComponent(jobName)}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Rebuild website-level supervisor jobs */
    public async rebuildWebsiteSupervisorJobs(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/svjobs/rebuild/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 27. Backups (confirmed in Insomnia)
    // ═══════════════════════════════════════════════════════════════════════════

    /** List user-level backups */
    public async listUserBackups(userId: string) {
        return this.request({ method: 'GET', url: `/backup/users/${userId}` });
    }

    /** List website backups */
    public async listWebsiteBackups(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/backup/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** List database backups */
    public async listDatabaseBackups(databaseId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/backup/databases/${databaseId}/servers/${serverId}/users/${userId}` });
    }

    /** Enable or update website backup */
    public async enableWebsiteBackup(
        websiteId: string,
        serverId: string,
        userId: string,
        data: { backup_period: string; is_full_backup?: boolean; success_backup_email?: boolean; failed_backup_email?: boolean }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/backup/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data,
        });
    }

    /** Disable website backup */
    public async disableWebsiteBackup(websiteId: string, serverId: string, userId: string) {
        return this.request({
            method: 'PATCH',
            url: `/backup/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data: { backup_period: '', is_full_backup: false },
        });
    }

    /** Enable or update database backup */
    public async enableDatabaseBackup(
        databaseId: string,
        serverId: string,
        userId: string,
        data: { backup_period: string; success_backup_email?: boolean; failed_backup_email?: boolean }
    ) {
        return this.request({
            method: 'PATCH',
            url: `/backup/databases/${databaseId}/servers/${serverId}/users/${userId}`,
            data,
        });
    }

    /** Disable database backup */
    public async disableDatabaseBackup(databaseId: string, serverId: string, userId: string) {
        return this.request({
            method: 'PATCH',
            url: `/backup/databases/${databaseId}/servers/${serverId}/users/${userId}`,
            data: { backup_period: '' },
        });
    }

    /** Create a manual website backup */
    public async createManualWebsiteBackup(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/backup/manual/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Create a manual database backup */
    public async createManualDatabaseBackup(databaseId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/backup/manual/databases/${databaseId}/servers/${serverId}/users/${userId}` });
    }

    /** Restore a website backup by file ID */
    public async restoreWebsiteBackup(fileId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/backup/restore/files/${fileId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Restore a database backup by file ID */
    public async restoreDatabaseBackup(fileId: string, databaseId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/backup/restore/files/${fileId}/databases/${databaseId}/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 28. Extended File Operations (confirmed in Insomnia)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Rename a file or directory */
    public async renameFile(websiteId: string, serverId: string, userId: string, data: { path: string; name: string; new_name: string }) {
        return this.request({ method: 'PATCH', url: `/files/rename/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Move a file or directory */
    public async moveFile(websiteId: string, serverId: string, userId: string, data: { path: string; name: string; new_path: string }) {
        return this.request({ method: 'PATCH', url: `/files/move/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Copy a file or directory */
    public async copyFile(websiteId: string, serverId: string, userId: string, data: { path: string; name: string; new_name?: string }) {
        return this.request({ method: 'POST', url: `/files/copy/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Change file permissions (chmod) */
    public async changeFilePermissions(websiteId: string, serverId: string, userId: string, data: { path: string; name: string; permissions: string }) {
        return this.request({ method: 'PATCH', url: `/files/permission/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Get a panel-managed NGINX config file */
    public async getWebsiteNginxConfigFile(
        websiteId: string,
        serverId: string,
        userId: string,
        configFile: string
    ) {
        return this.request({
            method: 'GET',
            url: `/nginx/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            params: { config_file: configFile },
        });
    }

    /** Update a panel-managed NGINX config file */
    public async updateWebsiteNginxConfigFile(
        websiteId: string,
        serverId: string,
        userId: string,
        configFile: string,
        content: string
    ) {
        return this.request({
            method: 'PATCH',
            url: `/nginx/websites/${websiteId}/servers/${serverId}/users/${userId}`,
            data: { config_file: configFile, content },
        });
    }

    /** Remove domain from website */
    public async removeDomain(websiteId: string, serverId: string, userId: string, data?: { domain?: string }) {
        return this.request({ method: 'DELETE', url: `/removedomain/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 11. Cloudflare DNS Management
    // ═══════════════════════════════════════════════════════════════════════════

    /** List Cloudflare zones */
    public async listCloudflareZones(userId: string, params?: { account_label?: string; page?: number; limit?: number; search?: string }) {
        return this.request({ method: 'GET', url: `/listzones/users/${userId}`, params });
    }

    /** List Cloudflare accounts for user */
    public async listCloudflareAccounts(userId: string) {
        return this.request({ method: 'GET', url: `/listcloudflareproviders/users/${userId}` });
    }

    /** List DNS records */
    public async listDnsRecords(userId: string, params?: { account_label?: string; zone?: string; type?: string; page?: number; limit?: number; search?: string }) {
        return this.request({ method: 'GET', url: `/dnsrecords/users/${userId}`, params });
    }

    /** Create DNS record */
    public async createDnsRecord(userId: string, data: { account_label: string; zone: string; type: string; name: string; content: string; ttl?: number; proxied?: boolean }) {
        return this.request({ method: 'POST', url: `/dnsrecords/users/${userId}`, data });
    }

    /** Create Cloudflare zone */
    public async createCloudflareZone(userId: string, data: { account_label: string; domain: string }) {
        return this.request({ method: 'POST', url: `/createzone/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 12. Email (extended)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Update email account quota */
    public async updateEmailQuota(websiteId: string, serverId: string, userId: string, data: { quota: number }) {
        return this.request({ method: 'PATCH', url: `/email/quota/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Forward email */
    public async forwardEmail(websiteId: string, serverId: string, userId: string, data: { name: string; forwardemail: string }) {
        return this.request({ method: 'POST', url: `/email/forward/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** List forwarded emails */
    public async listForwardedEmails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/email/forward/list/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get email configuration */
    public async getEmailConfig(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/email/configure/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Set email configuration */
    public async setEmailConfig(websiteId: string, serverId: string, userId: string, data: Record<string, unknown>) {
        return this.request({ method: 'POST', url: `/email/setconfig/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 13. MySQL Management
    // ═══════════════════════════════════════════════════════════════════════════

    /** Get MySQL remote access status */
    public async getMysqlRemoteAccessStatus(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/status/mysql/servers/${serverId}/users/${userId}` });
    }

    /** Update MySQL root password */
    public async updateMysqlRootPassword(serverId: string, userId: string, data: { password: string; confirm_password: string }) {
        return this.request({ method: 'PATCH', url: `/mysql-password/servers/${serverId}/users/${userId}`, data });
    }

    /** Toggle MySQL remote access */
    public async toggleMysqlRemoteAccess(serverId: string, userId: string, data: { remote_access: boolean }) {
        return this.request({ method: 'PATCH', url: `/mysql-access/remote/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 14. App Details (read-only)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Get CustomPHP details */
    public async getCustomPhpDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/customphp/details/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get Laravel details */
    public async getLaravelDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/laravel/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** View Laravel .env file */
    public async viewLaravelEnv(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/laravel/view-envfile/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Edit Laravel .env file */
    public async editLaravelEnv(websiteId: string, serverId: string, userId: string, data: { env_content: string }) {
        return this.request({ method: 'PATCH', url: `/laravel/edit-envfile/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Get ProxyApp details */
    public async getProxyAppDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/proxyapp/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get WooCommerce details */
    public async getWooCommerceDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/woocommerce/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get Joomla details */
    public async getJoomlaDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/joomla/details/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get Moodle details */
    public async getMoodleDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/moodle/details/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get Prestashop details */
    public async getPrestashopDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/prestashop/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get PHPMyAdmin details */
    public async getPhpMyAdminDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/phpmyadmin/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get Roundcube Webmail details */
    public async getRoundcubeDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/roundcubewebmail/details/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Get MediaWiki details */
    public async getMediaWikiDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/mediawiki/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 15. Third-Party Integrations
    // ═══════════════════════════════════════════════════════════════════════════

    /** List third-party integrations */
    public async listThirdPartyIntegrations(userId: string) {
        return this.request({ method: 'GET', url: `/thirdpartyintegrations/users/${userId}` });
    }

    /** Create third-party integration */
    public async createThirdPartyIntegration(userId: string, data: { label: string; username: string; service: string; secret_key: string }) {
        return this.request({ method: 'POST', url: `/thirdpartyintegrations/users/${userId}`, data });
    }

    /** Update third-party integration */
    public async updateThirdPartyIntegration(integrationId: string, userId: string, data: { secret_key?: string }) {
        return this.request({ method: 'PATCH', url: `/thirdpartyintegrations/${integrationId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 16. Firewall & Security — TODO: confirm Cloudstick endpoint
    // ═══════════════════════════════════════════════════════════════════════════

    /** Get firewall status */
    // TODO: confirm Cloudstick endpoint
    public async getFirewallStatus(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/firewall/status/servers/${serverId}/users/${userId}` });
    }

    /** Manage brute force shield */
    // TODO: confirm Cloudstick endpoint
    public async manageBruteForceShield(serverId: string, userId: string, action: string) {
        return this.request({ method: 'POST', url: `/firewall/bruteforce/${action}/servers/${serverId}/users/${userId}` });
    }

    /** Manage IP rule (whitelist, block, unblock, etc.) */
    // TODO: confirm Cloudstick endpoint
    public async manageIpRule(serverId: string, userId: string, data: { ip: string; action: string }) {
        return this.request({ method: 'POST', url: `/firewall/ip-rule/servers/${serverId}/users/${userId}`, data });
    }

    /** Add temporary IP rule */
    // TODO: confirm Cloudstick endpoint
    public async addTemporaryIpRule(serverId: string, userId: string, data: { ip: string; action: string; duration: string }) {
        return this.request({ method: 'POST', url: `/firewall/temp-rule/servers/${serverId}/users/${userId}`, data });
    }

    /** List temporary IP rules */
    // TODO: confirm Cloudstick endpoint
    public async listTemporaryIpRules(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/firewall/temp-rules/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 17. PHP Extensions & CLI — TODO: confirm Cloudstick endpoint
    // ═══════════════════════════════════════════════════════════════════════════

    /** Manage PHP extension (enable/disable) */
    // TODO: confirm Cloudstick endpoint
    public async managePhpExtension(websiteId: string, serverId: string, userId: string, data: { extension: string; action: string }) {
        return this.request({ method: 'PATCH', url: `/php/extension/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Change PHP CLI version */
    // TODO: confirm Cloudstick endpoint
    public async changePhpCliVersion(serverId: string, userId: string, data: { php_version: string }) {
        return this.request({ method: 'PATCH', url: `/php/cli-version/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 18. Service Control — TODO: confirm Cloudstick endpoint
    // ═══════════════════════════════════════════════════════════════════════════

    /** Manage system service (start/stop/restart/status) */
    // TODO: confirm Cloudstick endpoint
    public async manageService(serverId: string, userId: string, data: { service: string; action: string; port?: number }) {
        return this.request({ method: 'POST', url: `/service/${data.action}/servers/${serverId}/users/${userId}`, data });
    }

    /** Get service status */
    // TODO: confirm Cloudstick endpoint
    public async getServiceStatus(serverId: string, userId: string, service: string) {
        return this.request({ method: 'GET', url: `/service/status/${service}/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 19. Server Settings — timezone, cleanup, hostname, auto-update
    // ═══════════════════════════════════════════════════════════════════════════

    /** Configure server timezone */
    // TODO: confirm Cloudstick endpoint
    public async configureTimezone(serverId: string, userId: string, data: { timezone: string }) {
        return this.request({ method: 'PATCH', url: `/timezone/servers/${serverId}/users/${userId}`, data });
    }

    /** Run server cleanup */
    // TODO: confirm Cloudstick endpoint
    public async cleanupServer(serverId: string, userId: string, data: { target: string; log_retention_period?: string }) {
        return this.request({ method: 'POST', url: `/cleanup/servers/${serverId}/users/${userId}`, data });
    }

    /** Get server hostname (confirmed: GET /hostname/servers/{s}/users/{u}) */
    public async getHostname(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/hostname/servers/${serverId}/users/${userId}` });
    }

    /** Set server hostname (confirmed: POST /hostname/servers/{s}/users/{u}) */
    public async setHostname(serverId: string, userId: string, data: { hostname: string }) {
        return this.request({ method: 'POST', url: `/hostname/servers/${serverId}/users/${userId}`, data });
    }

    /** Run auto-update */
    // TODO: confirm Cloudstick endpoint
    public async runAutoUpdate(serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/autoupdate/servers/${serverId}/users/${userId}` });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 20. Website Management — maintenance mode, subdomain
    // ═══════════════════════════════════════════════════════════════════════════

    /** Set maintenance mode for a website (non-WordPress) */
    // TODO: confirm Cloudstick endpoint
    public async setMaintenanceMode(websiteId: string, serverId: string, userId: string, data: { enabled: boolean }) {
        return this.request({ method: 'PATCH', url: `/maintenance/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Add subdomain to a website */
    // TODO: confirm Cloudstick endpoint — subdomains use WebSocket per app type in Insomnia
    public async addSubdomain(websiteId: string, serverId: string, userId: string, data: { subdomain: string }) {
        return this.request({ method: 'POST', url: `/subdomain/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    /** Renew free SSL certificate (confirmed: POST /ssl/free-certificate/renew/websites/{w}/servers/{s}/users/{u}) */
    public async renewFreeSSL(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/ssl/free-certificate/renew/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    /** Revoke/remove SSL (alias for deleteSSL, included for semantic clarity) */
    public async revokeSSL(websiteId: string, serverId: string, userId: string) {
        return this.deleteSSL(websiteId, serverId, userId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 21. WordPress Site Creation — TODO: confirm REST vs WebSocket
    // ═══════════════════════════════════════════════════════════════════════════

    /** Create a WordPress site (Insomnia shows WebSocket; trying REST POST fallback) */
    // TODO: confirm Cloudstick endpoint — Insomnia uses ws://*/wordpress/servers/{s}/users/{u}
    public async createWordPressSite(serverId: string, userId: string, data: {
        email: string; website_name: string; domain: string; site_title: string;
        admin_username: string; admin_password: string; admin_email: string;
        php_version: string; web_app_server: string; account_label?: string;
    }) {
        return this.request({ method: 'POST', url: `/wordpress/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 22. Custom PHP Site Creation — TODO: confirm REST vs WebSocket
    // ═══════════════════════════════════════════════════════════════════════════

    /** Create a custom PHP site (Insomnia shows WebSocket; trying REST POST fallback) */
    // TODO: confirm Cloudstick endpoint — Insomnia uses ws://*/customphp/servers/{s}/users/{u}
    public async createCustomPhpSite(serverId: string, userId: string, data: {
        email: string; website_name: string; domain_type: string; domain_name: string;
        php_version: string; web_app_server: string;
        clickjacking_protection?: boolean; xss_protection?: boolean; mime_sniffing_protection?: boolean;
        account_label?: string;
    }) {
        return this.request({ method: 'POST', url: `/customphp/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 23. Webmail — confirmed from Insomnia
    // ═══════════════════════════════════════════════════════════════════════════

    /** Enable webmail (Roundcube) for a website */
    // TODO: confirm REST endpoint — Insomnia uses ws://*/roundcubewebmail/subdomain/websites/{w}/servers/{s}/users/{u}
    public async enableWebmail(websiteId: string, serverId: string, userId: string, data?: { account_label?: string }) {
        return this.request({ method: 'POST', url: `/roundcubewebmail/subdomain/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 24. File Manager — TODO: confirm Cloudstick endpoint
    // ═══════════════════════════════════════════════════════════════════════════

    /** Upload a file to the server */
    // TODO: confirm Cloudstick endpoint
    public async uploadFile(serverId: string, userId: string, data: { destination_path: string; file_content: string; file_name: string }) {
        return this.request({ method: 'POST', url: `/filemanager/upload/servers/${serverId}/users/${userId}`, data });
    }

    /** Create an empty file */
    // TODO: confirm Cloudstick endpoint
    public async createFile(serverId: string, userId: string, data: { path: string; file_name: string }) {
        return this.request({ method: 'POST', url: `/filemanager/create-file/servers/${serverId}/users/${userId}`, data });
    }

    /** Create a folder */
    // TODO: confirm Cloudstick endpoint
    public async createFolder(serverId: string, userId: string, data: { path: string; folder_name: string }) {
        return this.request({ method: 'POST', url: `/filemanager/create-folder/servers/${serverId}/users/${userId}`, data });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 25. FTP Account Management — TODO: confirm Cloudstick endpoint
    // ═══════════════════════════════════════════════════════════════════════════

    /** Create FTP account */
    // TODO: confirm Cloudstick endpoint
    public async createFtpAccount(serverId: string, userId: string, data: { ftp_username: string; ftp_password: string; directory: string }) {
        return this.request({ method: 'POST', url: `/ftp/servers/${serverId}/users/${userId}`, data });
    }
}

// Export lazy singleton — only instantiated on first use, not at import time.
// This prevents startup crashes when Cloudstick env vars aren't configured.
let _instance: CloudstickApiClient | null = null;
export function getCloudstickClient(): CloudstickApiClient {
    if (!_instance) {
        _instance = new CloudstickApiClient();
    }
    return _instance;
}
