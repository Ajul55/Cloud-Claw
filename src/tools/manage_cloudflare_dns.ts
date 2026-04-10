import type { Tool } from './types.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';

export const manageCloudflareDnsTool: Tool = {
    name: 'manage_cloudflare_dns',
    description:
        'Manage Cloudflare DNS records via the Cloudstick API. ' +
        'Supports actions: list_zones, list_records, create_record, list_accounts. ' +
        'Use when the user asks about DNS records, Cloudflare zones, or wants to add/edit DNS.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list_zones', 'list_records', 'create_record', 'list_accounts'],
                description: 'The action to perform',
            },
            account_label: {
                type: 'string',
                description: 'Cloudflare account label (for filtering)',
            },
            zone: {
                type: 'string',
                description: 'DNS zone / domain name (for list_records, create_record)',
            },
            record_type: {
                type: 'string',
                description: 'DNS record type: A, AAAA, CNAME, MX, TXT, NS, etc.',
            },
            name: {
                type: 'string',
                description: 'DNS record name (subdomain or @)',
            },
            content: {
                type: 'string',
                description: 'DNS record value (IP, domain, TXT value)',
            },
            ttl: {
                type: 'number',
                description: 'TTL in seconds (1 = auto)',
            },
            proxied: {
                type: 'boolean',
                description: 'Whether to proxy through Cloudflare',
            },
        },
        required: ['action'],
    },
    approvalTier: 1, // list actions are read-only; create_record will be gated by the agent loop
    execute: async (args) => {
        const effectiveUserId = getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID;
        if (!effectiveUserId) {
            return { success: false, output: 'Cloudstick user ID not configured. Run /setup first.' };
        }
        const client = getCloudstickClient();
        try {
            switch (args.action) {
                case 'list_zones': {
                    const zones = await client.listCloudflareZones(effectiveUserId, {
                        account_label: args.account_label as string | undefined,
                    });
                    return { success: true, output: `Cloudflare zones:\n${JSON.stringify(zones, null, 2)}` };
                }
                case 'list_records': {
                    const records = await client.listDnsRecords(effectiveUserId, {
                        account_label: args.account_label as string | undefined,
                        zone: args.zone as string | undefined,
                        type: args.record_type as string | undefined,
                    });
                    return { success: true, output: `DNS records:\n${JSON.stringify(records, null, 2)}` };
                }
                case 'create_record': {
                    if (!args.zone || !args.record_type || !args.name || !args.content) {
                        return { success: false, output: 'create_record requires zone, record_type, name, and content.' };
                    }
                    const result = await client.createDnsRecord(effectiveUserId, {
                        account_label: (args.account_label as string) ?? '',
                        zone: args.zone as string,
                        type: args.record_type as string,
                        name: args.name as string,
                        content: args.content as string,
                        ttl: args.ttl as number | undefined,
                        proxied: args.proxied as boolean | undefined,
                    });
                    return { success: true, output: `DNS record created:\n${JSON.stringify(result, null, 2)}` };
                }
                case 'list_accounts': {
                    const accounts = await client.listCloudflareAccounts(effectiveUserId);
                    return { success: true, output: `Cloudflare accounts:\n${JSON.stringify(accounts, null, 2)}` };
                }
                default:
                    return { success: false, output: `Unknown action: ${args.action}. Use list_zones, list_records, create_record, or list_accounts.` };
            }
        } catch (err: any) {
            return { success: false, output: `Cloudflare DNS operation failed: ${err.message}` };
        }
    },
};
