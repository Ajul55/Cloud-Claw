import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { env } from '../config/env.js';

export class CloudstickApiClient {
    private client: AxiosInstance;
    private jwtToken: string | null = null;
    private tokenExpiryMs: number = 0;

    constructor() {
        if (!env.CLOUDSTICK_API_BASE) {
            throw new Error('CLOUDSTICK_API_BASE is required');
        }
        
        this.client = axios.create({
            baseURL: `${env.CLOUDSTICK_API_BASE}/api/v1`,
            headers: {
                'App-Type': 'application/json',
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Core request wrapper using API Key + Secret authentication
     */
    public async request<T = any>(config: AxiosRequestConfig): Promise<T> {
        if (!env.CLOUDSTICK_API_KEY || !env.CLOUDSTICK_API_SECRET) {
            throw new Error('Cloudstick API_KEY and API_SECRET are required in .env');
        }

        try {
            const response: AxiosResponse<T> = await this.client.request({
                ...config,
                headers: {
                    ...config.headers,
                    // Cloudstick standard header names for Key and Secret
                    // Update these if Cloudstick requires different header names
                    'Authorization': `Bearer ${env.CLOUDSTICK_API_KEY}`,
                    'X-Api-Secret': env.CLOUDSTICK_API_SECRET,
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

    // ─── GET / LIST Endpoints (Phase 1) ────────────────────────────────────────

    // > Servers
    public async listServers(userId: string) {
        return this.request({ method: 'GET', url: `/serverslist/users/${userId}` });
    }
    
    public async listServersByUser(userId: string) {
        return this.request({ method: 'GET', url: `/serverslist/byuser/users/${userId}` });
    }

    public async getServerDetails(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/servers/${serverId}/users/${userId}` });
    }

    public async getServerActivity(serverId: string, userId: string, duration = '1Week', page = 1) {
        return this.request({ method: 'GET', url: `/activity/servers/${serverId}/users/${userId}?duration=${duration}&page=${page}` });
    }

    public async getActivityFilterTypes(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/list-activity/filter/servers/${serverId}/users/${userId}` });
    }

    // > Websites
    public async listWebsites(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/list/websites/servers/${serverId}/users/${userId}` });
    }

    public async listSubdomains(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/list/website-subdomain/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getSubdomainActivity(subId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/activity-log/website-subdomains/${subId}/servers/${serverId}/users/${userId}` });
    }

    // > Databases
    public async listDatabases(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/appdatabase/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async listDatabaseUsers(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/appdbusers/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async listDatabaseUserLinks(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/appdatabase/db-user/list/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getMysqlStatus(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/status/mysql/servers/${serverId}/users/${userId}` });
    }

    // > WordPress
    public async getWordpressDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/details/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getWordpressConfig(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/wpconfig/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getWordpressSearchIndex(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/wordpress/manager/searchindex/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Laravel
    public async getLaravelDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/laravel/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getLaravelEnv(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/laravel/view-envfile/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async customToLaravelConversion(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/customtolaravel/conversion/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Other Apps
    public async getWooCommerceDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/woocommerce/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getPrestashopDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/prestashop/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getMediaWikiDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/details/mediawiki/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Email
    public async listEmailAccounts(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/email/list/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getEmailConfig(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/email/configure/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Third-Party
    public async listIntegrations(userId: string) {
        return this.request({ method: 'GET', url: `/thirdpartyintegrations/users/${userId}` });
    }

    // > Teams
    public async listTeams(userId: string) {
        return this.request({ method: 'GET', url: `/teams/users/${userId}` });
    }

    public async listAllTeams(userId: string) {
        return this.request({ method: 'GET', url: `/all-teams/users/${userId}` });
    }

    public async listTeamServers(userId: string) {
        return this.request({ method: 'GET', url: `/team/list-servers/users/${userId}` });
    }

    // > Users
    public async listDeletedUsers() {
        return this.request({ method: 'GET', url: `/users/deleted/admin/list` });
    }

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

    // > Plans
    public async listPlans(userId: string) {
        return this.request({ method: 'GET', url: `/listcloudstickplans/users/${userId}` });
    }

    public async getPlan(planId: string) {
        return this.request({ method: 'GET', url: `/cloudstickplan/${planId}` });
    }

    // ─── PHASE 2: Safe Write Endpoints ────────────────────────────────────────

    // > Server Management
    public async renameServer(serverId: string, userId: string, newName: string) {
        return this.request({ method: 'POST', url: `/rename/servers/${serverId}/users/${userId}`, data: { name: newName } });
    }

    public async setTimezone(serverId: string, userId: string, timezone: string) {
        return this.request({ method: 'POST', url: `/timezone/servers/${serverId}/users/${userId}`, data: { timezone } });
    }

    public async setHostname(serverId: string, userId: string, hostname: string) {
        return this.request({ method: 'POST', url: `/hostname/servers/${serverId}/users/${userId}`, data: { hostname } });
    }

    public async editServerIp(serverId: string, userId: string, ip: string) {
        return this.request({ method: 'POST', url: `/editip/servers/${serverId}/users/${userId}`, data: { ip } });
    }

    // > Teams Management
    public async createTeam(userId: string, data: { name: string; description?: string }) {
        return this.request({ method: 'POST', url: `/teams/users/${userId}`, data });
    }

    public async updateTeam(teamId: string, userId: string, data: { name?: string; description?: string }) {
        return this.request({ method: 'PUT', url: `/teams/${teamId}/users/${userId}`, data });
    }

    public async deleteTeam(teamId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/teams/${teamId}/users/${userId}` });
    }

    public async addTeamMember(teamId: string, userId: string, memberId: string) {
        return this.request({ method: 'POST', url: `/teams/${teamId}/members/users/${userId}`, data: { member_id: memberId } });
    }

    public async removeTeamMember(teamId: string, memberId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/teams/${teamId}/members/${memberId}/users/${userId}` });
    }

    // > System User Management
    public async createSystemUser(serverId: string, userId: string, data: { username: string; password: string }) {
        return this.request({ method: 'POST', url: `/systemusers/servers/${serverId}/users/${userId}`, data });
    }

    public async updateSystemUser(sysUserId: string, serverId: string, userId: string, data: { password?: string }) {
        return this.request({ method: 'PUT', url: `/systemusers/${sysUserId}/servers/${serverId}/users/${userId}`, data });
    }

    public async deleteSystemUser(sysUserId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/systemusers/${sysUserId}/servers/${serverId}/users/${userId}` });
    }

    public async listSystemUsers(serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/systemusers/servers/${serverId}/users/${userId}` });
    }

    // > Database User Management
    public async createDatabaseUser(websiteId: string, serverId: string, userId: string, data: { username: string; password: string }) {
        return this.request({ method: 'POST', url: `/appdbusers/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async updateDatabaseUser(dbUserId: string, websiteId: string, serverId: string, userId: string, data: { password?: string }) {
        return this.request({ method: 'PUT', url: `/appdbusers/${dbUserId}/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async deleteDatabaseUser(dbUserId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/appdbusers/${dbUserId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async linkDatabaseUser(websiteId: string, serverId: string, userId: string, data: { db_id: string; db_user_id: string }) {
        return this.request({ method: 'POST', url: `/appdatabase/db-user/link/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async unlinkDatabaseUser(linkId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/appdatabase/db-user/unlink/${linkId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Email Account Management
    public async createEmail(websiteId: string, serverId: string, userId: string, data: { email: string; password: string }) {
        return this.request({ method: 'POST', url: `/email/create/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async updateEmail(emailId: string, websiteId: string, serverId: string, userId: string, data: { password?: string; quota?: number }) {
        return this.request({ method: 'PUT', url: `/email/${emailId}/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async deleteEmail(emailId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/email/${emailId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Config Updates (WordPress / Laravel)
    public async updateWordpressConfig(websiteId: string, serverId: string, userId: string, data: Record<string, unknown>) {
        return this.request({ method: 'POST', url: `/wordpress/manager/wpconfig/update/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async updateLaravelEnv(websiteId: string, serverId: string, userId: string, data: { content: string }) {
        return this.request({ method: 'POST', url: `/laravel/update-envfile/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    // ─── PHASE 3: Full API Surface Endpoints ──────────────────────────────────

    // > SSL Management
    public async issueSSL(websiteId: string, serverId: string, userId: string, data: { ssl_type?: string }) {
        return this.request({ method: 'POST', url: `/ssl/issue/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async renewSSL(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'POST', url: `/ssl/renew/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async deleteSSL(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/ssl/delete/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getSSLStatus(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/ssl/status/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async updateSSLSettings(websiteId: string, serverId: string, userId: string, data: Record<string, unknown>) {
        return this.request({ method: 'POST', url: `/ssl/settings/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    // > Database Management (create, delete)
    public async createDatabase(websiteId: string, serverId: string, userId: string, data: { name: string }) {
        return this.request({ method: 'POST', url: `/appdatabase/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async deleteDatabase(dbId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/appdatabase/${dbId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > PHP Version Switching (via Cloudstick API — Lane 1)
    public async switchPhpVersion(websiteId: string, serverId: string, userId: string, data: { php_version: string }) {
        return this.request({ method: 'POST', url: `/php/switch/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async getPhpVersion(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/php/version/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // > Website Management
    public async deleteWebsite(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async getWebsiteDetails(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    // ─── PHASE 4: Cron Job Management ─────────────────────────────────────────

    public async listCronJobs(websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'GET', url: `/cronjobs/websites/${websiteId}/servers/${serverId}/users/${userId}` });
    }

    public async createCronJob(websiteId: string, serverId: string, userId: string, data: { command: string; schedule: string }) {
        return this.request({ method: 'POST', url: `/cronjobs/websites/${websiteId}/servers/${serverId}/users/${userId}`, data });
    }

    public async deleteCronJob(cronId: string, websiteId: string, serverId: string, userId: string) {
        return this.request({ method: 'DELETE', url: `/cronjobs/${cronId}/websites/${websiteId}/servers/${serverId}/users/${userId}` });
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
