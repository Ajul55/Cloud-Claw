import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';
import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    getEffectiveCloudstickUserId,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';

const NGINX_CONFIG_FILES = [
    'header-extra.conf',
    'main-fastcgi-extra.conf',
    'main-location-extra.conf',
    'main-location-post.conf',
    'main-location-pre.conf',
    'main-post.conf',
    'main-pre.conf',
    'non-ssl.conf',
    'ssl.conf',
] as const;

type NginxConfigFile = typeof NGINX_CONFIG_FILES[number];

function buildNginxConfigPath(siteKey: string, configFile: string): string {
    return `/etc/nginx-cs/extra.d/${siteKey}.d/${configFile}`;
}

export const listNginxConfigFiles = {
    name: 'list_nginx_config_files',
    description:
        'List the panel-managed per-website NGINX config snippet files for a Cloudstick website. ' +
        'Use this before reading or editing any NGINX extra.d file.',
    parameters: {
        type: 'object',
        properties: {
            website: {
                type: 'string',
                description: 'Website domain or site identifier in Cloudstick',
            },
        },
        required: ['website'],
    },
    tier: 1 as const,
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const paths = NGINX_CONFIG_FILES.map((configFile) => buildNginxConfigPath(context.siteKey, configFile));

            return {
                success: true,
                output: [
                    `NGINX config files for ${context.label} (website ${context.websiteId} on ${context.serverLabel}):`,
                    ...paths,
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to list NGINX config files: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const getNginxConfigFile = {
    name: 'get_nginx_config_file',
    description:
        'Return the current contents of one panel-managed NGINX config snippet for a Cloudstick website. ' +
        'Always call this before proposing a config edit.',
    parameters: {
        type: 'object',
        properties: {
            website: {
                type: 'string',
                description: 'Website domain or site identifier in Cloudstick',
            },
            config_file: {
                type: 'string',
                enum: [...NGINX_CONFIG_FILES],
                description: 'Which NGINX config snippet file to read',
            },
        },
        required: ['website', 'config_file'],
    },
    tier: 1 as const,
    handler: async (args: Record<string, unknown>) => {
        const configFile = stringify(args.config_file) as NginxConfigFile;
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const client = getCloudstickClient();
            const response = await client.getWebsiteNginxConfigFile(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                configFile,
            );

            return {
                success: true,
                output: [
                    `NGINX config file ${configFile} for ${context.label}:`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: [
                    `Failed to get NGINX config file ${configFile}.`,
                    err instanceof Error ? err.message : String(err),
                    `No SSH fallback has been used. Target path: ${buildNginxConfigPath(stringify(args.website) || 'site', configFile)}.`,
                ].join('\n'),
            };
        }
    },
};

export const updateNginxConfigFile = {
    name: 'update_nginx_config_file',
    description:
        'Overwrite one panel-managed NGINX config snippet for a Cloudstick website with the full new file content. ' +
        'Always read the current file first, make the smallest possible edit, and remind the user that nginx-cs must be restarted after approval.',
    parameters: {
        type: 'object',
        properties: {
            website: {
                type: 'string',
                description: 'Website domain or site identifier in Cloudstick',
            },
            config_file: {
                type: 'string',
                enum: [...NGINX_CONFIG_FILES],
                description: 'Which NGINX config snippet file to update',
            },
            content: {
                type: 'string',
                description: 'The full new file contents',
            },
        },
        required: ['website', 'config_file', 'content'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will overwrite ${stringify(args.config_file)} for ${stringify(args.website)}. nginx-cs must be restarted afterwards for the change to take effect.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('update_nginx_config_file', {
            website: stringify(args.website),
            config_file: stringify(args.config_file),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale:
            `Overwrite ${stringify(args.config_file)} for ${stringify(args.website)}. `
            + 'Restart nginx-cs afterwards if the change should be applied immediately.',
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        const configFile = stringify(args.config_file) as NginxConfigFile;
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const client = getCloudstickClient();
            const response = await client.getWebsiteNginxConfigFile(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                configFile,
            );
            return toPrettyJson(response);
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        const configFile = stringify(args.config_file) as NginxConfigFile;
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const client = getCloudstickClient();
            const response = await client.updateWebsiteNginxConfigFile(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                configFile,
                stringify(args.content),
            );

            return {
                success: true,
                output: [
                    `Updated ${configFile} for ${context.label}.`,
                    'Reminder: restart nginx-cs with manage_service if you need the change applied immediately.',
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: [
                    `Failed to update NGINX config file ${configFile}.`,
                    err instanceof Error ? err.message : String(err),
                    'No SSH fallback has been used because Cloudstick must remain the source of truth for panel-managed config files.',
                ].join('\n'),
            };
        }
    },
};

export const listNginxConfigFilesTool: Tool = createCloudstickTool(listNginxConfigFiles);
export const getNginxConfigFileTool: Tool = createCloudstickTool(getNginxConfigFile);
export const updateNginxConfigFileTool: Tool = createCloudstickTool(updateNginxConfigFile);
