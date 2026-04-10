/**
 * PHP Pool Deep Diagnostics Tool
 *
 * Performs forensic analysis on a specific PHP-FPM version and pool.
 * Use this when a site returns 502 and you've identified the exact PHP
 * version from the Nginx vhost config. Covers:
 *   - systemctl status + journal on failure
 *   - pool config file presence in /etc/phpXcs/fpm-pools.d/
 *   - socket file existence in /run/ or /var/run/
 */

import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

export const diagnosePhpPoolTool: Tool = {
    name: 'diagnose_php_pool',
    description:
        'Deep forensic diagnostics for a specific PHP-FPM version and website pool. ' +
        'Use when a site returns a 502 Bad Gateway and you have identified the exact PHP version from the Nginx vhost. ' +
        'Checks: service status, journal logs (on failure), pool config files, and socket existence. ' +
        'Parameters: php_version (e.g. "81", "82", "83", "84", "85"), pool_name (e.g. "whitelabal", "example.com").',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (preferred over host)',
            },
            host: {
                type: 'string',
                description: 'Legacy: IP or hostname. Prefer server_label.',
            },
            php_version: {
                type: 'string',
                description: 'PHP version digits without dots (e.g. "81" for PHP 8.1, "84" for PHP 8.4)',
            },
            pool_name: {
                type: 'string',
                description: 'Pool name — typically the website label or domain label (e.g. "whitelabal", "example.com"). Used to locate the pool .conf file and socket.',
            },
        },
        required: ['php_version', 'pool_name'],
    },
    approvalTier: 1,

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const phpVersion = String(args.php_version ?? '').trim().replace(/\./g, '');
        const poolName = String(args.pool_name ?? '').trim();

        if (!phpVersion) {
            return { success: false, output: 'Error: php_version is required (e.g. "81" for PHP 8.1).' };
        }
        if (!poolName) {
            return { success: false, output: 'Error: pool_name is required (e.g. "whitelabal" or "example.com").' };
        }

        const serviceName = `php${phpVersion}cs-fpm`;
        const poolDir = `/etc/php${phpVersion}cs/fpm-pools.d`;
        const sections: string[] = [];

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };
            const target = formatServerTarget(server);

            sections.push(`PHP Pool Deep Diagnostics — ${target}`);
            sections.push(`Service: ${serviceName} | Pool: ${poolName}`);
            sections.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            // ── 1. systemctl status ───────────────────────────────────────────
            const statusOut = await sshExec(
                server.ip,
                `systemctl status ${serviceName} 2>&1`,
                sshOptions
            );
            sections.push('\n1) Service Status:');
            sections.push('```');
            sections.push(statusOut || '(no output)');
            sections.push('```');

            // ── 2. Journal logs — only if service is not active ───────────────
            const isFailed = /failed|inactive/i.test(statusOut);
            if (isFailed) {
                const journalOut = await sshExec(
                    server.ip,
                    `journalctl -u ${serviceName} -n 50 --no-pager 2>&1`,
                    sshOptions
                ).catch(() => '(journalctl failed or not available)');
                sections.push('\n2) Journal Logs (last 50 lines — service is failed/inactive):');
                sections.push('```');
                sections.push(journalOut || '(no output)');
                sections.push('```');
            } else {
                sections.push('\n2) Journal Logs: skipped — service appears active.');
            }

            // ── 3. Pool config files ──────────────────────────────────────────
            const poolFilesOut = await sshExec(
                server.ip,
                `ls -la ${poolDir}/ 2>&1`,
                sshOptions
            ).catch(() => `(failed to list ${poolDir})`);
            sections.push(`\n3) Pool Config Files in ${poolDir}/:`);
            sections.push('```');
            sections.push(poolFilesOut || '(no output)');
            sections.push('```');

            // Check if the specific pool conf exists or is disabled
            const poolConfCheck = await sshExec(
                server.ip,
                `ls -la ${poolDir}/${poolName}.conf ${poolDir}/${poolName}.conf.disabled ${poolDir}/${poolName}.conf.bak 2>&1 || echo "(not found)"`,
                sshOptions
            ).catch(() => '(check failed)');
            sections.push(`\n   → Looking for "${poolName}.conf":`);
            sections.push('   ' + poolConfCheck.replace(/\n/g, '\n   '));

            // ── 4. Socket existence ───────────────────────────────────────────
            // Cloudstick may place sockets in /run/ or /var/run/
            const socketPatterns = [
                `/run/${serviceName}-${poolName}.sock`,
                `/run/php${phpVersion}cs-fpm-${poolName}.sock`,
                `/var/run/${serviceName}-${poolName}.sock`,
                `/run/${poolName}.sock`,
            ];
            const socketCheckCmd = socketPatterns
                .map(p => `test -S ${p} && echo "EXISTS: ${p}" || echo "MISSING: ${p}"`)
                .join('; ');
            const socketOut = await sshExec(
                server.ip,
                socketCheckCmd,
                sshOptions
            ).catch(() => '(socket check failed)');
            sections.push('\n4) Socket File Check:');
            sections.push('```');
            sections.push(socketOut || '(no output)');
            sections.push('```');

            // ── Summary ───────────────────────────────────────────────────────
            sections.push('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            const hasPoolConf = poolFilesOut.includes(`${poolName}.conf`) && !poolFilesOut.includes(`${poolName}.conf.disabled`);
            const hasSocket = socketOut.includes('EXISTS:');

            const summary: string[] = ['Summary:'];
            summary.push(`  • ${serviceName}: ${isFailed ? '❌ FAILED/INACTIVE' : '✅ Active'}`);
            summary.push(`  • Pool config (${poolName}.conf): ${hasPoolConf ? '✅ Found' : '⚠️  Not found or disabled'}`);
            summary.push(`  • Socket: ${hasSocket ? '✅ Exists' : '❌ Missing'}`);

            if (isFailed) {
                summary.push('\nRecommended next step: Check the journal logs above for syntax errors in the pool config.');
                summary.push(`  If a bad directive is found, use execute_ssh_command to inspect ${poolDir}/${poolName}.conf`);
                summary.push('  then execute_ssh_write to surgically remove the bad line.');
            } else if (!hasSocket) {
                summary.push('\nService is active but socket is missing. The pool may not have started cleanly.');
                summary.push(`  Check if ${poolDir}/${poolName}.conf has the correct listen path.`);
            } else if (!hasPoolConf) {
                summary.push(`\nPool config missing. Look for a .disabled or .bak file in ${poolDir}/ and rename it to .conf,`);
                summary.push(`  then restart ${serviceName}.`);
            }

            sections.push(summary.join('\n'));

            return { success: true, output: sections.join('\n') };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `diagnose_php_pool failed: ${msg}` };
        }
    },
};
