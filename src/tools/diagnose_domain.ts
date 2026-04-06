import { sshExec, sanitizeDomain } from '../utils/ssh.js';
import { getAllServers, getServerByLabel } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

const CLOUDFLARE_IP_PREFIXES = ['104.', '172.67.', '162.158.', '190.93.', '103.21.', '103.22.'];

function settledText(result: PromiseSettledResult<string>): string {
    return result.status === 'fulfilled'
        ? (result.value.trim() || '(no output)')
        : '(unavailable)';
}

function firstNonEmptyLine(text: string): string {
    return text
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean) ?? '(none)';
}

function extractTitle(text: string): string {
    const match = text.match(/<title>[^<]*<\/title>/i);
    return match?.[0]?.trim() ?? firstNonEmptyLine(text);
}

function extractProxyTarget(text: string): string {
    const match = text.match(/proxy_pass\s+(?:https?:\/\/)?([^;\s]+)/i);
    return match?.[1]?.trim() ?? 'not found';
}

function extractPort(proxyTarget: string): string | null {
    const match = proxyTarget.match(/:(\d{2,5})(?:\/|$)/);
    return match?.[1] ?? null;
}

function findContainerForPort(dockerOutput: string, port: string | null): string {
    if (!port) return 'not found';

    const line = dockerOutput
        .split('\n')
        .find((entry) => entry.includes(`:${port}->`) || entry.includes(`0.0.0.0:${port}`) || entry.includes(`:::${port}`));

    return line?.trim() ?? 'not found';
}

export const diagnoseDomainTool: Tool = {
    name: 'diagnose_domain',
    description: 'Full domain routing diagnostic. ALWAYS run this first for any domain/subdomain issue. Never touch nginx or Docker configs before running this.',
    approvalTier: 1,
    parameters: {
        type: 'object',
        properties: {
            domain: {
                type: 'string',
                description: 'Full domain or subdomain, e.g. pro.ajul.site.',
            },
            server_label: {
                type: 'string',
                description: 'Target server label or ID from Cloudstick API (use get_cloudstick_servers to find active server IDs).',
            },
            expected_service: {
                type: 'string',
                description: 'What the domain should show, if known.',
            },
        },
        required: ['domain'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const domain = sanitizeDomain(String(args.domain ?? '').trim().toLowerCase());
        const serverLabel = String(args.server_label ?? '').trim();
        const expectedService = String(args.expected_service ?? '').trim();

        try {
            const server = serverLabel
                ? await getServerByLabel(serverLabel)
                : (await getAllServers())[0];

            if (!server) {
                return { success: false, output: 'Server not found in registry' };
            }

            const sshOptions = { user: server.sshUser, port: server.sshPort };
            const [
                dnsResult,
                directCurlResult,
                nginxConfigPathResult,
                nginxConfigBlockResult,
                dockerPsResult,
                portBindingsResult,
            ] = await Promise.allSettled([
                sshExec(server.ip, `dig +short ${domain}`, sshOptions),
                sshExec(server.ip, `curl -s -H "Host: ${domain}" http://127.0.0.1 | grep -o '<title>[^<]*</title>' | head -1`, sshOptions),
                sshExec(server.ip, `grep -rl "${domain}" /etc/nginx-cs/vhosts.d/ 2>/dev/null | head -3`, sshOptions),
                sshExec(server.ip, `grep -A15 "server_name ${domain}" /etc/nginx-cs/vhosts.d/*.conf /etc/nginx-cs/vhosts.d/*.d/*.conf 2>/dev/null`, sshOptions),
                sshExec(server.ip, `docker ps --format "table {{.Names}}\\t{{.Ports}}\\t{{.Status}}"`, sshOptions),
                sshExec(server.ip, `ss -tlnp | grep -E '808[0-9]'`, sshOptions),
            ]);

            const dns = settledText(dnsResult);
            const directCurlTitle = extractTitle(settledText(directCurlResult));
            const nginxConfigPath = firstNonEmptyLine(settledText(nginxConfigPathResult));
            const nginxConfigBlock = settledText(nginxConfigBlockResult);
            const dockerOutput = settledText(dockerPsResult);
            const portBindings = settledText(portBindingsResult);

            const proxyPassTarget = extractProxyTarget(nginxConfigBlock);
            const mappedPort = extractPort(proxyPassTarget);
            const dockerForPort = findContainerForPort(dockerOutput, mappedPort);

            const isCloudflareProxied = CLOUDFLARE_IP_PREFIXES.some((prefix) => dns.includes(prefix));
            const normalizedTitle = directCurlTitle.toLowerCase();
            const normalizedExpected = expectedService.toLowerCase();

            // Inference from the requested example: if Cloudflare is in front and the server
            // already returns the expected service directly, the stale browser result is likely cache.
            const cacheMismatch = isCloudflareProxied
                && !!normalizedExpected
                && normalizedTitle.includes(normalizedExpected);

            let statusLine = 'No cache mismatch detected.';
            let recommendation = 'Review nginx config and port mapping before making changes.';
            if (cacheMismatch) {
                statusLine = 'MISMATCH DETECTED: Cloudflare is caching old content';
                recommendation = `Run cloudflare_cache_purge for ${domain}. No nginx changes needed.`;
            } else if (isCloudflareProxied && normalizedExpected && !normalizedTitle.includes(normalizedExpected)) {
                statusLine = 'MISMATCH DETECTED: Direct server content does not match the expected service';
                recommendation = 'This looks like a server-side routing problem. Check nginx server_name and proxy_pass before touching Cloudflare.';
            } else if (isCloudflareProxied) {
                recommendation = 'Cloudflare is in front of this domain. If the browser still disagrees with direct curl, purge Cloudflare cache before editing nginx.';
            }

            const dnsDisplay = dns === '(unavailable)'
                ? dns
                : `${firstNonEmptyLine(dns)}${isCloudflareProxied ? ' (Cloudflare proxied)' : ''}`;

            const output = [
                `DOMAIN MAP — ${domain}`,
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                `Server checked:       ${server.label} (${server.ip})`,
                expectedService ? `Expected service:    ${expectedService}` : undefined,
                `DNS resolves to:      ${dnsDisplay}`,
                `Direct server curl:   ${directCurlTitle}`,
                `nginx config:         ${nginxConfigPath}`,
                `proxy_pass:           ${proxyPassTarget}`,
                `Docker on ${mappedPort ?? 'port ?'}:     ${dockerForPort}`,
                '',
                'nginx block:',
                nginxConfigBlock || '(no nginx block found)',
                '',
                'port bindings:',
                portBindings || '(no 808x listeners found)',
                '',
                statusLine,
                `RECOMMENDATION: ${recommendation}`,
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            ]
                .filter(Boolean)
                .join('\n');

            return { success: true, output };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: `Domain diagnostics failed for ${domain}: ${message}`,
            };
        }
    },
};
