import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

export const fixWordpressTool: Tool = {
    name: 'fix_wordpress',
    description:
        'Diagnose and fix WordPress white screen of death (WSOD) on a remote host. ' +
        'Detects WP root from an nginx vhost, enables WP_DEBUG, checks debug.log for fatal errors, ' +
        'and can disable problematic plugins. Use when the user reports a WordPress site showing blank page or 500 error.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
            site_root: {
                type: 'string',
                description: 'WordPress root directory (e.g. /var/www/html). If unknown, the tool will try to detect it.',
            },
        },
        required: ['host'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host ?? '').trim();
        let siteRoot = String(args.site_root ?? '').trim();

        if (!host) {
            return { success: false, output: 'Error: host is required.' };
        }

        try {
            // 1. Auto-detect WP root if not provided
            if (!siteRoot) {
                const detected = await sshExec(host,
                    "grep -rl 'root ' /etc/nginx/sites-enabled/ 2>/dev/null | head -1 | xargs grep 'root ' 2>/dev/null | grep -oP 'root\\s+\\K[^;]+' | head -1"
                );
                siteRoot = detected.trim() || '/var/www/html';
            }

            // 2. Check wp-config.php exists
            const wpConfigCheck = await sshExec(host, `test -f ${siteRoot}/wp-config.php && echo "EXISTS" || echo "MISSING"`);
            if (wpConfigCheck.trim() === 'MISSING') {
                return {
                    success: false,
                    output: `WordPress not found at ${siteRoot}/wp-config.php. ` +
                        `Provide the correct site_root parameter.`,
                };
            }

            // 3. Check WP_DEBUG status
            const debugStatus = await sshExec(host,
                `grep -c "WP_DEBUG.*true" ${siteRoot}/wp-config.php 2>/dev/null || echo "0"`
            );

            // 4. Enable WP_DEBUG if not already on
            let debugEnabled = false;
            if (debugStatus.trim() === '0') {
                await sshExec(host, `cp ${siteRoot}/wp-config.php ${siteRoot}/wp-config.php.cloudclaw.bak.$(date +%s)`);
                await sshExec(host,
                    `sed -i "s/define.*WP_DEBUG.*false.*/define('WP_DEBUG', true); define('WP_DEBUG_LOG', true); define('WP_DEBUG_DISPLAY', false);/" ${siteRoot}/wp-config.php`
                );
                // If no WP_DEBUG line existed, add it before "That's all"
                await sshExec(host,
                    `grep -q WP_DEBUG ${siteRoot}/wp-config.php || sed -i "/That's all/i define('WP_DEBUG', true); define('WP_DEBUG_LOG', true); define('WP_DEBUG_DISPLAY', false);" ${siteRoot}/wp-config.php`
                );
                debugEnabled = true;
            }

            // 5. Check debug.log
            const debugLog = await sshExec(host,
                `tail -30 ${siteRoot}/wp-content/debug.log 2>/dev/null || echo "(no debug.log found)"`
            );

            // 6. Check PHP fatal errors in recent error log
            const phpErrors = await sshExec(host,
                `tail -20 /var/log/php*-fpm*.log 2>/dev/null || tail -20 /var/log/php*/error.log 2>/dev/null || echo "(no PHP error log found)"`
            );

            // 7. List plugins
            const plugins = await sshExec(host,
                `ls -la ${siteRoot}/wp-content/plugins/ 2>/dev/null | head -20`
            );

            // 8. Check .maintenance file
            const maintenance = await sshExec(host,
                `test -f ${siteRoot}/.maintenance && echo "MAINTENANCE MODE ACTIVE — remove .maintenance file" || echo "Not in maintenance mode"`
            );

            const report = [
                `WordPress diagnostics for ${host}`,
                `Site root: ${siteRoot}`,
                '',
                `1) wp-config.php: Found`,
                `   WP_DEBUG enabled: ${debugEnabled ? 'Just enabled (was off)' : 'Already on'}`,
                '',
                '2) debug.log (last 30 lines):',
                '```',
                debugLog,
                '```',
                '',
                '3) PHP error log:',
                '```',
                phpErrors,
                '```',
                '',
                '4) Plugins:',
                '```',
                plugins,
                '```',
                '',
                `5) Maintenance mode: ${maintenance.trim()}`,
            ].join('\n');

            return { success: true, output: report };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `WordPress fix failed on ${host}: ${msg}` };
        }
    },
};
