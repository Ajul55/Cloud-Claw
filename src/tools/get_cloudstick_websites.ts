import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import { sshExec } from '../utils/ssh.js';
import { env } from '../config/env.js';

export const getCloudstickWebsitesTool: Tool = {
    name: 'get_cloudstick_websites',
    description:
        'Retrieves the list of all websites/sites configured on a specific server. ' +
        'Tries the Cloudstick API first, then falls back to SSH-based discovery (nginx sites). ' +
        'Call this when the user asks to list websites, sites, or domains on a server.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (e.g. "Cloud-Claw-Test", "production")',
            },
            server_id: {
                type: 'string',
                description: 'Numeric Cloudstick server ID (e.g. "191")',
            },
        },
        required: [],
    },
    approvalTier: 1, // Read-only
    execute: async (args) => {
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;

        try {
            const server = await resolveServerArg(args);
            const serverId = String(args.server_id ?? server.id ?? '').trim();
            const parts: string[] = [`Website discovery for ${formatServerTarget(server)}\n`];

            // 1. Try Cloudstick API first
            if (effectiveUserId && serverId && serverId !== '0') {
                try {
                    const client = getCloudstickClient();
                    const response = await client.listWebsitesByServer(serverId, effectiveUserId);
                    parts.push('=== Cloudstick API Response ===');
                    parts.push(JSON.stringify(response, null, 2));
                } catch {
                    parts.push('(Cloudstick API website listing not available for this server)');
                }
            }

            // 2. SSH-based discovery — always attempt as it's more reliable
            try {
                const [nginxSites, apacheSites, webRoots] = await Promise.all([
                    sshExec(server.ip, 'ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "(no nginx sites-enabled)"', {
                        user: server.sshUser, port: server.sshPort
                    }),
                    sshExec(server.ip, 'ls -la /etc/apache2/sites-enabled/ 2>/dev/null || echo "(no apache sites-enabled)"', {
                        user: server.sshUser, port: server.sshPort
                    }),
                    sshExec(server.ip, 'ls -d /home/*/public_html 2>/dev/null || ls -d /var/www/*/ 2>/dev/null || echo "(no web roots found)"', {
                        user: server.sshUser, port: server.sshPort
                    }),
                ]);

                parts.push('\n=== Nginx Sites Enabled ===');
                parts.push(nginxSites);
                parts.push('\n=== Apache Sites Enabled ===');
                parts.push(apacheSites);
                parts.push('\n=== Web Root Directories ===');
                parts.push(webRoots);

                // Get server_name from nginx configs for domain listing
                try {
                    const serverNames = await sshExec(
                        server.ip,
                        'grep -rh "server_name " /etc/nginx/sites-enabled/ 2>/dev/null | sort -u | head -20',
                        { user: server.sshUser, port: server.sshPort }
                    );
                    if (serverNames && !serverNames.includes('(')) {
                        parts.push('\n=== Configured Domains (from nginx) ===');
                        parts.push(serverNames);
                    }
                } catch { /* ignore */ }
            } catch (sshErr) {
                const msg = sshErr instanceof Error ? sshErr.message : String(sshErr);
                parts.push(`\nSSH discovery failed: ${msg}`);
            }

            return { success: true, output: parts.join('\n') };
        } catch (err: any) {
            return {
                success: false,
                output: `Failed to discover websites.\nError: ${err.message}`,
            };
        }
    },
};
