import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';

export const manageCloudflareDnsTool: Tool = {
    name: 'manage_cloudflare_dns',
    description:
        'Manage Cloudflare zones and DNS records via the Cloudstick API. ' +
        'Actions: list_zones, list_records, list_accounts, ' +
        'create_zone (add domain to Cloudflare), delete_zone (remove a zone by ID), ' +
        'add_zone_to_server (link/sync a domain on Cloudflare to a specific server), ' +
        'create_record (add a DNS record). ' +
        'Use list_zones first to get zone IDs needed for delete_zone.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: [
                    'list_zones',
                    'list_records',
                    'list_accounts',
                    'create_zone',
                    'delete_zone',
                    'add_zone_to_server',
                    'create_record',
                ],
                description: 'The action to perform.',
            },
            account_label: {
                type: 'string',
                description: 'Cloudflare account label (numeric ID from list_accounts). Required for most actions.',
            },
            // ── Zone management ───────────────────────────────────────────────
            domain: {
                type: 'string',
                description:
                    'Domain name, e.g. "example.com". ' +
                    'Required for: create_zone, add_zone_to_server. ' +
                    'Optional filter for: list_records.',
            },
            zone_type: {
                type: 'string',
                enum: ['full', 'partial'],
                description: 'Zone type for create_zone. "full" = Cloudflare is the authoritative DNS. Default: "full".',
            },
            jump_start: {
                type: 'boolean',
                description: 'For create_zone: auto-import existing DNS records. Default: true.',
            },
            zone_id: {
                type: 'string',
                description: 'Cloudflare zone ID. Required for delete_zone. Get it from list_zones.',
            },
            server_id: {
                type: 'string',
                description: 'Cloudstick server ID. Required for add_zone_to_server.',
            },
            // ── DNS record fields ─────────────────────────────────────────────
            record_type: {
                type: 'string',
                description: 'DNS record type: A, AAAA, CNAME, MX, TXT, NS, etc. Required for create_record.',
            },
            name: {
                type: 'string',
                description: 'DNS record name (subdomain or @). Required for create_record.',
            },
            content: {
                type: 'string',
                description: 'DNS record value (IP, domain, TXT value). Required for create_record.',
            },
            ttl: {
                type: 'number',
                description: 'TTL in seconds (1 = auto). Optional for create_record.',
            },
            proxied: {
                type: 'boolean',
                description: 'Whether to proxy traffic through Cloudflare. Optional for create_record.',
            },
        },
        required: ['action'],
    },
    approvalTier: 2, // list/read actions are safe; zone create/delete/server-link are Tier 2

    getApprovalRequest(args) {
        const action = String(args.action ?? '');
        const WRITE_ACTIONS = ['create_zone', 'delete_zone', 'add_zone_to_server', 'create_record'];
        if (!WRITE_ACTIONS.includes(action)) return null;

        const descriptions: Record<string, string> = {
            create_zone: `Create Cloudflare zone for domain "${args.domain}" (account: ${args.account_label})`,
            delete_zone: `Delete Cloudflare zone ID "${args.zone_id}" (account: ${args.account_label})`,
            add_zone_to_server: `Add/link domain "${args.domain}" on Cloudflare to server ID ${args.server_id}`,
            create_record: `Create ${args.record_type} DNS record "${args.name}" → "${args.content}" in zone "${args.domain}"`,
        };

        return {
            command: descriptions[action] ?? action,
            targetHost: 'Cloudflare (via Cloudstick API)',
            rationale: descriptions[action] ?? `Cloudflare ${action}`,
        };
    },

    execute: async (args) => {
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
        if (!effectiveUserId) {
            return { success: false, output: 'Cloudstick user ID not configured. Run /setup first.' };
        }

        const client = getCloudstickClient();
        const accountLabel = String(args.account_label ?? '');

        try {
            switch (args.action) {

                case 'list_accounts': {
                    const result = await client.listCloudflareAccounts(effectiveUserId);
                    return { success: true, output: `Cloudflare accounts:\n${JSON.stringify(result, null, 2)}` };
                }

                case 'list_zones': {
                    const result = await client.listCloudflareZones(effectiveUserId, {
                        account_label: accountLabel || undefined,
                        page: args.page as number | undefined,
                        limit: args.limit as number | undefined,
                        search: args.search as string | undefined,
                    });
                    return { success: true, output: `Cloudflare zones:\n${JSON.stringify(result, null, 2)}` };
                }

                case 'list_records': {
                    const result = await client.listDnsRecords(effectiveUserId, {
                        account_label: accountLabel || undefined,
                        zone: args.domain as string | undefined,
                        type: args.record_type as string | undefined,
                    });
                    return { success: true, output: `DNS records:\n${JSON.stringify(result, null, 2)}` };
                }

                case 'create_zone': {
                    if (!args.domain) {
                        return { success: false, output: 'create_zone requires domain.' };
                    }
                    if (!accountLabel) {
                        return { success: false, output: 'create_zone requires account_label. Use list_accounts to find it.' };
                    }
                    const result = await client.createCloudflareZone(
                        effectiveUserId,
                        {
                            account_label: accountLabel,
                            name: String(args.domain),
                            type: (args.zone_type as 'full' | 'partial') ?? 'full',
                            jump_start: (args.jump_start as boolean) ?? true,
                        }
                    );
                    return {
                        success: true,
                        output: [
                            `Cloudflare zone created for ${args.domain}.`,
                            `Next: update your domain registrar's nameservers to the Cloudflare NS records shown below.`,
                            '',
                            JSON.stringify(result, null, 2),
                        ].join('\n'),
                    };
                }

                case 'delete_zone': {
                    if (!args.zone_id) {
                        return { success: false, output: 'delete_zone requires zone_id. Use list_zones to find it.' };
                    }
                    if (!accountLabel) {
                        return { success: false, output: 'delete_zone requires account_label.' };
                    }
                    const result = await client.deleteCloudflareZone(
                        effectiveUserId,
                        String(args.zone_id),
                        { account_label: accountLabel! }
                    );
                    return {
                        success: true,
                        output: `Cloudflare zone ${args.zone_id} deleted.\n${JSON.stringify(result, null, 2)}`,
                    };
                }

                case 'add_zone_to_server': {
                    if (!args.domain) {
                        return { success: false, output: 'add_zone_to_server requires domain.' };
                    }
                    if (!args.server_id) {
                        return { success: false, output: 'add_zone_to_server requires server_id. Use get_cloudstick_servers to find it.' };
                    }
                    if (!accountLabel) {
                        return { success: false, output: 'add_zone_to_server requires account_label.' };
                    }
                    const result = await client.addZoneToServer(
                        String(args.server_id),
                        effectiveUserId,
                        { account_label: accountLabel, domain: String(args.domain) }
                    );
                    return {
                        success: true,
                        output: [
                            `Domain "${args.domain}" added/linked to server ${args.server_id} on Cloudflare.`,
                            '',
                            JSON.stringify(result, null, 2),
                        ].join('\n'),
                    };
                }

                case 'create_record': {
                    if (!args.domain || !args.record_type || !args.name || !args.content) {
                        return { success: false, output: 'create_record requires domain, record_type, name, and content.' };
                    }
                    if (!accountLabel) {
                        return { success: false, output: 'create_record requires account_label.' };
                    }
                    const result = await client.createDnsRecord(effectiveUserId, {
                        account_label: accountLabel,
                        zone: String(args.domain),
                        type: String(args.record_type),
                        name: String(args.name),
                        content: String(args.content),
                        ttl: args.ttl as number | undefined,
                        proxied: args.proxied as boolean | undefined,
                    });
                    return { success: true, output: `DNS record created:\n${JSON.stringify(result, null, 2)}` };
                }

                default:
                    return {
                        success: false,
                        output: `Unknown action: ${args.action}. Valid: list_zones, list_records, list_accounts, create_zone, delete_zone, add_zone_to_server, create_record.`,
                    };
            }
        } catch (err: any) {
            return { success: false, output: `Cloudflare operation failed: ${err.message}` };
        }
    },
};
