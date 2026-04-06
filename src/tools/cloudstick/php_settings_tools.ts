import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { encodeToolApprovalCommand } from '../../hitl/tool_approval.js';
import type { Tool } from '../types.js';
import {
    createCloudstickTool,
    findFirstValueByKeys,
    getEffectiveCloudstickUserId,
    getProvidedArgs,
    loadWebsiteDetailCandidates,
    resolveWebsiteContext,
    stringify,
    summarizeDisableFunctions,
    toPrettyJson,
} from './shared.js';

type PhpSettingField = {
    arg: string;
    outputKey: string;
    apiKey: string;
    readKeys: string[];
    confirmed: boolean;
    normalize?: (value: unknown) => unknown;
    formatForOutput?: (value: unknown) => unknown;
};

const PHP_SETTING_FIELDS: PhpSettingField[] = [
    {
        arg: 'open_basedir',
        outputKey: 'open_basedir',
        apiKey: 'php_open_base_dir',
        readKeys: ['php_open_base_dir', 'php_open_basedir', 'open_basedir', 'open_base_dir'],
        confirmed: true,
        normalize: stringify,
    },
    {
        arg: 'date_timezone',
        outputKey: 'date.timezone',
        apiKey: 'php_date_timezone',
        readKeys: ['php_date_timezone', 'date_timezone', 'datetimezone', 'date.timezone'],
        confirmed: false,
        normalize: stringify,
    },
    {
        arg: 'max_execution_time',
        outputKey: 'max_execution_time',
        apiKey: 'php_max_execution_time',
        readKeys: ['php_max_execution_time', 'max_execution_time'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'max_input_time',
        outputKey: 'max_input_time',
        apiKey: 'php_max_input_time',
        readKeys: ['php_max_input_time', 'max_input_time'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'max_input_vars',
        outputKey: 'max_input_vars',
        apiKey: 'php_max_input_vars',
        readKeys: ['php_max_input_vars', 'max_input_vars'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'memory_limit',
        outputKey: 'memory_limit',
        apiKey: 'php_memory_limit',
        readKeys: ['php_memory_limit', 'memory_limit'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'post_max_size',
        outputKey: 'post_max_size',
        apiKey: 'php_post_max_size',
        readKeys: ['php_post_max_size', 'post_max_size'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'upload_max_filesize',
        outputKey: 'upload_max_filesize',
        apiKey: 'php_upload_max_filesize',
        readKeys: ['php_upload_max_filesize', 'upload_max_filesize'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'session_max_lifetime',
        outputKey: 'session.gc_maxlifetime',
        apiKey: 'php_session_gc_maxlifetime',
        readKeys: ['php_session_gc_maxlifetime', 'session_gc_maxlifetime', 'session.gc_maxlifetime'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'disable_functions',
        outputKey: 'disable_functions',
        apiKey: 'php_disable_functions',
        readKeys: ['php_disable_functions', 'disable_functions'],
        confirmed: true,
        normalize: stringify,
        formatForOutput: summarizeDisableFunctions,
    },
    {
        arg: 'process_manager',
        outputKey: 'process_manager',
        apiKey: 'php_process_manager',
        readKeys: ['php_process_manager', 'process_manager', 'pm', 'pm_mode'],
        confirmed: false,
        normalize: stringify,
    },
    {
        arg: 'pm_start_servers',
        outputKey: 'pm.start_servers',
        apiKey: 'php_pm_start_servers',
        readKeys: ['php_pm_start_servers', 'pm_start_servers', 'pm.start_servers'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'pm_min_spare_servers',
        outputKey: 'pm.min_spare_servers',
        apiKey: 'php_pm_min_spare_servers',
        readKeys: ['php_pm_min_spare_servers', 'pm_min_spare_servers', 'pm.min_spare_servers'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'pm_max_spare_servers',
        outputKey: 'pm.max_spare_servers',
        apiKey: 'php_pm_max_spare_servers',
        readKeys: ['php_pm_max_spare_servers', 'pm_max_spare_servers', 'pm.max_spare_servers'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'pm_max_children',
        outputKey: 'pm.max_children',
        apiKey: 'php_pm_max_children',
        readKeys: ['php_pm_max_children', 'pm_max_children', 'pm.max_children'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'pm_max_requests',
        outputKey: 'pm.max_requests',
        apiKey: 'php_pm_max_requests',
        readKeys: ['php_pm_max_requests', 'pm_max_requests', 'pm.max_requests'],
        confirmed: false,
        normalize: toNumber,
    },
    {
        arg: 'allow_url_fopen',
        outputKey: 'allow_url_fopen',
        apiKey: 'php_allow_url_fopen',
        readKeys: ['php_allow_url_fopen', 'allow_url_fopen'],
        confirmed: true,
        normalize: toBoolean,
    },
    {
        arg: 'short_open_tag',
        outputKey: 'short_open_tag',
        apiKey: 'php_short_open_tag',
        readKeys: ['php_short_open_tag', 'short_open_tag'],
        confirmed: true,
        normalize: toBoolean,
    },
];

function buildPhpSettingsSnapshot(candidates: unknown[]): Record<string, unknown> {
    return Object.fromEntries(PHP_SETTING_FIELDS.map((field) => {
        const rawValue = firstDefined(
            ...candidates.map((candidate) => findFirstValueByKeys(candidate, field.readKeys))
        );
        const formatted = field.formatForOutput
            ? field.formatForOutput(rawValue)
            : rawValue ?? 'Unavailable';
        return [field.outputKey, formatted];
    }));
}

function buildPhpConfigPayload(args: Record<string, unknown>): {
    payload: Record<string, unknown>;
    changedSettings: Record<string, unknown>;
    unconfirmedMappings: string[];
} {
    const payload: Record<string, unknown> = {};
    const changedSettings: Record<string, unknown> = {};
    const unconfirmedMappings: string[] = [];

    for (const field of PHP_SETTING_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(args, field.arg) || args[field.arg] === undefined) {
            continue;
        }
        const value = field.normalize ? field.normalize(args[field.arg]) : args[field.arg];
        if (value === undefined) continue;
        payload[field.apiKey] = value;
        changedSettings[field.outputKey] = value;
        if (!field.confirmed) {
            unconfirmedMappings.push(`${field.outputKey} -> ${field.apiKey}`);
        }
    }

    return { payload, changedSettings, unconfirmedMappings };
}

function buildApprovalSummary(args: Record<string, unknown>): string {
    const { changedSettings } = buildPhpConfigPayload(args);
    return JSON.stringify(changedSettings);
}

async function getPhpSettingsSnapshotForWebsite(website: string): Promise<Record<string, unknown>> {
    const context = await resolveWebsiteContext(website);
    const candidates = await loadWebsiteDetailCandidates(context);
    return buildPhpSettingsSnapshot(candidates);
}

export const getPhpSettings = {
    name: 'get_php_settings',
    description:
        'Return the current PHP-FPM pool settings for a Cloudstick website. ' +
        'Always use this before proposing any PHP setting change so the approval card can compare current and proposed values.',
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
            const candidates = await loadWebsiteDetailCandidates(context);
            const settings = buildPhpSettingsSnapshot(candidates);

            return {
                success: true,
                output: toPrettyJson({
                    website: context.label,
                    website_id: context.websiteId,
                    server: context.serverLabel,
                    settings,
                    note: 'disable_functions is summarized to avoid dumping the full list into chat.',
                }),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to get PHP settings: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

export const updatePhpSettings = {
    name: 'update_php_settings',
    description:
        'Update one or more PHP-FPM pool settings for a Cloudstick website. ' +
        'Always call get_php_settings first and carry the before/after values into the approval context when available. ' +
        'Only provided fields are changed.',
    parameters: {
        type: 'object',
        properties: {
            website: {
                type: 'string',
                description: 'Website domain or site identifier in Cloudstick',
            },
            open_basedir: { type: 'string', description: 'Colon-separated open_basedir path list' },
            date_timezone: { type: 'string', description: 'IANA timezone, for example UTC or Asia/Kolkata' },
            max_execution_time: { type: 'number', description: 'Maximum execution time in seconds' },
            max_input_time: { type: 'number', description: 'Maximum input time in seconds' },
            max_input_vars: { type: 'number', description: 'Maximum input vars' },
            memory_limit: { type: 'number', description: 'Memory limit in MB' },
            post_max_size: { type: 'number', description: 'Maximum POST body size in MB' },
            upload_max_filesize: { type: 'number', description: 'Maximum upload size in MB' },
            session_max_lifetime: { type: 'number', description: 'Session max lifetime in seconds' },
            disable_functions: { type: 'string', description: 'Comma-separated PHP functions to disable' },
            process_manager: {
                type: 'string',
                enum: ['dynamic', 'static', 'ondemand'],
                description: 'PHP-FPM process manager mode',
            },
            pm_start_servers: { type: 'number', description: 'pm.start_servers value' },
            pm_min_spare_servers: { type: 'number', description: 'pm.min_spare_servers value' },
            pm_max_spare_servers: { type: 'number', description: 'pm.max_spare_servers value' },
            pm_max_children: { type: 'number', description: 'pm.max_children value' },
            pm_max_requests: { type: 'number', description: 'pm.max_requests value' },
            allow_url_fopen: { type: 'boolean', description: 'Whether allow_url_fopen is enabled' },
            short_open_tag: { type: 'boolean', description: 'Whether short_open_tag is enabled' },
        },
        required: ['website'],
    },
    tier: 3 as const,
    getRationale: (args: Record<string, unknown>) =>
        `This will update PHP settings for ${stringify(args.website)}. Review the current values from get_php_settings before approving.`,
    getApprovalRequest: (args: Record<string, unknown>) => {
        const details: Record<string, string> = {
            website: stringify(args.website),
            changes: buildApprovalSummary(args),
        };

        if (args.current_values && typeof args.current_values === 'object') {
            details.current_values = JSON.stringify(args.current_values);
        }

        return {
            command: encodeToolApprovalCommand('update_php_settings', details),
            targetHost: stringify(args.website) || 'website',
            rationale: `Update PHP settings for ${stringify(args.website)}.`,
        };
    },
    getCurrentState: async (args: Record<string, unknown>) => {
        try {
            return JSON.stringify(await getPhpSettingsSnapshotForWebsite(stringify(args.website)));
        } catch {
            return '{}';
        }
    },
    handler: async (args: Record<string, unknown>) => {
        try {
            const context = await resolveWebsiteContext(stringify(args.website));
            const { payload, changedSettings, unconfirmedMappings } = buildPhpConfigPayload(args);

            if (Object.keys(payload).length === 0) {
                return { success: false, output: 'No PHP setting fields were provided to update.' };
            }

            const response = await getCloudstickClient().changePhpConfig(
                context.websiteId,
                context.serverId,
                getEffectiveCloudstickUserId(),
                payload,
            );

            return {
                success: true,
                output: [
                    `Updated PHP settings for ${context.label}.`,
                    `Changed settings: ${toPrettyJson(changedSettings)}`,
                    ...(unconfirmedMappings.length > 0 ? [
                        'Note: the following Cloudstick field mappings are best-effort and should be confirmed if the API rejects this request:',
                        ...unconfirmedMappings,
                    ] : []),
                    toPrettyJson(response),
                ].join('\n'),
            };
        } catch (err) {
            return {
                success: false,
                output: `Failed to update PHP settings: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};

function toNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return value;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        return undefined;
    }
    return parsed;
}

function toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
    }
    return Boolean(value);
}

function firstDefined(...values: unknown[]): unknown {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

export const getPhpSettingsTool: Tool = createCloudstickTool(getPhpSettings);
export const updatePhpSettingsTool: Tool = createCloudstickTool(updatePhpSettings);
