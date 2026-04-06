import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';
import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    findFirstValueByKeys,
    getEffectiveCloudstickUserId,
    loadWebsiteDetailCandidates,
    resolveWebsiteContext,
    stringify,
    toPrettyJson,
} from './shared.js';

const WEB_STACK_MAP = {
    nginx: 'nginx',
    nginx_apache: 'nginx+apache',
    // TODO: confirm Cloudstick stack_type value for Apache Native as Nginx
    apache_native: 'apache_native',
} as const;

async function getWebsiteAppSnapshot(website: string): Promise<Record<string, unknown>> {
    const context = await resolveWebsiteContext(website);
    const candidates = await loadWebsiteDetailCandidates(context);
    return {
        php_version: findFirstValueByKeys(candidates, ['php_version', 'phpversion']),
        stack: findFirstValueByKeys(candidates, ['stack_type', 'stack', 'web_app_server']),
        public_path: findFirstValueByKeys(candidates, ['public_path', 'document_root']),
    };
}

export const changeWebsitePhpVersion = {
    name: 'change_website_php_version',
    description:
        'Change the PHP version for a specific website in Cloudstick. This is website-level only, not the server-wide CLI PHP version.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            php_version: {
                type: 'string',
                enum: ['8.1', '8.2', '8.3', '8.4', '8.5'],
                description: 'Target website PHP version',
            },
        },
        required: ['website', 'php_version'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will change the website PHP version for ${stringify(args.website)} to ${stringify(args.php_version)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('change_website_php_version', {
            website: stringify(args.website),
            php_version: stringify(args.php_version),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Change website PHP version for ${stringify(args.website)} to ${stringify(args.php_version)}.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            return JSON.stringify(
                await getCloudstickClient().getPhpVersion(context.websiteId, context.serverId, getEffectiveCloudstickUserId())
            );
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().changePhpVersion(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                stringify(args.php_version),
            );

            return {
                success: true,
                output: [
                    `Changed website PHP version for ${context.label} to ${stringify(args.php_version)}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to change website PHP version: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const changeWebStack = {
    name: 'change_web_stack',
    description:
        'Change the web application stack for a Cloudstick website. ' +
        'nginx = Native Nginx. nginx_apache = Nginx + Apache. apache_native = Apache Native as Nginx. ' +
        'This restarts the web server and can cause brief downtime.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            stack: {
                type: 'string',
                enum: ['nginx', 'nginx_apache', 'apache_native'],
                description: 'Target web stack',
            },
        },
        required: ['website', 'stack'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will change the web stack for ${stringify(args.website)} to ${stringify(args.stack)} and restart the web server, causing brief downtime.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('change_web_stack', {
            website: stringify(args.website),
            stack: stringify(args.stack),
            stack_type: WEB_STACK_MAP[args.stack as keyof typeof WEB_STACK_MAP],
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Change the web stack for ${stringify(args.website)} to ${stringify(args.stack)}. Brief downtime is expected.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getWebsiteAppSnapshot(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const stack = args.stack as keyof typeof WEB_STACK_MAP;
            const response = await getCloudstickClient().changeStackType(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { stack_type: WEB_STACK_MAP[stack] },
            );

            return {
                success: true,
                output: [
                    `Changed the web stack for ${context.label} to ${stack}.`,
                    'Warning: the web server restarts as part of this change, so brief downtime is expected.',
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to change web stack: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const addDomainToWebsite = {
    name: 'add_domain_to_website',
    description:
        'Add an additional domain to a Cloudstick website and optionally trigger SSL issuance for that new domain immediately.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            domain_name: { type: 'string', description: 'Additional domain to attach to the website' },
            install_ssl: { type: 'boolean', description: 'Whether Cloudstick should issue SSL for the new domain immediately' },
        },
        required: ['website', 'domain_name', 'install_ssl'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will add domain ${stringify(args.domain_name)} to ${stringify(args.website)}${args.install_ssl ? ' and request SSL immediately' : ''}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('add_domain_to_website', {
            website: stringify(args.website),
            domain_name: stringify(args.domain_name),
            install_ssl: String(Boolean(args.install_ssl)),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Add ${stringify(args.domain_name)} to ${stringify(args.website)}${args.install_ssl ? ' and install SSL immediately' : ''}.`,
    }),
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().addDomain(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                [stringify(args.domain_name)],
                Boolean(args.install_ssl),
            );

            return {
                success: true,
                output: [
                    `Added domain ${stringify(args.domain_name)} to ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to add domain to website: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const changePublicPath = {
    name: 'change_public_path',
    description:
        'Change the public document root for a Cloudstick website.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            public_path: { type: 'string', description: 'Full new public path' },
        },
        required: ['website', 'public_path'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will change the public path for ${stringify(args.website)} to ${stringify(args.public_path)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('change_public_path', {
            website: stringify(args.website),
            public_path: stringify(args.public_path),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Change the public path for ${stringify(args.website)}.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getWebsiteAppSnapshot(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().changePublicPath(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { public_path: stringify(args.public_path) },
            );

            return {
                success: true,
                output: [
                    `Changed the public path for ${context.label} to ${stringify(args.public_path)}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to change public path: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const changeWebsitePhpVersionTool: Tool = createCloudstickTool(changeWebsitePhpVersion);
export const changeWebStackTool: Tool = createCloudstickTool(changeWebStack);
export const addDomainToWebsiteTool: Tool = createCloudstickTool(addDomainToWebsite);
export const changePublicPathTool: Tool = createCloudstickTool(changePublicPath);
