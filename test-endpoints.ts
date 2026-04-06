import { CloudstickApiClient } from './src/api/cloudstick_client.js';

const userId = process.env.CLOUDSTICK_USER_ID;
if (!userId) {
    console.error("No CLOUDSTICK_USER_ID found");
    process.exit(1);
}

const client = new CloudstickApiClient({
    baseURL: process.env.CLOUDSTICK_API_BASE,
    apiKey: process.env.CLOUDSTICK_API_KEY,
    apiSecret: process.env.CLOUDSTICK_API_SECRET
});

async function main() {
    let serverId = "1";
    let websiteId = "1";

    try {
        const serversResponse = await client.listServersByUser(userId) as any;
        const servers = serversResponse?.message?.servers ?? serversResponse?.data ?? [];
        if (servers.length > 0) {
            serverId = String(servers[0].id);
            console.log(`[OK] Found ${servers.length} server(s). Using server: ${servers[0].name ?? serverId}`);
        }
    } catch (e: any) {
        console.error(`[FAIL] listServersByUser: ${e.message}`);
    }

    try {
        const websitesResponse = await client.listWebsitesByServer(serverId, userId) as any;
        const websites = websitesResponse?.message?.websites ?? websitesResponse?.data ?? [];
        if (websites.length > 0) {
            websiteId = String(websites[0].id);
            console.log(`[OK] Found ${websites.length} website(s). Using website: ${websites[0].domain ?? websites[0].name ?? websiteId}`);
        }
    } catch (e: any) {
        console.error(`[FAIL] listWebsitesByServer: ${e.message}`);
    }

    console.log(`\nUsing Server ID: ${serverId}, Website ID: ${websiteId}\n`);

    // ─── PHASE 1: Server/Security ────────────────────────────────────────────
    const serverTests = [
        { name: 'Firewall Status', fn: () => client.getFirewallStatus(serverId, userId) },
        { name: 'Brute Force Shield', fn: () => client.manageBruteForceShield(serverId, userId, 'status') },
        { name: 'IP Rule', fn: () => client.manageIpRule(serverId, userId, { ip: '1.1.1.1', action: 'whitelist' }) },
        { name: 'Temp IP Rule', fn: () => client.addTemporaryIpRule(serverId, userId, { ip: '1.1.1.1', action: 'block', duration: '1h' }) },
        { name: 'List Temp Rules', fn: () => client.listTemporaryIpRules(serverId, userId) },
        { name: 'Service Manage', fn: () => client.manageService(serverId, userId, { service: 'nginx-cs', action: 'status' }) },
        { name: 'Service Status', fn: () => client.getServiceStatus(serverId, userId, 'nginx-cs') },
        { name: 'Timezone', fn: () => client.configureTimezone(serverId, userId, { timezone: 'UTC' }) },
        { name: 'Cleanup', fn: () => client.cleanupServer(serverId, userId, { target: 'logs' }) },
        { name: 'Hostname (GET)', fn: () => client.getHostname(serverId, userId) },
        { name: 'Auto Update', fn: () => client.runAutoUpdate(serverId, userId) },
    ];

    // ─── PHASE 1: Website-level ─────────────────────────────────────────────────
    const websiteTests = [
        { name: 'Maintenance Mode (PATCH)', fn: () => client.setMaintenanceMode(websiteId, serverId, userId, { enabled: false }) },
        { name: 'Subdomain', fn: () => client.addSubdomain(websiteId, serverId, userId, { subdomain: 'test' }) },
        { name: 'PHP Extension', fn: () => client.managePhpExtension(websiteId, serverId, userId, { extension: 'gd', action: 'enable' }) },
        { name: 'PHP CLI Version', fn: () => client.changePhpCliVersion(serverId, userId, { php_version: '8.2' }) },
        { name: 'File Upload', fn: () => client.uploadFile(serverId, userId, { destination_path: '/tmp', file_content: '', file_name: 'test.txt' }) },
        { name: 'Create File', fn: () => client.createFile(serverId, userId, { path: '/tmp', file_name: 'test.txt' }) },
        { name: 'Create Folder', fn: () => client.createFolder(serverId, userId, { path: '/tmp', folder_name: 'test_dir' }) },
        { name: 'FTP Account', fn: () => client.createFtpAccount(serverId, userId, { ftp_username: 'test', ftp_password: 'test123', directory: '/home' }) },
    ];

    // ─── PHASE 1: Email ─────────────────────────────────────────────────────────
    const emailTests = [
        { name: 'Enable Webmail', fn: () => client.enableWebmail(websiteId, serverId, userId) },
        { name: 'List Email Accounts', fn: () => client.listEmailAccounts(websiteId, serverId, userId) },
        { name: 'Create Email Account', fn: () => client.createEmailAccount(websiteId, serverId, userId, { name: 'test', password: 'test123' }) },
    ];

    // ─── PHASE 1: Site creation ────────────────────────────────────────────────
    const siteCreationTests = [
        { name: 'Create WordPress Site', fn: () => client.createWordPressSite(serverId, userId, { email: 'test@test.com', website_name: 'test', domain: 'test.com', site_title: 'Test', admin_username: 'admin', admin_password: 'pass', admin_email: 'a@b.com', php_version: '8.2', web_app_server: 'nginx' }) },
        { name: 'Create Custom PHP Site', fn: () => client.createCustomPhpSite(serverId, userId, { email: 'test@test.com', website_name: 'testphp', domain_type: 'primary', domain_name: 'testphp.com', php_version: '8.2', web_app_server: 'nginx' }) },
    ];

    // ─── BATCH 2: NGINX Config Files ───────────────────────────────────────────
    const nginxConfigTests = [
        { name: 'Get NGINX Config File (header-extra.conf)', fn: () => client.getWebsiteNginxConfigFile(websiteId, serverId, userId, 'header-extra.conf') },
        { name: 'Get NGINX Config File (ssl.conf)', fn: () => client.getWebsiteNginxConfigFile(websiteId, serverId, userId, 'ssl.conf') },
        { name: 'Get NGINX Config File (non-ssl.conf)', fn: () => client.getWebsiteNginxConfigFile(websiteId, serverId, userId, 'non-ssl.conf') },
    ];

    // ─── BATCH 2: Website Activity ─────────────────────────────────────────────
    const activityTests = [
        { name: 'Get Website Activity Logs', fn: () => client.getWebsiteActivityLogs(websiteId, serverId, userId) },
    ];

    // ─── BATCH 2: WordPress Search/Login Mode ───────────────────────────────────
    // This needs a WP website - we'll try it anyway
    const wpTests = [
        { name: 'WordPress Details', fn: () => client.getWordpressDetails(websiteId, serverId, userId) },
        { name: 'WordPress Version', fn: () => client.getWpVersion(websiteId, serverId, userId) },
        { name: 'WordPress Users', fn: () => client.getWpUsers(websiteId, serverId, userId) },
        { name: 'WordPress Users Count', fn: () => client.getWpUsersCount(websiteId, serverId, userId) },
        { name: 'WordPress Plugin Count', fn: () => client.getWpPluginCount(websiteId, serverId, userId) },
        { name: 'WordPress Plugins', fn: () => client.listWpPlugins(websiteId, serverId, userId) },
        { name: 'WordPress Debug Info', fn: () => client.getWpDebugInfo(websiteId, serverId, userId) },
        { name: 'WordPress Maintenance Mode (GET)', fn: () => client.getWpMaintenanceMode(websiteId, serverId, userId) },
        { name: 'WordPress URLs', fn: () => client.getWpUrls(websiteId, serverId, userId) },
        { name: 'WordPress Magic Link', fn: () => client.getWpMagicLink(serverId, userId) },
        { name: 'Search Index Mode', fn: () => client.getWpSearchIndexMode(websiteId, serverId, userId) },
    ];

    // ─── BATCH 2: Security Headers (read via SSL status or detail endpoints) ───
    const securityHeaderTests = [
        { name: 'SSL Status', fn: () => client.getSSLStatus(websiteId, serverId, userId) },
        { name: 'SSL Update Settings (read)', fn: () => client.updateSSLSettings(websiteId, serverId, userId, {}) },
    ];

    // ─── Batch 2: App Details ──────────────────────────────────────────────────
    const appDetailTests = [
        { name: 'CustomPHP Details', fn: () => client.getCustomPhpDetails(websiteId, serverId, userId) },
        { name: 'Laravel Details', fn: () => client.getLaravelDetails(websiteId, serverId, userId) },
        { name: 'WooCommerce Details', fn: () => client.getWooCommerceDetails(websiteId, serverId, userId) },
        { name: 'Joomla Details', fn: () => client.getJoomlaDetails(websiteId, serverId, userId) },
        { name: 'Moodle Details', fn: () => client.getMoodleDetails(websiteId, serverId, userId) },
        { name: 'Prestashop Details', fn: () => client.getPrestashopDetails(websiteId, serverId, userId) },
        { name: 'PHPMyAdmin Details', fn: () => client.getPhpMyAdminDetails(websiteId, serverId, userId) },
        { name: 'Roundcube Details', fn: () => client.getRoundcubeDetails(websiteId, serverId, userId) },
        { name: 'MediaWiki Details', fn: () => client.getMediaWikiDetails(websiteId, serverId, userId) },
        { name: 'ProxyApp Details', fn: () => client.getProxyAppDetails(websiteId, serverId, userId) },
    ];

    const allTestGroups = [
        { name: '─── SERVER / SECURITY ───', tests: serverTests },
        { name: '─── WEBSITE ───', tests: websiteTests },
        { name: '─── EMAIL ───', tests: emailTests },
        { name: '─── SITE CREATION ───', tests: siteCreationTests },
        { name: '─── BATCH 2: NGINX CONFIG ───', tests: nginxConfigTests },
        { name: '─── BATCH 2: ACTIVITY ───', tests: activityTests },
        { name: '─── BATCH 2: WORDPRESS ───', tests: wpTests },
        { name: '─── BATCH 2: SSL / SECURITY HEADERS ───', tests: securityHeaderTests },
        { name: '─── BATCH 2: APP DETAILS ───', tests: appDetailTests },
    ];

    for (const group of allTestGroups) {
        console.log(`\n${group.name}`);
        for (const test of group.tests) {
            try {
                await test.fn();
                console.log(`[200] ${test.name}`);
            } catch (err: any) {
                const status = err?.response?.status;
                if (status === 404) {
                    console.log(`[404] ${test.name}`);
                } else if (status) {
                    console.log(`[${status}] ${test.name}`);
                } else if (err.message?.includes('TODO')) {
                    console.log(`[TODO] ${test.name} — ${err.message.split('\n')[0]}`);
                } else {
                    const msg = err.message || String(err);
                    console.log(`[ERR] ${test.name} — ${msg.substring(0, 100)}`);
                }
            }
        }
    }

    console.log('\n\nDone.');
}

main().catch(console.error);
