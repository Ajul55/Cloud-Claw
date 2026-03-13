import { getPool, isDBConfigured } from '../database/db.js';

export interface ServerNode {
    id: number;
    label: string;
    ip: string;
    sshUser: string;
    sshPort: number;
    active: boolean;
}

export const FALLBACK_SERVERS: ServerNode[] = [
    { id: 1, label: 'production', ip: '139.84.130.63', sshUser: 'root', sshPort: 22, active: true },
    { id: 2, label: 'test', ip: '65.20.82.177', sshUser: 'root', sshPort: 22, active: true },
];

export async function getAllServers(): Promise<ServerNode[]> {
    if (!isDBConfigured()) return FALLBACK_SERVERS;

    try {
        const result = await getPool().query<ServerNode>(
            `SELECT id,
                    label,
                    ip,
                    ssh_user AS "sshUser",
                    ssh_port AS "sshPort",
                    active
             FROM servers
             WHERE active = true
             ORDER BY id`
        );
        return result.rows;
    } catch (err) {
        console.warn('[server_registry] Falling back to in-memory registry:', err);
        return FALLBACK_SERVERS;
    }
}

export async function getServerByLabel(label: string): Promise<ServerNode | null> {
    const normalized = label.trim().toLowerCase();
    const servers = await getAllServers();
    return servers.find((server) => server.label.toLowerCase() === normalized) ?? null;
}

export async function getServerByIp(ip: string): Promise<ServerNode | null> {
    const normalized = ip.trim();
    const servers = await getAllServers();
    return servers.find((server) => server.ip === normalized) ?? null;
}

export async function getDefaultServer(): Promise<ServerNode> {
    const servers = await getAllServers();
    return servers[0];
}

export async function resolveServerFromMessage(text: string): Promise<ServerNode | null> {
    const lower = text.toLowerCase();
    if (lower.includes('production') || /\bprod\b/.test(lower)) {
        return getServerByLabel('production');
    }
    if (lower.includes('test') || lower.includes('testing') || lower.includes('staging')) {
        return getServerByLabel('test');
    }

    const servers = await getAllServers();
    if (servers.length === 1) return servers[0];
    return null;
}

export async function resolveAllServers(): Promise<ServerNode[]> {
    return getAllServers();
}

export function isAllServersRequest(text: string): boolean {
    return /\b(all servers|both servers|every server)\b/i.test(text);
}

export function formatServerTarget(server: Pick<ServerNode, 'label' | 'ip'>): string {
    return `${server.label} (${server.ip})`;
}

export async function resolveServerArg(args: Record<string, unknown>): Promise<ServerNode> {
    const serverLabel = String(args.server_label ?? '').trim();
    const host = String(args.host ?? '').trim();

    if (serverLabel) {
        const server = await getServerByLabel(serverLabel);
        if (!server) {
            throw new Error(`Server "${serverLabel}" not found in registry`);
        }
        return server;
    }

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

    return getDefaultServer();
}
