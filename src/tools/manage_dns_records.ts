/**
 * manage_dns_records — Full Cloudflare DNS record CRUD via direct CF API v4.
 *
 * The Cloudstick API does not expose per-record endpoints, so this tool
 * hits api.cloudflare.com directly, the same way cloudflare_cache_purge does.
 *
 * Requires: CLOUDFLARE_API_TOKEN in .env (zone-scoped or account-scoped token).
 * zone_id: pass explicitly, or falls back to CLOUDFLARE_ZONE_ID in .env.
 */
import { env } from '../config/env.js';
import type { Tool, ToolResult } from './types.js';

const CF_BASE = 'https://api.cloudflare.com/client/v4';

interface CfDnsRecord {
    id: string;
    type: string;
    name: string;
    content: string;
    proxied: boolean;
    ttl: number;
    comment?: string;
    modified_on?: string;
}

interface CfApiResponse<T> {
    success: boolean;
    errors: Array<{ code: number; message: string }>;
    result: T;
    result_info?: {
        count: number;
        page: number;
        per_page: number;
        total_count: number;
    };
}

async function cfRequest<T>(
    method: string,
    path: string,
    token: string,
    body?: unknown,
    params?: Record<string, string>
): Promise<CfApiResponse<T>> {
    let url = `${CF_BASE}${path}`;
    if (params) {
        const qs = new URLSearchParams(params).toString();
        url = `${url}?${qs}`;
    }

    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json()) as CfApiResponse<T>;

    if (!response.ok || !data.success) {
        const errMsg = data.errors?.map((e) => `${e.code}: ${e.message}`).join(', ') ?? 'Unknown error';
        throw new Error(`Cloudflare API error: ${errMsg}`);
    }

    return data;
}

function formatRecord(r: CfDnsRecord): string {
    return `  ${r.type.padEnd(6)} ${r.name.padEnd(40)} ${r.content.padEnd(30)} TTL:${r.ttl} proxied:${r.proxied} id:${r.id}`;
}

export const manageDnsRecordsTool: Tool = {
    name: 'manage_dns_records',
    description:
        'Full CRUD for Cloudflare DNS records via the Cloudflare API v4. ' +
        'Actions: list (all records for a zone), create (add a record), ' +
        'update (edit type/content/TTL/proxy on an existing record by ID), delete (remove a record by ID). ' +
        'Use list first to get record IDs needed for update and delete. ' +
        'Requires CLOUDFLARE_API_TOKEN in .env. ' +
        'zone_id can be passed explicitly or falls back to CLOUDFLARE_ZONE_ID in .env.',
    approvalTier: 3,
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'create', 'update', 'delete'],
                description: '"list" shows all records. "create" adds a new record. "update" edits an existing record by ID. "delete" removes a record by ID.',
            },
            zone_id: {
                type: 'string',
                description:
                    'Cloudflare Zone ID. If omitted, falls back to CLOUDFLARE_ZONE_ID in .env. ' +
                    'Get zone IDs with manage_cloudflare_dns action=list_zones.',
            },
            record_id: {
                type: 'string',
                description: 'DNS record ID. Required for update and delete. Get it from list.',
            },
            // ── Record fields ─────────────────────────────────────────────────
            type: {
                type: 'string',
                enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR'],
                description: 'DNS record type. Required for create.',
            },
            name: {
                type: 'string',
                description:
                    'Record name — subdomain or "@" for root. E.g. "@", "www", "mail". Required for create.',
            },
            content: {
                type: 'string',
                description: 'Record value — IP address, domain, or TXT content. Required for create.',
            },
            ttl: {
                type: 'number',
                description: 'TTL in seconds. Use 1 for Cloudflare\'s "Auto". Default: 1.',
            },
            proxied: {
                type: 'boolean',
                description: 'Route traffic through Cloudflare proxy (orange cloud). Only valid for A/AAAA/CNAME. Default: false.',
            },
            comment: {
                type: 'string',
                description: 'Optional freetext comment to label the record (e.g. "Added by CloudClaw").',
            },
            // ── Filters for list ──────────────────────────────────────────────
            filter_type: {
                type: 'string',
                description: 'Filter list results by record type, e.g. "A", "MX".',
            },
            filter_name: {
                type: 'string',
                description: 'Filter list results by record name (partial match).',
            },
        },
        required: ['action'],
    },

    getApprovalRequest(args) {
        const action = String(args.action ?? '');
        if (action === 'list') return null;

        const descriptions: Record<string, string> = {
            create: `Create ${args.type} record "${args.name}" → "${args.content}" (proxied: ${args.proxied ?? false})`,
            update: `Update DNS record ID ${args.record_id} — content: "${args.content ?? '(unchanged)'}", TTL: ${args.ttl ?? '(unchanged)'}`,
            delete: `Delete DNS record ID ${args.record_id} permanently`,
        };

        const desc = descriptions[action] ?? action;
        return {
            command: desc,
            targetHost: `Cloudflare zone ${args.zone_id ?? env.CLOUDFLARE_ZONE_ID ?? '(from .env)'}`,
            rationale: desc,
        };
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const token = env.CLOUDFLARE_API_TOKEN;
        if (!token) {
            return {
                success: false,
                output: 'CLOUDFLARE_API_TOKEN is not set in .env — cannot call Cloudflare API directly.',
            };
        }

        const zoneId = String(args.zone_id ?? env.CLOUDFLARE_ZONE_ID ?? '').trim();
        if (!zoneId) {
            return {
                success: false,
                output:
                    'zone_id is required (or set CLOUDFLARE_ZONE_ID in .env). ' +
                    'Use manage_cloudflare_dns action=list_zones to find zone IDs.',
            };
        }

        const action = String(args.action ?? '').trim();

        try {
            switch (action) {

                // ── LIST ────────────────────────────────────────────────────────
                case 'list': {
                    const params: Record<string, string> = { per_page: '100' };
                    if (args.filter_type) params.type = String(args.filter_type);
                    if (args.filter_name) params.name = String(args.filter_name);

                    const resp = await cfRequest<CfDnsRecord[]>(
                        'GET', `/zones/${zoneId}/dns_records`, token, undefined, params
                    );

                    const records = resp.result;
                    if (records.length === 0) {
                        return { success: true, output: `No DNS records found in zone ${zoneId}.` };
                    }

                    const header = `  ${'TYPE'.padEnd(6)} ${'NAME'.padEnd(40)} ${'CONTENT'.padEnd(30)} TTL   PROXIED  ID`;
                    const separator = '  ' + '─'.repeat(120);
                    const lines = records.map(formatRecord);

                    const info = resp.result_info;
                    const summary = info
                        ? `Showing ${records.length} of ${info.total_count} records (page ${info.page})`
                        : `${records.length} record(s)`;

                    return {
                        success: true,
                        output: [
                            `DNS Records — zone ${zoneId}`,
                            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                            header,
                            separator,
                            ...lines,
                            separator,
                            summary,
                        ].join('\n'),
                    };
                }

                // ── CREATE ──────────────────────────────────────────────────────
                case 'create': {
                    const type = String(args.type ?? '').toUpperCase().trim();
                    const name = String(args.name ?? '').trim();
                    const content = String(args.content ?? '').trim();

                    if (!type) return { success: false, output: 'create requires: type (A, AAAA, CNAME, MX, TXT, ...).' };
                    if (!name) return { success: false, output: 'create requires: name (@ for root or subdomain).' };
                    if (!content) return { success: false, output: 'create requires: content (IP, domain, or TXT value).' };

                    const body: Record<string, unknown> = {
                        type,
                        name,
                        content,
                        ttl: (args.ttl as number) ?? 1,
                        proxied: (args.proxied as boolean) ?? false,
                    };
                    if (args.comment) body.comment = String(args.comment);

                    const resp = await cfRequest<CfDnsRecord>('POST', `/zones/${zoneId}/dns_records`, token, body);
                    const r = resp.result;

                    return {
                        success: true,
                        output: [
                            `DNS record created:`,
                            formatRecord(r),
                            '',
                            `Record ID: ${r.id}`,
                            `(Save this ID to edit or delete this record later)`,
                        ].join('\n'),
                    };
                }

                // ── UPDATE ──────────────────────────────────────────────────────
                case 'update': {
                    const recordId = String(args.record_id ?? '').trim();
                    if (!recordId) return { success: false, output: 'update requires record_id. Use action=list to find it.' };

                    // Fetch the existing record first so we can PATCH only the fields provided
                    const existing = await cfRequest<CfDnsRecord>(
                        'GET', `/zones/${zoneId}/dns_records/${recordId}`, token
                    );
                    const current = existing.result;

                    const patch: Record<string, unknown> = {
                        type: String(args.type ?? current.type),
                        name: String(args.name ?? current.name),
                        content: String(args.content ?? current.content),
                        ttl: (args.ttl as number) ?? current.ttl,
                        proxied: (args.proxied as boolean) ?? current.proxied,
                    };
                    if (args.comment !== undefined) patch.comment = String(args.comment);

                    const resp = await cfRequest<CfDnsRecord>(
                        'PATCH', `/zones/${zoneId}/dns_records/${recordId}`, token, patch
                    );
                    const updated = resp.result;

                    return {
                        success: true,
                        output: [
                            `DNS record updated:`,
                            '',
                            `Before: ${formatRecord(current)}`,
                            `After:  ${formatRecord(updated)}`,
                        ].join('\n'),
                    };
                }

                // ── DELETE ──────────────────────────────────────────────────────
                case 'delete': {
                    const recordId = String(args.record_id ?? '').trim();
                    if (!recordId) return { success: false, output: 'delete requires record_id. Use action=list to find it.' };

                    // Fetch first so we can show what was deleted
                    const existing = await cfRequest<CfDnsRecord>(
                        'GET', `/zones/${zoneId}/dns_records/${recordId}`, token
                    );
                    const current = existing.result;

                    await cfRequest<{ id: string }>(
                        'DELETE', `/zones/${zoneId}/dns_records/${recordId}`, token
                    );

                    return {
                        success: true,
                        output: [
                            `DNS record deleted:`,
                            formatRecord(current),
                        ].join('\n'),
                    };
                }

                default:
                    return {
                        success: false,
                        output: `Unknown action: ${action}. Valid: list, create, update, delete.`,
                    };
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `manage_dns_records failed: ${msg}` };
        }
    },
};
