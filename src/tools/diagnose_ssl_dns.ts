import { sshExec, sanitizeDomain } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

export const diagnoseSslDnsTool: Tool = {
    name: 'diagnose_ssl_dns',
    description:
        'Resolve a domain\'s A record and compare it to the server\'s public IP before SSL installation. ' +
        'ALWAYS run this before issuing SSL — if the DNS does not point to the server, Let\'s Encrypt will fail. ' +
        'Returns a clear pass/fail with the actual IPs so the user knows exactly what to fix.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (use get_cloudstick_servers to list). Preferred over host.',
            },
            host: {
                type: 'string',
                description: 'Legacy: IP or hostname of the server. Prefer server_label.',
            },
            domain: {
                type: 'string',
                description: 'Domain or subdomain to check, e.g. "example.com" or "www.example.com".',
            },
            server_ip: {
                type: 'string',
                description:
                    'The public IP the domain must resolve to. If omitted, the server\'s own outbound IP is used.',
            },
        },
        required: ['domain'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const domain = String(args.domain ?? '').trim().toLowerCase();
        const manualServerIp = String(args.server_ip ?? '').trim();

        if (!domain) {
            return { success: false, output: 'Error: domain is required.' };
        }

        let sanitized: string;
        try {
            sanitized = sanitizeDomain(domain);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Error: ${msg}` };
        }

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };

            // Resolve the domain's A record and determine the server's own public IP in parallel.
            const [resolvedRaw, selfIpRaw] = await Promise.all([
                sshExec(server.ip, `dig +short A ${sanitized} 2>/dev/null | head -5`, sshOptions),
                manualServerIp
                    ? Promise.resolve(manualServerIp)
                    : sshExec(
                        server.ip,
                        'curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk \'{print $1}\'',
                        sshOptions
                      ),
            ]);

            const resolvedIps = resolvedRaw
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean);

            const serverIp = (manualServerIp || selfIpRaw).trim().split('\n')[0].trim();

            if (resolvedIps.length === 0) {
                return {
                    success: false,
                    output: [
                        `SSL DNS Check — ${sanitized}`,
                        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                        `Server: ${formatServerTarget(server)}`,
                        `Server IP: ${serverIp}`,
                        `DNS A record: (no record found)`,
                        '',
                        'FAIL: No A record found for this domain.',
                        'ACTION REQUIRED: Create an A record pointing to ' + serverIp + ' before issuing SSL.',
                        'Do NOT attempt SSL installation.',
                    ].join('\n'),
                };
            }

            const matched = resolvedIps.includes(serverIp);

            const statusLine = matched
                ? `PASS: DNS resolves to the correct server IP.`
                : `FAIL: DNS mismatch — domain does not point to this server.`;

            const advice = matched
                ? `SSL installation should succeed. Proceed with issueSSL or manageSsl.`
                : `ACTION REQUIRED: Update your DNS A record to ${serverIp}.\n` +
                  `Do NOT attempt SSL installation until DNS propagates (typically 5–30 min after change).`;

            return {
                success: matched,
                output: [
                    `SSL DNS Check — ${sanitized}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    `Server:          ${formatServerTarget(server)}`,
                    `Server IP:       ${serverIp}`,
                    `DNS A record(s): ${resolvedIps.join(', ')}`,
                    '',
                    statusLine,
                    advice,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `diagnose_ssl_dns failed: ${msg}` };
        }
    },
};
