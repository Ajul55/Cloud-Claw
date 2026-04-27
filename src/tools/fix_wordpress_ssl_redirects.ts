import { sshExec, sanitizeDomain } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

// Marker line in wp-config.php — we inject just above it
const WP_CONFIG_STOP_MARKER = "/* That's all, stop editing!";
// The line we inject to force HTTPS recognition behind proxies/Cloudflare Flexible
const HTTPS_INJECTION = "$_SERVER['HTTPS'] = 'on';";

function isSafeUnixPath(path: string): boolean {
    return /^\/[A-Za-z0-9._\-/]+$/.test(path);
}

export const fixWordPressSslRedirectsTool: Tool = {
    name: 'fix_wordpress_ssl_redirects',
    description:
        'Fix WordPress SSL redirect issues: updates the database URLs from http to https using WP-CLI, ' +
        'and injects the HTTPS server variable into wp-config.php to prevent ERR_TOO_MANY_REDIRECTS. ' +
        'Use this for: mixed-content warnings, Cloudflare Flexible SSL redirect loops, siteurl/home mismatch after adding SSL. ' +
        'Requires WP-CLI to be installed on the server.',
    approvalTier: 3,
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label. Preferred over host.',
            },
            host: {
                type: 'string',
                description: 'Legacy: IP or hostname. Prefer server_label.',
            },
            app_root_path: {
                type: 'string',
                description:
                    'Absolute path to the WordPress installation root ' +
                    '(e.g. /home/username/apps/mysite/). Must contain wp-config.php.',
            },
            domain: {
                type: 'string',
                description: 'The domain the WordPress site runs on, e.g. "example.com". Without protocol.',
            },
        },
        required: ['app_root_path', 'domain'],
    },

    getApprovalRequest(args) {
        const domain = String(args.domain ?? '');
        const path = String(args.app_root_path ?? '');
        const serverLabel = String(args.server_label ?? args.host ?? 'default server');
        return {
            command: `wp search-replace http://${domain} https://${domain} --path=${path}\nInject HTTPS into wp-config.php`,
            targetHost: serverLabel,
            rationale:
                `Fix WordPress SSL redirects for ${domain}: update DB URLs http→https and patch wp-config.php to prevent redirect loops`,
        };
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const rawDomain = String(args.domain ?? '').trim().toLowerCase();
        const appRootPath = String(args.app_root_path ?? '').trim().replace(/\/$/, '');

        if (!rawDomain) {
            return { success: false, output: 'Error: domain is required.' };
        }
        if (!appRootPath) {
            return { success: false, output: 'Error: app_root_path is required.' };
        }

        let domain: string;
        try {
            domain = sanitizeDomain(rawDomain);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Error: ${msg}` };
        }

        if (!isSafeUnixPath(appRootPath)) {
            return { success: false, output: `Error: Invalid app_root_path: ${appRootPath}` };
        }

        const wpConfigPath = `${appRootPath}/wp-config.php`;

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };

            // Verify wp-config.php exists before doing anything
            const configCheck = await sshExec(
                server.ip,
                `test -f ${wpConfigPath} && echo "exists" || echo "missing"`,
                sshOptions
            );
            if (configCheck.trim() !== 'exists') {
                return {
                    success: false,
                    output: `Error: wp-config.php not found at ${wpConfigPath}\n` +
                            `Verify the app_root_path is correct for this WordPress installation.`,
                };
            }

            // Check WP-CLI is available
            const wpCliCheck = await sshExec(
                server.ip,
                `which wp 2>/dev/null && wp --version 2>/dev/null | head -1 || echo "WP_CLI_MISSING"`,
                sshOptions
            );
            if (wpCliCheck.includes('WP_CLI_MISSING')) {
                return {
                    success: false,
                    output: `Error: WP-CLI is not installed on ${server.ip}.\n` +
                            `Install with: curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp`,
                };
            }

            // ── Step 1: WP-CLI search-replace http → https ────────────────────────
            const searchReplaceOutput = await sshExec(
                server.ip,
                `wp search-replace 'http://${domain}' 'https://${domain}' --path=${appRootPath} --allow-root 2>&1`,
                sshOptions,
                // WP-CLI can be slow on large DBs
            );

            // ── Step 2: Backup wp-config.php, then inject HTTPS line ──────────────
            const backupPath = `${wpConfigPath}.cloudclaw.bak.${Date.now()}`;
            await sshExec(server.ip, `cp ${wpConfigPath} ${backupPath}`, sshOptions);

            // Check if the injection already exists to avoid duplicates
            const alreadyInjected = await sshExec(
                server.ip,
                `grep -c "$_SERVER\\['HTTPS'\\]" ${wpConfigPath} 2>/dev/null || echo "0"`,
                sshOptions
            );

            let injectionResult: string;
            if (parseInt(alreadyInjected.trim(), 10) > 0) {
                injectionResult = '(already present — skipped to avoid duplicate)';
            } else {
                // Inject the HTTPS line just above the stop-editing marker using sed
                // We use | as the sed delimiter to avoid escaping slashes
                const sedCmd = `sed -i "s|${WP_CONFIG_STOP_MARKER}|${HTTPS_INJECTION}\\n${WP_CONFIG_STOP_MARKER}|" ${wpConfigPath}`;
                await sshExec(server.ip, sedCmd, sshOptions);

                // Verify the injection landed
                const injectionCheck = await sshExec(
                    server.ip,
                    `grep -n "HTTPS" ${wpConfigPath} | head -3`,
                    sshOptions
                );
                injectionResult = injectionCheck || '(verification: line not found — check manually)';
            }

            return {
                success: true,
                output: [
                    `WordPress SSL Redirect Fix — ${formatServerTarget(server)}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    `Domain:      ${domain}`,
                    `WordPress:   ${appRootPath}`,
                    `Config:      ${wpConfigPath}`,
                    `Backup:      ${backupPath}`,
                    `WP-CLI:      ${wpCliCheck.trim()}`,
                    '',
                    'Step 1 — WP-CLI search-replace (http → https):',
                    '```',
                    searchReplaceOutput || '(no output)',
                    '```',
                    '',
                    'Step 2 — HTTPS injection in wp-config.php:',
                    injectionResult,
                    '',
                    'Next steps:',
                    `  1. Clear any caching plugins (W3 Total Cache, WP Super Cache, etc.)`,
                    `  2. Purge Cloudflare cache if applicable.`,
                    `  3. Test https://${domain} — redirect loop should be gone.`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `fix_wordpress_ssl_redirects failed: ${msg}` };
        }
    },
};
