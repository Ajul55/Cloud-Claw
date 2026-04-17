/**
 * fix_wordpress_db — Fix WordPress database credential mismatches
 *
 * Handles "Access denied for user 'xxx'@'localhost'" errors where the
 * MariaDB user's password no longer matches what's in wp-config.php.
 * Reads credentials internally — they never pass through the LLM.
 *
 * API usage:
 *   - listServerDatabaseUsers  → find Cloudstick database_id / db_user_id
 *   - grantDatabasePrivilege   → restore ALL privileges via API
 * SSH usage (no API alternative exists for these):
 *   - Read wp-config.php       → extract DB_USER / DB_PASSWORD / DB_NAME
 *   - Test DB connection        → confirm access denied before acting
 *   - ALTER USER ... IDENTIFIED BY → reset password (no Cloudstick API for this)
 *   - Verify connection          → confirm fix worked
 */

import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import { getCloudstickClient } from '../api/cloudstick_client.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { env } from '../config/env.js';
import type { Tool, ToolResult } from './types.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const getCloudstickUserId = () =>
    getCloudstickUser()?.cloudstick_user_id ?? env.CLOUDSTICK_USER_ID ?? '';

/** Extract a single DB_* value from wp-config.php grep output */
function extractDefine(output: string, key: string): string {
    const pattern = new RegExp(
        `define\\s*\\(\\s*['"]${key}['"]\\s*,\\s*['"]([^'"]*)['"']\\s*\\)`,
        'i'
    );
    const m = output.match(pattern);
    return m ? m[1] : '';
}

/** Sanitize a string by removing all occurrences of the given secrets */
function sanitize(text: string, secrets: string[]): string {
    let result = text;
    for (const secret of secrets) {
        if (secret.length > 0) {
            result = result.replace(
                new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                '***'
            );
        }
    }
    return result;
}

/** Reject passwords with shell-unsafe characters to prevent injection */
function isSafeForShell(value: string): boolean {
    return !value.includes("'");
}

/**
 * Try to restore grants via the Cloudstick API.
 * Falls back silently — SSH already applied GRANT as a safety net.
 */
async function tryApiGrant(
    serverId: number,
    dbUser: string,
    dbName: string
): Promise<string> {
    const csUserId = getCloudstickUserId();
    if (!csUserId || serverId === 0) return '(API grant skipped: no Cloudstick server ID)';

    try {
        const client = getCloudstickClient();
        const response = await client.listServerDatabaseUsers(String(serverId), csUserId) as {
            message?: { db_users?: Array<{
                id?: number;
                db_user_name?: string;
                databases?: Array<{ id?: number; db_name?: string }>;
            }> };
        };

        const dbUsers = response?.message?.db_users ?? [];

        // Find the matching user
        const matchedUser = dbUsers.find(
            (u) => (u.db_user_name ?? '').toLowerCase() === dbUser.toLowerCase()
        );
        if (!matchedUser?.id) {
            return `(API grant skipped: user "${dbUser}" not found in Cloudstick registry — SSH grant already applied)`;
        }

        // Find the matching database for this user
        const matchedDb = (matchedUser.databases ?? []).find(
            (d) => (d.db_name ?? '').toLowerCase() === dbName.toLowerCase()
        );
        if (!matchedDb?.id) {
            return `(API grant skipped: database "${dbName}" not linked to user in Cloudstick — SSH grant already applied)`;
        }

        await client.grantDatabasePrivilege(String(serverId), csUserId, {
            database_id: matchedDb.id,
            db_user_id: matchedUser.id,
            privileges: ['ALL'],
        });

        return `✅ Privileges re-granted via Cloudstick API (database_id=${matchedDb.id}, db_user_id=${matchedUser.id})`;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `(API grant attempted but failed: ${msg} — SSH grant already applied as fallback)`;
    }
}

export const fixWordpressDbTool: Tool = {
    name: 'fix_wordpress_db',
    description:
        'Fix a WordPress database connection failure caused by a credential mismatch. ' +
        'Symptoms: "Access denied for user \'xxx\'@\'localhost\'" in WordPress, ' +
        '"Error establishing a database connection". ' +
        'This tool reads wp-config.php to get the expected credentials, tests them against MariaDB, ' +
        'and if they do not match — resets the MariaDB user password via SSH (no Cloudstick API exists for this) ' +
        'then re-grants ALL privileges via the Cloudstick API. ' +
        'Requires HITL approval — it modifies database credentials.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (preferred over host). E.g. "Cloud-Claw-Test".',
            },
            host: {
                type: 'string',
                description: 'Legacy: IP or hostname. Prefer server_label.',
            },
            site_root: {
                type: 'string',
                description:
                    'Absolute path to the WordPress root containing wp-config.php. ' +
                    'Example: /home/userzilr9g/apps/word. ' +
                    'If omitted, the tool will try to auto-detect it from the domain.',
            },
            domain: {
                type: 'string',
                description:
                    'Website domain (e.g. "ajul.site"). Used to auto-detect site_root if not provided.',
            },
        },
        required: [],
    },
    approvalTier: 3,
    getRationale: (args) =>
        `This will reset the MariaDB user password on server ${args.server_label ?? args.host ?? 'unknown'} ` +
        `to match wp-config.php for ${args.domain ?? args.site_root ?? 'the specified WordPress site'}. ` +
        `MariaDB credentials will be modified — the WordPress site should come back online immediately after.`,
    getApprovalRequest: (args) => ({
        command: encodeToolApprovalCommand('fix_wordpress_db', {
            server_label: String(args.server_label ?? args.host ?? ''),
            site_root: String(args.site_root ?? ''),
            domain: String(args.domain ?? ''),
        }),
        targetHost: String(args.server_label ?? args.host ?? 'unknown'),
        rationale:
            `Reset MariaDB user password to match wp-config.php for ` +
            `${args.domain ?? args.site_root ?? 'the WordPress site'}. ` +
            `This fixes "Access denied" / "Error establishing a database connection".`,
    }),

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };
            const target = formatServerTarget(server);

            // ── Step 1: Resolve wp-config.php path ────────────────────────────
            // SSH required: no Cloudstick API for reading filesystem paths
            let siteRoot = String(args.site_root ?? '').trim();
            const domain = String(args.domain ?? '').trim();

            if (!siteRoot) {
                if (domain) {
                    const detected = await sshExec(
                        server.ip,
                        `grep -rl '${domain}' /etc/nginx-cs/vhosts.d/ 2>/dev/null | head -1 | xargs grep -oP 'root\\s+\\K[^;]+' 2>/dev/null | head -1`,
                        sshOptions
                    );
                    siteRoot = detected.trim();
                }
                if (!siteRoot) {
                    return {
                        success: false,
                        output:
                            `fix_wordpress_db — ${target}\n` +
                            `Could not auto-detect site_root. ` +
                            `Please provide site_root (e.g. /home/userzilr9g/apps/word) or domain.`,
                    };
                }
            }

            const wpConfig = `${siteRoot}/wp-config.php`;

            // ── Step 2: Check wp-config.php exists ────────────────────────────
            const exists = await sshExec(
                server.ip,
                `test -f '${wpConfig}' && echo EXISTS || echo MISSING`,
                sshOptions
            );
            if (!exists.includes('EXISTS')) {
                return {
                    success: false,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `wp-config.php not found at ${wpConfig}. Check site_root parameter.`,
                };
            }

            // ── Step 3: Read DB credentials (SSH — no API alternative) ────────
            const configRaw = await sshExec(
                server.ip,
                `grep -E "define\\s*\\(\\s*'DB_(USER|PASSWORD|NAME|HOST)'" '${wpConfig}' 2>/dev/null`,
                sshOptions
            );

            const dbUser = extractDefine(configRaw, 'DB_USER');
            const dbPass = extractDefine(configRaw, 'DB_PASSWORD');
            const dbName = extractDefine(configRaw, 'DB_NAME');
            const dbHost = extractDefine(configRaw, 'DB_HOST') || 'localhost';

            if (!dbUser || !dbPass || !dbName) {
                return {
                    success: false,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `Could not parse DB credentials from ${wpConfig}. ` +
                        `Found: DB_USER=${dbUser ? 'yes' : 'NO'}, DB_PASSWORD=${dbPass ? 'yes' : 'NO'}, DB_NAME=${dbName ? 'yes' : 'NO'}.`,
                };
            }

            if (!isSafeForShell(dbPass) || !isSafeForShell(dbUser)) {
                return {
                    success: false,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `DB credentials contain characters that cannot be safely used in shell commands. ` +
                        `Fix the password manually via the Cloudstick dashboard.`,
                };
            }

            const secrets = [dbPass];

            // ── Step 4: Test existing connection (SSH — no API alternative) ───
            const normalizedHost = dbHost.replace('127.0.0.1', 'localhost');
            const testBefore = await sshExec(
                server.ip,
                `mysql -u '${dbUser}' -p'${dbPass}' -h '${normalizedHost}' -e "SELECT 1;" 2>&1`,
                sshOptions
            );
            const alreadyWorks = testBefore.includes('1') && !/access denied/i.test(testBefore);

            if (alreadyWorks) {
                return {
                    success: true,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `DB connection already works for user "${dbUser}" on database "${dbName}". ` +
                        `No credential change needed — the issue may be elsewhere (check MariaDB is running, ` +
                        `or check DB_HOST in wp-config.php).`,
                };
            }

            const accessDenied = /access denied/i.test(testBefore);
            if (!accessDenied) {
                return {
                    success: false,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `Unexpected error when testing DB credentials for "${dbUser}": ` +
                        sanitize(testBefore, secrets) + '\n' +
                        `This is not a simple password mismatch. Check MariaDB service status.`,
                };
            }

            // ── Step 5: Verify user exists in MariaDB as root (SSH) ──────────
            const userCheck = await sshExec(
                server.ip,
                `mysql -u root -e "SELECT User, Host FROM mysql.user WHERE User='${dbUser}';" 2>&1`,
                sshOptions
            );
            const userExists = userCheck.toLowerCase().includes(dbUser.toLowerCase());

            if (!userExists && !/error|denied/i.test(userCheck)) {
                return {
                    success: false,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `MariaDB user "${dbUser}" does not exist. ` +
                        `You need to create the user first — use create_database_user or the Cloudstick dashboard.`,
                };
            }

            // ── Step 6: Reset password + grants in one shot ───────────────────
            // No Cloudstick API exists for changing a DB user's password.
            //
            // WHY GRANT ... IDENTIFIED BY (not ALTER USER):
            //   Cloudstick only creates 'user'@'%'. The @localhost and @127.0.0.1 entries
            //   do not exist. ALTER USER on a non-existent host entry throws:
            //     ERROR 1396: Operation ALTER USER failed for 'user'@'127.0.0.1'
            //   GRANT ... IDENTIFIED BY is MariaDB syntax that creates the user+host entry
            //   if missing AND sets the password in one statement — safe for all cases.
            //
            // Three host variants are needed:
            //   @%         → Cloudstick default (TCP, any IP)
            //   @127.0.0.1 → explicit TCP localhost (wp-config typical)
            //   @localhost  → unix socket connections
            const fixSql = [
                `GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'%' IDENTIFIED BY '${dbPass}';`,
                `GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass}';`,
                `GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPass}';`,
                `FLUSH PRIVILEGES;`,
            ].join(' ');

            const fixSqlResult = await sshExec(
                server.ip,
                `mysql -u root -e "${fixSql}" 2>&1`,
                sshOptions
            );

            const fixSqlFailed = /error/i.test(fixSqlResult) && !/Query OK/i.test(fixSqlResult);
            if (fixSqlFailed) {
                return {
                    success: false,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `Failed to update credentials for "${dbUser}":\n` +
                        sanitize(fixSqlResult, secrets) + '\n' +
                        `If MariaDB root requires a password, check /etc/cloudstick/config.toml on the server.`,
                };
            }

            // API grant: keeps Cloudstick dashboard in sync
            const apiGrantNote = await tryApiGrant(server.id, dbUser, dbName);

            // ── Step 8: Verify fix (SSH) ──────────────────────────────────────
            const testAfter = await sshExec(
                server.ip,
                `mysql -u '${dbUser}' -p'${dbPass}' -h 'localhost' -e "SELECT 1;" 2>&1`,
                sshOptions
            );
            const fixWorked = testAfter.includes('1') && !/access denied/i.test(testAfter);

            if (!fixWorked) {
                return {
                    success: false,
                    output:
                        `fix_wordpress_db — ${target}\n` +
                        `Password reset ran but connection still fails for "${dbUser}" → "${dbName}".\n` +
                        `Post-fix test: ${sanitize(testAfter, secrets)}\n` +
                        `Manual investigation required.`,
                };
            }

            return {
                success: true,
                output: [
                    `fix_wordpress_db — ${target}`,
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                    `✅ WordPress database credentials fixed.`,
                    ``,
                    `Site root : ${siteRoot}`,
                    `DB User   : ${dbUser}`,
                    `DB Name   : ${dbName}`,
                    ``,
                    `Actions taken:`,
                    `  • Password reset for "${dbUser}"@%, @localhost, @127.0.0.1 via SSH`,
                    `  • GRANT ALL PRIVILEGES on "${dbName}" for all three host variants`,
                    `  • ${apiGrantNote}`,
                    `  • Post-fix connection test: PASSED`,
                    ``,
                    `The WordPress site should be accessible now. ` +
                    `If it's still down, check nginx and PHP-FPM with diagnose_services.`,
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `fix_wordpress_db failed: ${msg}` };
        }
    },
};
