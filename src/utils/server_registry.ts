import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';

export interface ServerNode {
    id: number;
    label: string;
    ip: string;
    sshUser: string;
    sshPort: number;
    active: boolean;
}

interface CloudstickApiServer {
    id?: number | string;
    label?: string;
    name?: string;
    host_name?: string;
    ip?: string;
    ip4?: string;
    server_ip?: string;
    is_active?: boolean;
}

export async function getAllServers(): Promise<ServerNode[]> {
    const user = getCloudstickUser();
    const effectiveUserId = user?.cloudstick_user_id ?? (await import('../config/env.js')).env.CLOUDSTICK_USER_ID;
    if (!effectiveUserId) return [];

    try {
        const client = getCloudstickClient();
        const response = await client.listServersByUser(effectiveUserId) as {
            message?: { servers?: CloudstickApiServer[] };
        };
        const servers = response?.message?.servers ?? [];

        const mapped = servers
            .map((s) => ({
                id: typeof s.id === 'string' ? parseInt(s.id, 10) : (s.id ?? 0),
                label: s.name ?? s.label ?? s.host_name ?? 'unknown',
                ip: s.ip4 ?? s.ip ?? s.server_ip ?? '',
                sshUser: 'root',
                sshPort: 22,
                active: true, // Cloudstick API sometimes returns is_active: false for running nodes
            }));
        console.log('[server_registry] Servers from API:', mapped.map(s => `${s.label} (${s.ip}, id=${s.id})`).join(', '));
        return mapped;
    } catch (err) {
        console.warn('[server_registry] Cloudstick API failed:', err);
        return [];
    }
}

export async function getServerByLabel(label: string): Promise<ServerNode | null> {
    const normalized = label.trim().toLowerCase();
    const servers = await getAllServers();

    // 1. Exact match
    const exact = servers.find((server) => server.label.toLowerCase() === normalized);
    if (exact) return exact;

    // 2. Partial/includes match (e.g. "mail-server" matches "mail-server-01" or vice versa)
    const partial = servers.find((server) => {
        const sl = server.label.toLowerCase();
        return sl.includes(normalized) || normalized.includes(sl);
    });
    if (partial) {
        console.log(`[server_registry] Partial match: "${label}" → "${partial.label}"`);
        return partial;
    }

    // 3. Normalized match (strip hyphens, underscores, spaces for comparison)
    const strip = (s: string) => s.replace(/[-_ ]/g, '').toLowerCase();
    const normalizedStripped = strip(normalized);
    const stripped = servers.find((server) => strip(server.label) === normalizedStripped);
    if (stripped) {
        console.log(`[server_registry] Normalized match: "${label}" → "${stripped.label}"`);
        return stripped;
    }

    // 4. Levenshtein fuzzy match (typos)
    for (const server of servers) {
        if (levenshtein(normalized, server.label.toLowerCase()) <= 2) {
            console.log(`[server_registry] Fuzzy match: "${label}" → "${server.label}"`);
            return server;
        }
    }

    console.warn(`[server_registry] No match for "${label}". Available: ${servers.map(s => s.label).join(', ')}`);
    return null;
}

export async function getServerByIp(ip: string): Promise<ServerNode | null> {
    const normalized = ip.trim();
    const servers = await getAllServers();
    return servers.find((server) => server.ip === normalized) ?? null;
}

export async function getDefaultServer(): Promise<ServerNode> {
    const servers = await getAllServers();
    if (servers.length === 0) {
        throw new Error('No servers available in registry. Check Cloudstick API credentials.');
    }
    return servers[0];
}

export async function resolveServerFromMessage(text: string): Promise<ServerNode | null> {
    const lower = text.toLowerCase();
    const servers = await getAllServers();

    // ─── Phase 4: Expanded nickname dictionary ──────────────────────────
    // Maps common user-facing terms to canonical server labels.
    const NICKNAME_MAP: Record<string, string[]> = {
        production: [
            'production', 'prod', 'live', 'main', 'primary', 'master',
            'real', 'public', 'customer', 'paying', 'deployed',
        ],
        test: [
            'test', 'testing', 'staging', 'stage', 'dev', 'development',
            'sandbox', 'preview', 'demo', 'qa', 'uat', 'canary',
            'internal', 'debug', 'pre-prod', 'preprod',
        ],
    };

    // Try nickname match first
    for (const [label, aliases] of Object.entries(NICKNAME_MAP)) {
        for (const alias of aliases) {
            const regex = new RegExp(`\\b${alias}\\b`, 'i');
            if (regex.test(lower)) {
                const server = servers.find(s => s.label.toLowerCase() === label);
                if (server) return server;
            }
        }
    }

    // Try matching server label or IP directly in the text
    for (const server of servers) {
        if (lower.includes(server.label.toLowerCase()) || text.includes(server.ip)) {
            return server;
        }
    }

    // ─── Phase 4: Fuzzy matching with Levenshtein distance ──────────────
    // Handles typos like "producton", "testng", "produciton"
    const words = lower.split(/\s+/).filter(w => w.length >= 3);
    for (const word of words) {
        for (const server of servers) {
            if (levenshtein(word, server.label.toLowerCase()) <= 2) {
                return server;
            }
        }
        // Also check against nickname aliases
        for (const [label, aliases] of Object.entries(NICKNAME_MAP)) {
            for (const alias of aliases) {
                if (levenshtein(word, alias) <= 1) {
                    const server = servers.find(s => s.label.toLowerCase() === label);
                    if (server) return server;
                }
            }
        }
    }

    // No match with only one => auto-resolve (for read-only ops)
    if (servers.length === 1) return servers[0];
    return null;
}

/** Simple Levenshtein distance for fuzzy server name matching */
function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

export async function resolveAllServers(): Promise<ServerNode[]> {
    return getAllServers();
}



export function formatServerTarget(server: Pick<ServerNode, 'label' | 'ip'>): string {
    return `${server.label} (${server.ip})`;
}

export async function resolveServerArg(args: Record<string, unknown>): Promise<ServerNode> {
    const serverLabel = String(args.server_label ?? '').trim();
    const host = String(args.host ?? '').trim();
    const serverId = String(args.server_id ?? '').trim();

    // Try by label first (now with fuzzy matching)
    if (serverLabel) {
        const server = await getServerByLabel(serverLabel);
        if (server) return server;
        // Don't throw yet — try other args or fallback to ID
        console.warn(`[server_registry] Label "${serverLabel}" not found, trying other args...`);
    }

    // Try by server ID
    if (serverId && serverId !== '0') {
        const servers = await getAllServers();
        const byId = servers.find(s => String(s.id) === serverId);
        if (byId) {
            console.log(`[server_registry] Resolved by ID: ${serverId} → ${byId.label}`);
            return byId;
        }
    }

    // Try by IP/host
    if (host) {
        const known = await getServerByIp(host);
        if (known) return known;
        return {
            id: 0,
            label: host,
            ip: host,
            sshUser: 'root',
            sshPort: 22,
            active: true,
        };
    }

    // If we had a label but nothing matched, throw a helpful error
    if (serverLabel) {
        const servers = await getAllServers();
        const available = servers.map(s => `"${s.label}" (ID: ${s.id})`).join(', ');
        throw new Error(`Server "${serverLabel}" not found in registry. Available servers: ${available}`);
    }

    return getDefaultServer();
}
