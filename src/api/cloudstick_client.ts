import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { env } from '../config/env.js';
import { getCloudstickUser } from './cloudstick_context.js';

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
        const effectiveKey = ctx?.cloudstick_api_key ?? this.apiKey;
        const effectiveSecret = ctx?.cloudstick_api_secret ?? this.apiSecret;

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
        domains: string[]
    ) {
        return this.request({
            method: 'PATCH',
            url: `/adddomain/websites/${websiteId}/servers/${serverId}/users/${userId}`,
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
