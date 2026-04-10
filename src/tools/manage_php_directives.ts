import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

// Supported PHP versions on Cloudstick stack: php81cs-fpm … php85cs-fpm
// ini files live at /etc/php<version>cs/php.ini  (e.g. /etc/php84cs/php.ini)
const VALID_PHP_VERSIONS = ['81', '82', '83', '84', '85'] as const;

function normalizePhpVersion(raw: string): string {
    // Accept "8.4" → "84", "84" → "84"
    return raw.replace('.', '');
}

function escapeForSed(value: string): string {
    // Escape characters that have meaning inside a sed replacement string
    return value.replace(/[\/&]/g, '\\$&');
}

// Directives that modify a list rather than a simple scalar value
const LIST_DIRECTIVES = ['disable_functions', 'disable_classes'];

export const managePhpDirectivesTool: Tool = {
    name: 'manage_php_directives',
    description:
        'Edit a specific directive in a PHP ini file on the Cloudstick stack. ' +
        'Use this for: increasing memory_limit, raising max_execution_time/upload_max_filesize, ' +
        'removing a function from disable_functions, or any other php.ini tweak. ' +
        'Automatically reloads the correct php<version>cs-fpm service after editing. ' +
        'For disable_functions, set action="remove_from_list" and value="function_name" to unblock a single function.',
    approvalTier: 2,
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
            php_version: {
                type: 'string',
                description: 'PHP version as two digits, e.g. "84" for PHP 8.4, or "8.4". Supported: 81–85.',
            },
            directive: {
                type: 'string',
                description: 'The php.ini directive to edit, e.g. "memory_limit", "max_execution_time", "disable_functions".',
            },
            value: {
                type: 'string',
                description:
                    'New value for the directive (e.g. "512M", "300"). ' +
                    'For remove_from_list action, the function name to remove.',
            },
            action: {
                type: 'string',
                enum: ['set', 'remove_from_list'],
                description:
                    '"set" replaces the directive value entirely (default). ' +
                    '"remove_from_list" removes one entry from a comma-separated list (use with disable_functions).',
            },
        },
        required: ['php_version', 'directive', 'value'],
    },

    getApprovalRequest(args) {
        const version = normalizePhpVersion(String(args.php_version ?? ''));
        const directive = String(args.directive ?? '');
        const value = String(args.value ?? '');
        const action = String(args.action ?? 'set');
        const serverLabel = String(args.server_label ?? args.host ?? 'default server');
        const iniPath = `/etc/php${version}cs/php.ini`;
        const description = action === 'remove_from_list'
            ? `Remove "${value}" from ${directive} in ${iniPath}`
            : `Set ${directive} = ${value} in ${iniPath}`;

        return {
            command: description,
            targetHost: serverLabel,
            rationale: `PHP directive change — ${description} — then reload php${version}cs-fpm`,
        };
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const rawVersion = String(args.php_version ?? '').trim();
        const directive = String(args.directive ?? '').trim().toLowerCase();
        const value = String(args.value ?? '').trim();
        const action = String(args.action ?? 'set').trim();

        if (!rawVersion || !directive || !value) {
            return { success: false, output: 'Error: php_version, directive, and value are all required.' };
        }

        const version = normalizePhpVersion(rawVersion);
        if (!(VALID_PHP_VERSIONS as readonly string[]).includes(version)) {
            return {
                success: false,
                output: `Error: Unsupported PHP version "${rawVersion}". Valid options: ${VALID_PHP_VERSIONS.join(', ')}.`,
            };
        }

        // Guard: only allow safe directive names (alphanumeric + underscores)
        if (!/^[a-z_]+$/.test(directive)) {
            return { success: false, output: `Error: Invalid directive name "${directive}".` };
        }

        const iniPath = `/etc/php${version}cs/php.ini`;
        const fpmService = `php${version}cs-fpm`;
        const backupPath = `${iniPath}.cloudclaw.bak.${Date.now()}`;

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };

            // Verify the ini file exists
            const fileCheck = await sshExec(server.ip, `test -f ${iniPath} && echo "exists" || echo "missing"`, sshOptions);
            if (fileCheck.trim() !== 'exists') {
                return {
                    success: false,
                    output: `Error: PHP ini file not found: ${iniPath}\n` +
                            `Is PHP ${version} installed? Check with: dpkg -l | grep php${version}`,
                };
            }

            // Backup
            await sshExec(server.ip, `cp ${iniPath} ${backupPath}`, sshOptions);

            let sedCommand: string;

            if (action === 'remove_from_list' && LIST_DIRECTIVES.includes(directive)) {
                // Remove one function from the comma-separated list.
                // e.g. disable_functions = exec,passthru,system  →  after removing "exec" → passthru,system
                // The sed expression strips the function name whether it appears at the start, middle, or end.
                const escaped = escapeForSed(value);
                sedCommand = [
                    // Remove ", funcname" or "funcname," or just "funcname" (only entry)
                    `sed -i`,
                    `-e 's/,\\s*${escaped}//gI'`,
                    `-e 's/${escaped}\\s*,//gI'`,
                    `-e 's/^\\(${directive}\\s*=\\s*\\)${escaped}\\s*$/\\1/I'`,
                    iniPath,
                ].join(' ');
            } else {
                // Standard set: replace the directive line or append if missing
                const escapedValue = escapeForSed(value);
                // Try to replace existing assignment; if line doesn't exist, append
                sedCommand =
                    `grep -qiE '^\\s*${directive}\\s*=' ${iniPath} ` +
                    `&& sed -i 's|^\\s*${directive}\\s*=.*|${directive} = ${escapedValue}|I' ${iniPath} ` +
                    `|| echo '${directive} = ${value}' >> ${iniPath}`;
            }

            await sshExec(server.ip, sedCommand, sshOptions);

            // Read back the changed line to confirm
            const verification = await sshExec(
                server.ip,
                `grep -iE '^\\s*${directive}\\s*=' ${iniPath} || echo "(directive not found in file)"`,
                sshOptions
            );

            // Reload PHP-FPM
            const reloadOutput = await sshExec(
                server.ip,
                `systemctl reload ${fpmService} 2>&1 && systemctl is-active ${fpmService}`,
                sshOptions
            );

            return {
                success: true,
                output: [
                    `PHP Directive Update — ${formatServerTarget(server)}`,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    `File:    ${iniPath}`,
                    `Backup:  ${backupPath}`,
                    `Action:  ${action}`,
                    `Change:  ${directive} ${action === 'remove_from_list' ? `(removed "${value}")` : `= ${value}`}`,
                    '',
                    'Verified line in ini:',
                    verification,
                    '',
                    `${fpmService} reload:`,
                    reloadOutput,
                    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `manage_php_directives failed on php${version}: ${msg}` };
        }
    },
};
