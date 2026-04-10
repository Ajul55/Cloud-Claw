/**
 * PHP Version Switch Tool — V2 API
 *
 * Uses changePhpVersion (PATCH) to switch PHP version.
 * Current version is read from listWebsitesByServer since getPhpVersion (legacy) was removed.
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

async function getCurrentPhpVersion(websiteId: string, serverId: string, uid: string): Promise<string | null> {
    try {
        const client = getCloudstickClient();
        const response: any = await client.listWebsitesByServer(serverId, uid);
        const websites: unknown[] = response?.message?.Websites ?? response?.data ?? [];
        const website = websites.find((w: any) => String(w.id) === String(websiteId)) as any;
        return website?.php_version ?? website?.phpVersion ?? null;
    } catch {
        return null;
    }
}

export const switchPhpApiTool: Tool = {
    name: 'switch_php_api',
    description:
        'Switch the PHP version for a website via the Cloudstick API. ' +
        'This is the preferred method (Lane 1) over SSH-based PHP switching. ' +
        'Includes post-switch verification. Requires HITL approval.',
    parameters: {
        type: 'object',
        properties: {
            website_id: { type: 'string', description: 'Cloudstick website ID' },
            server_id: { type: 'string', description: 'Cloudstick server ID' },
            server_label: { type: 'string', description: 'Human-readable server label' },
            php_version: { type: 'string', description: 'Target PHP version (e.g. "8.2", "8.1")' },
            domain: { type: 'string', description: 'Domain name (for display)' },
        },
        required: ['website_id', 'server_id', 'php_version'],
    },
    approvalTier: 3,
    suppressTools: ['execute_ssh_write', 'execute_ssh_command'],
    getRationale: (args) =>
        `This will switch PHP to version ${args.php_version} for ${args.domain ?? 'this website'} on server ${args.server_label ?? args.server_id}. This may cause downtime if the site is not compatible.`,
    getCurrentState: async (args) => {
        try {
            const version = await getCurrentPhpVersion(String(args.website_id), String(args.server_id), userId());
            return JSON.stringify({ php_version: version });
        } catch { return '{}'; }
    },
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);
        const phpVersion = String(args.php_version);

        try {
            const client = getCloudstickClient();
            const uid = userId();

            const currentVersion = await getCurrentPhpVersion(websiteId, serverId, uid);

            const result = await client.changePhpVersion(websiteId, serverId, uid, phpVersion);

            const newVersion = await getCurrentPhpVersion(websiteId, serverId, uid);

            const verificationStatus = newVersion
                ? `Post-switch verification: PHP is now ${newVersion}`
                : 'Post-switch verification: Could not verify — check manually.';

            return {
                success: true,
                output: [
                    `PHP version switched to ${phpVersion}.`,
                    `Previous: ${currentVersion ?? 'unknown'}`,
                    `API response: ${JSON.stringify(result, null, 2)}`,
                    verificationStatus,
                ].join('\n'),
            };
        } catch (err) {
            return { success: false, output: `PHP switch failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
