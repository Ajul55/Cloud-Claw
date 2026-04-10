import { sshExec, sanitizeDomain } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

// Cloudstick uses a custom nginx-cs binary — test/reload with its binary path or the systemctl unit
const NGINX_TEST_CMD = '/CloudStick/Packages/nginx-cs/sbin/nginx -t 2>&1 || nginx-cs -t 2>&1';
const NGINX_RELOAD_CMD = 'systemctl reload nginx-cs 2>&1 && systemctl is-active nginx-cs';

function nginxTestPassed(output: string): boolean {
    return /syntax is ok/i.test(output) && /test is successful/i.test(output);
}

/**
 * Validates rewrite_code to prevent trivial injection.
 * Allowed: alphanumeric, whitespace, common nginx chars (^$./~=_-;{}[]()#)
 * Blocked: backticks, $( command substitution), pipe chains to shell
 */
function isRewriteCodeSafe(code: string): boolean {
    // Block shell metacharacters that could escape the nginx config context
    const BLOCKED = /`|\$\(|&&|\|\|/;
    return !BLOCKED.test(code);
}

export const manageVhostRewriteRulesTool: Tool = {
    name: 'manage_vhost_rewrite_rules',
    description:
        'Safely append Nginx rewrite rules to a Cloudstick vhost config file. ' +
        'Automatically validates syntax with nginx-cs -t and rolls back if invalid. ' +
        'Reloads nginx-cs only when the test passes. ' +
        'Use this for: domain redirects, trailing-slash rules, canonical rewrites, custom rewrite blocks.',
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
            domain: {
                type: 'string',
                description:
                    'Domain whose vhost config to edit. Config must exist at ' +
                    '/etc/nginx-cs/vhosts.d/<domain>.conf',
            },
            rewrite_code: {
                type: 'string',
                description:
                    'The nginx directive(s) to append. ' +
                    'Provide only the rule lines — NOT a full server block. ' +
                    'Example: "rewrite ^/old-page/?$ /new-page permanent;"',
            },
        },
        required: ['domain', 'rewrite_code'],
    },

    getApprovalRequest(args) {
        const domain = String(args.domain ?? '');
        const rewriteCode = String(args.rewrite_code ?? '');
        const serverLabel = String(args.server_label ?? args.host ?? 'default server');

        return {
            command: `Append nginx rewrite rule for "${domain}":\n${rewriteCode}`,
            targetHost: serverLabel,
            rationale:
                `Append nginx rewrite rule to the vhost config for "${domain}" (file discovered at runtime via server_name grep). ` +
                `Will validate with nginx-cs -t and auto-revert if syntax fails.`,
        };
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const rawDomain = String(args.domain ?? '').trim().toLowerCase();
        const rewriteCode = String(args.rewrite_code ?? '').trim();

        if (!rawDomain) {
            return { success: false, output: 'Error: domain is required.' };
        }
        if (!rewriteCode) {
            return { success: false, output: 'Error: rewrite_code is required.' };
        }

        let domain: string;
        try {
            domain = sanitizeDomain(rawDomain);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Error: ${msg}` };
        }

        if (!isRewriteCodeSafe(rewriteCode)) {
            return {
                success: false,
                output: `Error: rewrite_code contains disallowed shell metacharacters. ` +
                        `Provide only nginx directive lines.`,
            };
        }

        const vhostDir = '/etc/nginx-cs/vhosts.d';
        const backupSuffix = `.cloudclaw.bak.${Date.now()}`;

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };

            // ── Discovery: find the real conf file for this domain ────────────────
            // Cloudstick may use a shorthand label (e.g. whitelabal.conf) rather than
            // the full domain name as the filename. Search by server_name directive first.
            const discovered = await sshExec(
                server.ip,
                `grep -rl "server_name.*${domain}" ${vhostDir}/*.conf 2>/dev/null | head -n 1`,
                sshOptions
            );
            const discoveredPath = discovered.trim();

            // Fall back to the conventional <domain>.conf if grep found nothing
            const confPath = discoveredPath || `${vhostDir}/${domain}.conf`;

            // If neither exists, list available files and bail
            if (!discoveredPath) {
                const fileCheck = await sshExec(
                    server.ip,
                    `test -f ${confPath} && echo "exists" || echo "missing"`,
                    sshOptions
                );
                if (fileCheck.trim() !== 'exists') {
                    const available = await sshExec(
                        server.ip,
                        `ls ${vhostDir}/*.conf 2>/dev/null | xargs -n1 basename`,
                        sshOptions
                    ).catch(() => '(none)');
                    return {
                        success: false,
                        output: [
                            `Error: No vhost config found for domain "${domain}".`,
                            `Searched: ${vhostDir}/*.conf for server_name containing "${domain}"`,
                            `Also checked: ${confPath} (not found)`,
                            ``,
                            `Available configs:`,
                            available || '(none)',
                        ].join('\n'),
                    };
                }
            }

            const backupPath = `${confPath}${backupSuffix}`;

            // Snapshot before backup
            const before = await sshExec(server.ip, `tail -10 ${confPath}`, sshOptions);

            // Backup
            await sshExec(server.ip, `cp ${confPath} ${backupPath}`, sshOptions);

            // Append the rewrite block.
            // We write it via base64 to avoid heredoc quoting issues.
            const block = `\n# CloudClaw rewrite — added ${new Date().toISOString()}\n${rewriteCode}\n`;
            const encoded = Buffer.from(block, 'utf8').toString('base64');
            await sshExec(
                server.ip,
                `echo '${encoded}' | base64 -d >> ${confPath}`,
                sshOptions
            );

            // Verify the append looks correct (no literal \n)
            const preview = await sshExec(server.ip, `tail -10 ${confPath}`, sshOptions);
            if (preview.includes('\\n')) {
                await sshExec(server.ip, `cp ${backupPath} ${confPath}`, sshOptions);
                return {
                    success: false,
                    output: `Error: File write produced literal \\n — backup restored from ${backupPath}`,
                };
            }

            // ── nginx -t validation ────────────────────────────────────────────────
            const testOutput = await sshExec(server.ip, NGINX_TEST_CMD, sshOptions);

            if (!nginxTestPassed(testOutput)) {
                // Syntax failed — auto-revert
                await sshExec(server.ip, `cp ${backupPath} ${confPath}`, sshOptions);

                return {
                    success: false,
                    output: [
                        `Vhost Rewrite — SYNTAX ERROR on ${formatServerTarget(server)}`,
                        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                        `File:    ${confPath}`,
                        `Backup restored from: ${backupPath}`,
                        '',
                        'nginx-cs -t output (FAILED):',
                        '```',
                        testOutput,
                        '```',
                        '',
                        'The rewrite code was NOT applied. Fix the syntax error and retry.',
                    ].join('\n'),
                };
            }

            // ── Reload nginx-cs ────────────────────────────────────────────────────
            const reloadOutput = await sshExec(server.ip, NGINX_RELOAD_CMD, sshOptions);

            return {
                success: true,
                output: [
                    `Vhost Rewrite Rule Applied — ${formatServerTarget(server)}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    `File:    ${confPath}`,
                    `Backup:  ${backupPath}`,
                    '',
                    'Before (last 10 lines):',
                    '```',
                    before,
                    '```',
                    '',
                    'After (last 10 lines):',
                    '```',
                    preview,
                    '```',
                    '',
                    'nginx-cs -t output (PASSED):',
                    '```',
                    testOutput,
                    '```',
                    '',
                    'nginx-cs reload:',
                    reloadOutput,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `manage_vhost_rewrite_rules failed: ${msg}` };
        }
    },
};
