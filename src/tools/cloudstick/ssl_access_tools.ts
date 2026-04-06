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

const ACCESS_METHOD_MAP = {
    https_and_http: 'HTTPS+HTTP',
    https_only: 'HTTPS',
} as const;

const TLS_PRESET_MAP = {
    legacy: 'TLSv1 TLSv1.1 TLSv1.2 TLSv1.3',
    recommended: 'TLSv1.2 TLSv1.3',
    modern: 'TLSv1.3',
} as const;

const TLS_PRESET_LABELS = {
    legacy: 'Legacy = TLS 1.0/1.1/1.2/1.3',
    recommended: 'Recommended = TLS 1.2/1.3',
    modern: 'Modern = TLS 1.3 only',
} as const;

async function getSslConfigurationSnapshot(website: string): Promise<Record<string, unknown>> {
    const context = await resolveWebsiteContext(website);
    const userId = getEffectiveCloudstickUserId();
    const client = getCloudstickClient();

    // SSL settings are stored in the website record returned by listWebsitesByServer.
    // The getSSLStatus endpoint returns 404 on this Cloudstick installation.
    let websiteRecord: unknown = {};
    try {
        const response = await client.listWebsitesByServer(context.serverId, userId) as any;
        const websites: unknown[] = response?.message?.Websites ?? response?.data ?? [];
        websiteRecord = websites.find((w: any) => String(w.id) === String(context.websiteId)) ?? {};
    } catch {
        websiteRecord = {};
    }

    const candidates = [websiteRecord, ...(await loadWebsiteDetailCandidates(context))];

    return {
        access_method: firstDefined(
            findFirstValueByKeys(candidates, ['ssl_access_method', 'access', 'access_method']),
            'Unavailable',
        ),
        tls_protocol_version: firstDefined(
            findFirstValueByKeys(candidates, ['ssl_tls_protocol', 'tls_version', 'tls_protocol_version']),
            'Unavailable',
        ),
        cipher_suite: firstDefined(
            findFirstValueByKeys(candidates, ['ssl_cipher_suite', 'cipher_suite']),
            'Unavailable',
        ),
        brotli_enabled: firstDefined(
            findFirstValueByKeys(candidates, ['ssl_brotli_enabled', 'brotli_enabled', 'brotli']),
            'Unavailable',
        ),
    };
}

export const getSslConfiguration = {
    name: 'get_ssl_configuration',
    description:
        'Return the current access method, TLS protocol version, cipher suite, and Brotli status for a Cloudstick website.',
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
            const configuration = await getSslConfigurationSnapshot(context.label);
            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    website_id: context.websiteId,
                    server: context.serverLabel,
                    configuration,
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to get SSL configuration: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const setAccessMethod = {
    name: 'set_access_method',
    description:
        'Set whether a Cloudstick website accepts both HTTP and HTTPS or redirects HTTP to HTTPS only.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            method: {
                type: 'string',
                enum: ['https_and_http', 'https_only'],
                description: 'https_and_http allows both protocols. https_only redirects HTTP to HTTPS.',
            },
        },
        required: ['website', 'method'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will set the access method for ${stringify(args.website)} to ${stringify(args.method)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('set_access_method', {
            website: stringify(args.website),
            method: stringify(args.method),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Set access method for ${stringify(args.website)} to ${stringify(args.method)}.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getSslConfigurationSnapshot(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().updateSSLSettings(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { access: ACCESS_METHOD_MAP[args.method as keyof typeof ACCESS_METHOD_MAP] },
            );

            return {
                success: true,
                output: [
                    `Updated access method for ${context.label} to ${stringify(args.method)}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to set access method: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const setTlsProtocolVersion = {
    name: 'set_tls_protocol_version',
    description:
        'Set the TLS protocol preset for a Cloudstick website. ' +
        `${TLS_PRESET_LABELS.legacy}. ${TLS_PRESET_LABELS.recommended}. ${TLS_PRESET_LABELS.modern}.`,
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            preset: {
                type: 'string',
                enum: ['legacy', 'recommended', 'modern'],
                description: 'TLS preset to apply',
            },
        },
        required: ['website', 'preset'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will set the TLS preset for ${stringify(args.website)} to ${stringify(args.preset)}. ${TLS_PRESET_LABELS[args.preset as keyof typeof TLS_PRESET_LABELS] ?? ''}`,
    getApprovalRequest: (args: Record<string, unknown>) => {
        const preset = args.preset as keyof typeof TLS_PRESET_MAP;
        return {
            command: encodeToolApprovalCommand('set_tls_protocol_version', {
                website: stringify(args.website),
                preset: stringify(args.preset),
                protocols: TLS_PRESET_MAP[preset],
            }),
            targetHost: stringify(args.website) || 'website',
            rationale: `Set TLS preset for ${stringify(args.website)} to ${stringify(args.preset)} (${TLS_PRESET_MAP[preset]}).`,
        };
    },
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getSslConfigurationSnapshot(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const preset = args.preset as keyof typeof TLS_PRESET_MAP;
            const response = await getCloudstickClient().updateSSLSettings(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { tls_version: TLS_PRESET_MAP[preset] },
            );

            return {
                success: true,
                output: [
                    `Updated TLS preset for ${context.label} to ${preset} (${TLS_PRESET_MAP[preset]}).`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to set TLS protocol version: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const setCipherSuite = {
    name: 'set_cipher_suite',
    description:
        'Update the SSL/TLS cipher suite string for a Cloudstick website.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            cipher_suite: { type: 'string', description: 'OpenSSL cipher suite string' },
        },
        required: ['website', 'cipher_suite'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will update the cipher suite for ${stringify(args.website)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('set_cipher_suite', {
            website: stringify(args.website),
            cipher_suite: stringify(args.cipher_suite),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `Update the cipher suite for ${stringify(args.website)}.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getSslConfigurationSnapshot(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().updateSSLSettings(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { cipher_suite: stringify(args.cipher_suite) },
            );

            return {
                success: true,
                output: [
                    `Updated cipher suite for ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to set cipher suite: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const setBrotliCompression = {
    name: 'set_brotli_compression',
    description:
        'Enable or disable Brotli compression for a Cloudstick website.',
    parameters: {
        type: 'object',
        properties: {
            website: { type: 'string', description: 'Website domain or site identifier in Cloudstick' },
            enabled: { type: 'boolean', description: 'Whether Brotli compression should be enabled' },
        },
        required: ['website', 'enabled'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will ${args.enabled ? 'enable' : 'disable'} Brotli compression for ${stringify(args.website)}.`,
    getApprovalRequest: (args: Record<string, unknown>) => ({
        command: encodeToolApprovalCommand('set_brotli_compression', {
            website: stringify(args.website),
            enabled: String(Boolean(args.enabled)),
        }),
        targetHost: stringify(args.website) || 'website',
        rationale: `${args.enabled ? 'Enable' : 'Disable'} Brotli compression for ${stringify(args.website)}.`,
    }),
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getSslConfigurationSnapshot(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const response = await getCloudstickClient().updateSSLSettings(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                { brotli_enabled: Boolean(args.enabled) },
            );

            return {
                success: true,
                output: [
                    `${Boolean(args.enabled) ? 'Enabled' : 'Disabled'} Brotli compression for ${context.label}.`,
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to set Brotli compression: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

function firstDefined(...values: unknown[]): unknown {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

export const getSslConfigurationTool: Tool = createCloudstickTool(getSslConfiguration);
export const setAccessMethodTool: Tool = createCloudstickTool(setAccessMethod);
export const setTlsProtocolVersionTool: Tool = createCloudstickTool(setTlsProtocolVersion);
export const setCipherSuiteTool: Tool = createCloudstickTool(setCipherSuite);
export const setBrotliCompressionTool: Tool = createCloudstickTool(setBrotliCompression);
