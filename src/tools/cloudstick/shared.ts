import { env } from '../../config/env.js';
import { getCloudstickClient } from '../../api/cloudstick_client.js';
import { getCloudstickUser } from '../../api/cloudstick_context.js';
import type { Tool, ToolResult } from '../types.js';

export interface CloudstickToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
    };
    tier: 1 | 3;
    handler: (args: Record<string, unknown>) => Promise<ToolResult>;
    getRationale?: Tool['getRationale'];
    getApprovalRequest?: Tool['getApprovalRequest'];
    getCurrentState?: Tool['getCurrentState'];
}

export interface ResolvedWebsiteContext {
    websiteId: string;
    websiteIdentifier: string;
    label: string;
    siteKey: string;
    serverId: string;
    serverLabel: string;
    websiteType?: string;
    domains: string[];
    raw: Record<string, unknown>;
}

interface CloudstickServerRecord {
    id?: number | string;
    name?: string;
    label?: string;
    host_name?: string;
}

export function createCloudstickTool(definition: CloudstickToolDefinition): Tool {
    return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as Tool['parameters'],
        approvalTier: definition.tier,
        getRationale: definition.getRationale,
        getApprovalRequest: definition.getApprovalRequest,
        getCurrentState: definition.getCurrentState,
        execute: definition.handler,
    };
}

export function getEffectiveCloudstickUserId(): string {
    const userId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
    if (!userId) {
        throw new Error('Cloudstick user ID not configured. Run /setup first.');
    }
    return userId;
}

export async function resolveWebsiteContext(website: string): Promise<ResolvedWebsiteContext> {
    const identifier = normalizeWebsiteIdentifier(website);
    if (!identifier) {
        throw new Error('website is required');
    }

    const userId = getEffectiveCloudstickUserId();
    const client = getCloudstickClient();
    const serversResponse = await client.listServersByUser(userId) as {
        message?: { servers?: CloudstickServerRecord[] };
    };
    const servers = serversResponse?.message?.servers ?? [];

    if (servers.length === 0) {
        throw new Error('No Cloudstick servers were found for this user.');
    }

    const exactMatches: ResolvedWebsiteContext[] = [];
    const fuzzyMatches: ResolvedWebsiteContext[] = [];

    for (const server of servers) {
        const serverId = stringify(server.id);
        if (!serverId) {
            continue;
        }

        let websitesResponse: unknown;
        try {
            websitesResponse = await client.listWebsitesByServer(serverId, userId, { search: identifier });
        } catch {
            websitesResponse = await client.listWebsitesByServer(serverId, userId);
        }

        const websiteRecords = extractWebsiteRecords(websitesResponse);
        for (const record of websiteRecords) {
            const candidate = normalizeWebsiteRecord(record, {
                serverId,
                serverLabel: firstNonEmptyString(server.name, server.label, server.host_name, `server-${serverId}`),
                requestedIdentifier: identifier,
            });

            if (!candidate) {
                continue;
            }

            const exact = candidate.domains.some((domain) => normalizeWebsiteIdentifier(domain) === identifier)
                || normalizeWebsiteIdentifier(candidate.label) === identifier
                || normalizeWebsiteIdentifier(candidate.siteKey) === identifier
                || candidate.websiteId === identifier;

            const fuzzy = !exact && (
                candidate.domains.some((domain) => normalizeWebsiteIdentifier(domain).includes(identifier))
                || normalizeWebsiteIdentifier(candidate.label).includes(identifier)
                || normalizeWebsiteIdentifier(candidate.siteKey).includes(identifier)
            );

            if (exact) {
                exactMatches.push(candidate);
            } else if (fuzzy) {
                fuzzyMatches.push(candidate);
            }
        }
    }

    if (exactMatches.length === 1) {
        return exactMatches[0];
    }
    if (exactMatches.length > 1) {
        throw new Error(
            `Website "${website}" matched multiple sites: ${exactMatches.map((match) => `${match.label} [${match.websiteId}] on ${match.serverLabel}`).join(', ')}`
        );
    }
    if (fuzzyMatches.length === 1) {
        return fuzzyMatches[0];
    }
    if (fuzzyMatches.length > 1) {
        throw new Error(
            `Website "${website}" is ambiguous. Matches: ${fuzzyMatches.map((match) => `${match.label} [${match.websiteId}] on ${match.serverLabel}`).join(', ')}`
        );
    }

    throw new Error(`Website "${website}" was not found in this Cloudstick account.`);
}

export async function loadWebsiteDetailCandidates(context: ResolvedWebsiteContext): Promise<unknown[]> {
    const userId = getEffectiveCloudstickUserId();
    const client = getCloudstickClient();
    const type = normalizeKey(context.websiteType ?? '');

    const detailCalls: Array<Promise<unknown>> = [client.getPhpVersion(context.websiteId, context.serverId, userId)];

    if (!type || type.includes('wordpress') || type.includes('woocommerce')) {
        detailCalls.push(client.getWordpressDetails(context.websiteId, context.serverId, userId));
    }
    if (!type || type.includes('customphp') || type.includes('php')) {
        detailCalls.push(client.getCustomPhpDetails(context.websiteId, context.serverId, userId));
    }
    if (type.includes('laravel')) {
        detailCalls.push(client.getLaravelDetails(context.websiteId, context.serverId, userId));
    }
    if (type.includes('proxy')) {
        detailCalls.push(client.getProxyAppDetails(context.websiteId, context.serverId, userId));
    }

    const settled = await Promise.allSettled(detailCalls);
    return [
        context.raw,
        ...settled.filter((item): item is PromiseFulfilledResult<unknown> => item.status === 'fulfilled').map((item) => item.value),
    ];
}

export function findFirstValueByKeys(input: unknown, keys: string[]): unknown {
    const wantedKeys = new Set(keys.map(normalizeKey));
    const queue: unknown[] = [input];

    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) {
            queue.push(...current);
            continue;
        }

        const record = asRecord(current);
        if (!record) {
            continue;
        }

        for (const [key, value] of Object.entries(record)) {
            if (value === undefined || value === null) {
                continue;
            }
            if (wantedKeys.has(normalizeKey(key))) {
                return value;
            }
            if (typeof value === 'object') {
                queue.push(value);
            }
        }
    }

    return undefined;
}

export function normalizePluginList(response: unknown): Array<Record<string, unknown>> {
    const candidateArrays = collectObjectArrays(response);
    for (const candidate of candidateArrays) {
        const normalized = candidate
            .map((item) => ({
                slug: firstNonEmptyString(item.plugin_slug, item.slug, item.plugin_name, item.name),
                status: firstNonEmptyString(item.status, item.plugin_status, item.active ? 'active' : undefined),
                version: firstNonEmptyString(item.version, item.plugin_version),
            }))
            .filter((item) => item.slug || item.status || item.version);

        if (normalized.length > 0) {
            return normalized;
        }
    }

    return [];
}

export function summarizeDisableFunctions(value: unknown): string {
    if (typeof value === 'string') {
        const count = value.split(',').map((item) => item.trim()).filter(Boolean).length;
        return count > 0 ? `${count} functions disabled` : 'No disabled functions configured';
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? `${value.length} functions disabled` : 'No disabled functions configured';
    }
    if (value === undefined || value === null || value === '') {
        return 'Unavailable';
    }
    return 'Configured (details hidden)';
}

export function stringify(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim();
}

export function toPrettyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

export function getProvidedArgs(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    return Object.fromEntries(
        keys
            .filter((key) => Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined)
            .map((key) => [key, args[key]])
    );
}

function extractWebsiteRecords(response: unknown): Array<Record<string, unknown>> {
    const candidateRoots: unknown[] = [];
    const rootRecord = asRecord(response);

    if (rootRecord) {
        candidateRoots.push(
            response,
            rootRecord.message,
            rootRecord.websites,
            rootRecord.data,
            asRecord(rootRecord.message)?.websites,
            asRecord(rootRecord.message)?.data,
            asRecord(rootRecord.data)?.websites,
            asRecord(rootRecord.data)?.data,
        );
    } else {
        candidateRoots.push(response);
    }

    for (const root of candidateRoots) {
        const records = collectWebsiteRecords(root);
        if (records.length > 0) {
            return records;
        }
    }

    return [];
}

function collectWebsiteRecords(input: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(input)) {
        return input.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
    }

    const record = asRecord(input);
    if (!record) {
        return [];
    }

    const arrays = Object.values(record)
        .filter(Array.isArray)
        .map((value) => value as unknown[])
        .filter((value) => value.some((item) => looksLikeWebsiteRecord(asRecord(item))));

    if (arrays.length > 0) {
        return arrays[0]
            .map(asRecord)
            .filter((item): item is Record<string, unknown> => Boolean(item));
    }

    return looksLikeWebsiteRecord(record) ? [record] : [];
}

function looksLikeWebsiteRecord(record: Record<string, unknown> | null): boolean {
    if (!record) {
        return false;
    }

    const keys = Object.keys(record).map(normalizeKey);
    const hasId = keys.includes('id') || keys.includes('websiteid');
    const hasNameLikeKey = keys.some((key) => key.includes('domain') || key.includes('website') || key.includes('name') || key.includes('slug'));
    return hasId && hasNameLikeKey;
}

function normalizeWebsiteRecord(
    record: Record<string, unknown>,
    context: { serverId: string; serverLabel: string; requestedIdentifier: string }
): ResolvedWebsiteContext | null {
    const websiteId = firstNonEmptyString(record.id, record.website_id, record.websiteId);
    if (!websiteId) {
        return null;
    }

    const domains = uniqueStrings([
        ...collectStringValues(record.domain),
        ...collectStringValues(record.domain_name),
        ...collectStringValues(record.primary_domain),
        ...collectStringValues(record.website_name),
        ...collectStringValues(record.name),
        ...collectStringValues(record.slug),
        ...collectStringValues(record.site_name),
        ...collectDomainList(record.domains),
        ...collectDomainList(record.additional_domains),
        ...collectDomainList(record.aliases),
    ]);

    const label = firstNonEmptyString(
        record.domain,
        record.domain_name,
        record.primary_domain,
        record.website_name,
        record.name,
        record.site_name,
        record.slug,
        context.requestedIdentifier
    );
    const siteKey = firstNonEmptyString(record.slug, record.website_name, record.site_name, label, context.requestedIdentifier);
    const websiteType = firstNonEmptyString(record.website_type, record.type, record.app_type, record.application_type);

    return {
        websiteId,
        websiteIdentifier: context.requestedIdentifier,
        label,
        siteKey,
        serverId: context.serverId,
        serverLabel: context.serverLabel,
        websiteType: websiteType || undefined,
        domains,
        raw: record,
    };
}

function collectDomainList(input: unknown): string[] {
    if (typeof input === 'string') {
        return collectStringValues(input);
    }
    if (!Array.isArray(input)) {
        return [];
    }

    return uniqueStrings(input.flatMap((item) => {
        if (typeof item === 'string') {
            return [item];
        }
        const record = asRecord(item);
        if (!record) {
            return [];
        }
        return [
            firstNonEmptyString(record.domain, record.domain_name, record.name, record.host, record.url),
        ].filter(Boolean) as string[];
    }));
}

function collectObjectArrays(input: unknown): Array<Array<Record<string, unknown>>> {
    const queue: unknown[] = [input];
    const arrays: Array<Array<Record<string, unknown>>> = [];

    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) {
            const records = current.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
            if (records.length > 0) {
                arrays.push(records);
            }
            queue.push(...current);
            continue;
        }

        const record = asRecord(current);
        if (!record) {
            continue;
        }

        queue.push(...Object.values(record));
    }

    return arrays;
}

function collectStringValues(input: unknown): string[] {
    if (typeof input !== 'string') {
        return [];
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return [];
    }

    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            return [url.hostname];
        } catch {
            return [trimmed];
        }
    }

    return [trimmed];
}

function firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
        const stringValue = stringify(value);
        if (stringValue) {
            return stringValue;
        }
    }
    return '';
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function asRecord(input: unknown): Record<string, unknown> | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return null;
    }
    return input as Record<string, unknown>;
}

function normalizeWebsiteIdentifier(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    try {
        const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        return url.hostname.replace(/\.$/, '').toLowerCase();
    } catch {
        return trimmed.replace(/\.$/, '').replace(/^www\./i, '').toLowerCase();
    }
}

function normalizeKey(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}
