import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

export const managePhpTool: Tool = {
    name: 'manage_php',
    description:
        'List installed PHP versions and switch the active PHP-FPM version on a remote host. ' +
        'Use this when the user needs to change PHP version for a site or check which PHP versions are available.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
            action: {
                type: 'string',
                enum: ['list', 'switch'],
                description: '"list" shows installed PHP versions. "switch" changes the active version.',
            },
            target_version: {
                type: 'string',
                description: 'PHP version to switch to (e.g. "8.2"). Required when action is "switch".',
            },
        },
        required: ['host', 'action'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host ?? '').trim();
        const action = String(args.action ?? 'list').trim();
        const targetVersion = String(args.target_version ?? '').trim();

        if (!host) {
            return { success: false, output: 'Error: host is required.' };
        }

        try {
            if (action === 'list') {
                const [installed, active, fpmStatus] = await Promise.all([
                    sshExec(host, 'dpkg -l | grep php | grep -i fpm 2>&1 || echo "(no PHP-FPM packages found)"'),
                    sshExec(host, 'php -v 2>&1 | head -1 || echo "(php cli not found)"'),
                    sshExec(host, 'systemctl list-units --type=service | grep php 2>&1 || echo "(no PHP services found)"'),
                ]);

                return {
                    success: true,
                    output: [
                        `PHP versions on ${host}`,
                        '',
                        '1) Installed PHP-FPM packages:',
                        '```',
                        installed,
                        '```',
                        '',
                        '2) Active PHP CLI:',
                        '```',
                        active,
                        '```',
                        '',
                        '3) PHP-FPM services:',
                        '```',
                        fpmStatus,
                        '```',
                    ].join('\n'),
                };
            }

            if (action === 'switch') {
                if (!targetVersion) {
                    return { success: false, output: 'Error: target_version is required for switch action (e.g. "8.2").' };
                }

                // Find currently active PHP-FPM
                const currentFpm = await sshExec(host,
                    "systemctl list-units --type=service --state=active | grep php | grep fpm | awk '{print $1}' | head -1"
                );
                const currentService = currentFpm.trim();
                const targetService = `php${targetVersion}-fpm`;

                // Check target is installed
                const targetCheck = await sshExec(host,
                    `dpkg -l | grep php${targetVersion}-fpm | grep -c '^ii' 2>/dev/null || echo "0"`
                );
                if (targetCheck.trim() === '0') {
                    return {
                        success: false,
                        output: `PHP ${targetVersion}-FPM is not installed on ${host}. ` +
                            `Install it first: apt install php${targetVersion}-fpm`,
                    };
                }

                // Stop old, start new
                const switchOutput = await sshExec(host, [
                    currentService ? `systemctl stop ${currentService}` : 'true',
                    currentService ? `systemctl disable ${currentService}` : 'true',
                    `systemctl enable ${targetService}`,
                    `systemctl start ${targetService}`,
                    `systemctl is-active ${targetService}`,
                    `systemctl status ${targetService} --no-pager -l | head -15`,
                ].join(' && '));

                return {
                    success: true,
                    output: [
                        `PHP-FPM switch on ${host}`,
                        `Previous: ${currentService || '(none active)'}`,
                        `New: ${targetService}`,
                        '',
                        'Switch output:',
                        '```',
                        switchOutput,
                        '```',
                        '',
                        '⚠️ Remember to update nginx fastcgi_pass to point to the new PHP-FPM socket.',
                    ].join('\n'),
                };
            }

            return { success: false, output: `Unknown action: ${action}. Use "list" or "switch".` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `PHP management failed on ${host}: ${msg}` };
        }
    },
};
