import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

export const checkSslTool: Tool = {
    name: 'check_ssl',
    description:
        'Check SSL/TLS certificate status on a remote host. ' +
        'Lists all certificates managed by Certbot with their expiry dates. ' +
        'Use this when the user asks about SSL, HTTPS, or certificate expiry.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
        },
        required: ['host'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host ?? '').trim();
        if (!host) {
            return { success: false, output: 'Error: host is required.' };
        }

        try {
            const [certbot, openssl] = await Promise.all([
                sshExec(host, 'certbot certificates 2>&1 || echo "(certbot not installed)"'),
                sshExec(host,
                    "for conf in /etc/nginx/sites-enabled/*; do " +
                    "domain=$(grep -oP 'server_name\\s+\\K[^;]+' \"$conf\" 2>/dev/null | head -1); " +
                    "if [ -n \"$domain\" ] && [ \"$domain\" != \"_\" ]; then " +
                    "echo \"--- $domain ---\"; " +
                    "echo | timeout 5 openssl s_client -connect \"$domain\":443 -servername \"$domain\" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || echo '(no cert)'; " +
                    "fi; done"
                ),
            ]);

            const report = [
                `SSL certificate check for ${host}`,
                '',
                '1) Certbot certificates:',
                '```',
                certbot,
                '```',
                '',
                '2) Live certificate expiry (per domain):',
                '```',
                openssl || '(no domains with SSL found)',
                '```',
            ].join('\n');

            return { success: true, output: report };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `SSL check failed on ${host}: ${msg}` };
        }
    },
};

export const renewSslTool: Tool = {
    name: 'renew_ssl',
    description:
        'Renew SSL/TLS certificates on a remote host using Certbot. ' +
        'Runs certbot renew for all certificates or a specific domain. ' +
        'Use this when certificates are expired or expiring soon.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
            domain: {
                type: 'string',
                description: 'Optional specific domain to renew. If omitted, renews all.',
            },
        },
        required: ['host'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host ?? '').trim();
        const domain = String(args.domain ?? '').trim();

        if (!host) {
            return { success: false, output: 'Error: host is required.' };
        }

        try {
            const cmd = domain
                ? `certbot renew --cert-name ${domain} --force-renewal 2>&1`
                : 'certbot renew 2>&1';

            const output = await sshExec(host, cmd);

            // Verify by checking certificates after renewal
            const verify = await sshExec(host, 'certbot certificates 2>&1 | head -30');

            const report = [
                `SSL renewal on ${host}${domain ? ` (domain: ${domain})` : ''}`,
                '',
                '1) Renewal output:',
                '```',
                output,
                '```',
                '',
                '2) Post-renewal certificate status:',
                '```',
                verify,
                '```',
            ].join('\n');

            return { success: true, output: report };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `SSL renewal failed on ${host}: ${msg}` };
        }
    },
};
