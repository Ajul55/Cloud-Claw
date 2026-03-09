import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

export const repairMysqlTool: Tool = {
    name: 'repair_mysql',
    description:
        'Diagnose and repair MariaDB/MySQL on a remote host. ' +
        'Checks service status, slow query log, table status, and can run mysqlcheck repair. ' +
        'Use when the user reports database issues, slow queries, or crashed tables.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
            action: {
                type: 'string',
                enum: ['diagnose', 'repair'],
                description: '"diagnose" checks status only. "repair" runs mysqlcheck auto-repair.',
            },
        },
        required: ['host'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host ?? '').trim();
        const action = String(args.action ?? 'diagnose').trim();

        if (!host) {
            return { success: false, output: 'Error: host is required.' };
        }

        try {
            // Common diagnostics
            const [status, variables, processlist, databases] = await Promise.all([
                sshExec(host, 'systemctl status mariadb 2>&1 || systemctl status mysql 2>&1 | head -20'),
                sshExec(host, "mysql -e \"SHOW VARIABLES LIKE 'slow_query%'; SHOW VARIABLES LIKE 'max_connections'; SHOW STATUS LIKE 'Threads_connected';\" 2>&1 || echo '(cannot connect to MySQL)'"),
                sshExec(host, 'mysql -e "SHOW PROCESSLIST;" 2>&1 | head -20 || echo "(cannot connect)"'),
                sshExec(host, 'mysql -e "SHOW DATABASES;" 2>&1 || echo "(cannot connect)"'),
            ]);

            if (action === 'diagnose') {
                const report = [
                    `MariaDB/MySQL diagnostics for ${host}`,
                    '',
                    '1) Service Status:',
                    '```',
                    status,
                    '```',
                    '',
                    '2) Key Variables:',
                    '```',
                    variables,
                    '```',
                    '',
                    '3) Process List:',
                    '```',
                    processlist,
                    '```',
                    '',
                    '4) Databases:',
                    '```',
                    databases,
                    '```',
                ].join('\n');

                return { success: true, output: report };
            }

            if (action === 'repair') {
                const repairOutput = await sshExec(host,
                    'mysqlcheck --all-databases --auto-repair 2>&1'
                );

                // Check for crashed tables specifically
                const tableCheck = await sshExec(host,
                    "mysql -e \"SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('information_schema','performance_schema','mysql','sys') LIMIT 20;\" 2>&1 || echo '(check failed)'"
                );

                const report = [
                    `MariaDB/MySQL repair on ${host}`,
                    '',
                    '1) Service Status:',
                    '```',
                    status,
                    '```',
                    '',
                    '2) mysqlcheck --auto-repair output:',
                    '```',
                    repairOutput,
                    '```',
                    '',
                    '3) Table overview (post-repair):',
                    '```',
                    tableCheck,
                    '```',
                ].join('\n');

                return { success: true, output: report };
            }

            return { success: false, output: `Unknown action: ${action}. Use "diagnose" or "repair".` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `MySQL diagnostics failed on ${host}: ${msg}` };
        }
    },
};
