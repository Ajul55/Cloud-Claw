/**
 * PHP Version Switch Tool — Phase 3 (Lane 1: Cloudstick API)
 *
 * Switches the PHP version for a website using the Cloudstick API (not SSH).
 * Includes post-switch verification. approvalTier: 3 (HITL).
 */

import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';

const userId = () => getCloudstickUser()?.cloudstick_user_id
    ?? env.CLOUDSTICK_USER_ID
    ?? (() => { throw new Error('CLOUDSTICK_USER_ID is not set in environment'); })();

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
    getRationale: (args) =>
        `This will switch PHP to version ${args.php_version} for ${args.domain ?? 'this website'} on server ${args.server_label ?? args.server_id}. This may cause downtime if the site is not compatible.`,
    getCurrentState: async (args) => {
        try {
            const client = getCloudstickClient();
            const version = await client.getPhpVersion(String(args.website_id), String(args.server_id), userId());
            return JSON.stringify(version);
        } catch { return '{}'; }
    },
    execute: async (args) => {
        const websiteId = String(args.website_id);
        const serverId = String(args.server_id);
        const phpVersion = String(args.php_version);

        try {
            const client = getCloudstickClient();

            // Check current version first
            let currentVersion: any;
            try {
                currentVersion = await client.getPhpVersion(websiteId, serverId, userId());
            } catch { currentVersion = null; }

            // Switch
            const result = await client.switchPhpVersion(websiteId, serverId, userId(), { php_version: phpVersion });

            // Post-switch verification
            let newVersion: any;
            try {
                newVersion = await client.getPhpVersion(websiteId, serverId, userId());
            } catch { newVersion = null; }

            const verificationStatus = newVersion
                ? `Post-switch verification: PHP is now ${JSON.stringify(newVersion)}`
                : 'Post-switch verification: Could not verify — check manually.';

            return {
                success: true,
                output: [
                    `PHP version switched to ${phpVersion}.`,
                    `Previous: ${currentVersion ? JSON.stringify(currentVersion) : 'unknown'}`,
                    `API response: ${JSON.stringify(result, null, 2)}`,
                    verificationStatus,
                ].join('\n'),
            };
        } catch (err) {
            return { success: false, output: `PHP switch failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};
