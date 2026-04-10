import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

export const diagnoseServicesTool: Tool = {
    name: 'diagnose_services',
    description:
        'Run a multi-service health check on a remote host. ' +
        'Checks status of MariaDB, MySQL, Nginx-CS, PHP-FPM (8.1–8.5), Redis, CSF firewall, and system resources (disk, memory, uptime). ' +
        'Use this for broad server diagnostics or when the user says "everything is down" or "check all services".',
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
            const [services, failedUnits, disk, memory, uptime, listeners, csfPorts, csfTempBlocks] = await Promise.all([
                sshExec(host, 'systemctl status mariadb mysql nginx-cs apache2-cs redis-server pureftpd-cs php81cs-fpm php82cs-fpm php83cs-fpm php84cs-fpm php85cs-fpm 2>&1'),
                sshExec(host, 'systemctl list-units --state=failed --no-pager 2>&1'),
                sshExec(host, 'df -h 2>&1'),
                sshExec(host, 'free -m 2>&1'),
                sshExec(host, 'uptime 2>&1'),
                sshExec(host, 'ss -tlnp 2>&1 | head -20'),
                sshExec(host, 'grep -E "^(TCP_IN|TCP_OUT)" /etc/csf/csf.conf 2>/dev/null || echo "(csf.conf not found)"'),
                sshExec(host, 'csf -l 2>&1 | head -20 || echo "(csf -l failed)"'),
            ]);

            const report = [
                `Multi-service diagnostics for ${host}`,
                '',
                '1) Service Status (ALL PHP 8.1–8.5 + core services):',
                '```',
                services || '(no output)',
                '```',
                '',
                '⚠️  Failed/Degraded Units:',
                '```',
                failedUnits || '(none)',
                '```',
                '',
                '2) Disk Usage:',
                '```',
                disk || '(no output)',
                '```',
                '',
                '3) Memory:',
                '```',
                memory || '(no output)',
                '```',
                '',
                '4) Uptime / Load:',
                '```',
                uptime || '(no output)',
                '```',
                '',
                '5) Listening Ports:',
                '```',
                listeners || '(no output)',
                '```',
                '',
                '6) CSF Firewall — Open Ports (TCP_IN/TCP_OUT):',
                '```',
                csfPorts || '(no output)',
                '```',
                '',
                '7) CSF Temp Blocks (first 20):',
                '```',
                csfTempBlocks || '(none)',
                '```',
            ].join('\n');

            return { success: true, output: report };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Service diagnostics failed on ${host}: ${msg}` };
        }
    },
};
