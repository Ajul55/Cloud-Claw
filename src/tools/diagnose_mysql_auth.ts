import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

export const diagnoseMysqlAuthTool: Tool = {
    name: 'diagnose_mysql_auth',
    description:
        'Diagnose a MySQL/MariaDB root authentication mismatch. ' +
        'Tests whether the provided password matches the OS-level MariaDB root account. ' +
        'Use this when users cannot create databases, see "Access denied for user root", ' +
        'or the Cloudstick panel fails to connect to MariaDB. ' +
        'This tool ONLY performs a read-only login test — it does NOT change any passwords.',
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
            dashboard_password: {
                type: 'string',
                description:
                    'The MariaDB root password from the Cloudstick panel. ' +
                    'This will be tested against the live OS credential.',
            },
        },
        required: ['dashboard_password'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const dashboardPassword = String(args.dashboard_password ?? '');

        if (!dashboardPassword) {
            return { success: false, output: 'Error: dashboard_password is required.' };
        }

        // Basic sanity: reject passwords that would break the shell command
        // Single quotes inside the password would break the shell quoting
        if (dashboardPassword.includes("'")) {
            return {
                success: false,
                output: `Error: The provided password contains a single quote ('), which cannot be safely tested via SSH. ` +
                        `Check the Cloudstick panel for the actual stored password.`,
            };
        }

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };

            // Check MariaDB service status first
            const serviceStatus = await sshExec(
                server.ip,
                `systemctl is-active mariadb 2>&1 || systemctl is-active mysql 2>&1 || echo "stopped"`,
                sshOptions
            );
            const serviceActive = serviceStatus.trim() === 'active';

            if (!serviceActive) {
                return {
                    success: false,
                    output: [
                        `MySQL/MariaDB Auth Diagnosis — ${formatServerTarget(server)}`,
                        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                        `MariaDB service status: ${serviceStatus.trim()}`,
                        '',
                        'FAIL: MariaDB is not running.',
                        'ACTION: Start the service first with manageService (action: start, service_name: mariadb)',
                        'then re-run this diagnostic.',
                    ].join('\n'),
                };
            }

            // Attempt a minimal SELECT 1 with the provided credentials.
            // We use --connect-timeout to prevent hanging on auth issues.
            // Exit code 0 = authenticated. Non-zero = access denied or other error.
            const authTest = await sshExec(
                server.ip,
                `mysql -u root -p'${dashboardPassword}' --connect-timeout=5 -e "SELECT 1;" 2>&1`,
                sshOptions
            );

            const accessDenied = /access denied/i.test(authTest);
            const unknownHost = /unknown host/i.test(authTest);
            const selectOk = authTest.includes('1') && !accessDenied;

            let status: string;
            let recommendation: string;

            if (selectOk) {
                status = 'PASS: Password matches. MariaDB root authentication is in sync with the Cloudstick panel.';
                recommendation = 'No action required. The password mismatch is likely elsewhere (check the site\'s DB user credentials).';
            } else if (accessDenied) {
                status = 'FAIL: Access denied — password mismatch detected.';
                recommendation = [
                    'The OS-level MariaDB root password does NOT match the Cloudstick dashboard.',
                    'ACTION: Use the Cloudstick API to sync the root password:',
                    '  → Call updateMysqlRootPassword with the correct new password.',
                    '  → If you have the old OS password, change it via: ALTER USER \'root\'@\'localhost\' IDENTIFIED BY \'newpassword\';',
                ].join('\n');
            } else if (unknownHost) {
                status = 'ERROR: MariaDB connection issue (unknown host).';
                recommendation = 'Check that MariaDB is bound to localhost (127.0.0.1) in /etc/mysql/mariadb.conf.d/';
            } else {
                status = `UNKNOWN: Unexpected response from MariaDB auth test.`;
                recommendation = `Review the raw output below and check manually.`;
            }

            // Scrub the password from any output before returning to the LLM
            const safeOutput = authTest.replace(new RegExp(dashboardPassword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');

            return {
                success: selectOk,
                output: [
                    `MySQL/MariaDB Auth Diagnosis — ${formatServerTarget(server)}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    `Service status: ${serviceStatus.trim()}`,
                    '',
                    status,
                    '',
                    recommendation,
                    '',
                    'Raw auth test output:',
                    '```',
                    safeOutput || '(no output)',
                    '```',
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Ensure password is not leaked in the error
            const safeMsg = msg.replace(new RegExp(dashboardPassword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
            return { success: false, output: `diagnose_mysql_auth failed: ${safeMsg}` };
        }
    },
};
