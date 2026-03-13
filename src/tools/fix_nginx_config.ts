import { sshExec } from '../utils/ssh.js';
import { formatServerTarget, resolveServerArg } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

function isSafeUnixPath(path: string): boolean {
    return /^\/[A-Za-z0-9._/-]+$/.test(path);
}

function nginxTestPassed(output: string): boolean {
    return /test is successful/i.test(output) && /syntax is ok/i.test(output);
}

export const fixNginxConfigTool: Tool = {
    name: 'fix_nginx_config',
    description:
        'Apply a safe, targeted remediation for common Nginx config parse issues (BOM/CRLF/stray quote on first line), then validate with nginx -t and restart nginx if valid. ' +
        'Use this when diagnostics show an unknown directive error in a specific nginx config file.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label. Options: "production" (139.84.130.63) or "test" (65.20.82.177). If not specified, defaults to production.',
                enum: ['production', 'test'],
            },
            host: {
                type: 'string',
                description: 'Legacy host/IP override. Prefer server_label.',
            },
            file_path: {
                type: 'string',
                description: 'Absolute nginx config path to repair (example: /etc/nginx/sites-enabled/example.com).',
            },
        },
        required: ['file_path'],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = String(args.file_path ?? '').trim();

        if (!filePath) {
            return { success: false, output: 'Error: file_path is required.' };
        }
        if (!isSafeUnixPath(filePath)) {
            return { success: false, output: `Error: Invalid file_path: ${filePath}` };
        }

        const backupPath = `${filePath}.cloudclaw.bak.${Date.now()}`;

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };
            const before = await sshExec(server.ip, `sudo nl -ba "${filePath}" | sed -n '1,12p'`, sshOptions);
            await sshExec(server.ip, `sudo cp "${filePath}" "${backupPath}"`, sshOptions);

            let literalNewlineFixApplied = false;
            let verifyPreview = '';

            // Some broken writes store literal "\n" characters instead of real newlines.
            // If detected, rewrite the file content using base64 transfer + decode.
            const currentContent = await sshExec(server.ip, `sudo cat "${filePath}"`, sshOptions);
            if (currentContent.includes('\\n')) {
                const normalizedContent = currentContent
                    .replace(/\\r\\n/g, '\n')
                    .replace(/\\n/g, '\n');
                const encoded = Buffer.from(normalizedContent, 'utf8').toString('base64');
                await sshExec(server.ip, `echo '${encoded}' | base64 -d | sudo tee "${filePath}" > /dev/null`, sshOptions);

                verifyPreview = await sshExec(server.ip, `sudo cat -A "${filePath}" | head -3`, sshOptions);
                console.log('[fix_nginx_config] Written file preview:', verifyPreview);

                if (verifyPreview.includes('\\n')) {
                    throw new Error('File was written with literal \\n — write failed');
                }
                literalNewlineFixApplied = true;
            }

            // Safe normalizations for this specific failure class.
            await sshExec(server.ip, `sudo sed -i '1s/^\\xEF\\xBB\\xBF//' "${filePath}"`, sshOptions);
            await sshExec(server.ip, `sudo sed -i 's/\\r$//' "${filePath}"`, sshOptions);
            await sshExec(server.ip, `sudo sed -i '1{/^[[:space:]]*\\"[[:space:]]*$/d;}' "${filePath}"`, sshOptions);
            await sshExec(server.ip, `sudo sed -i '1s/^[[:space:]]*\\"[[:space:]]*server[[:space:]]*{/server {/' "${filePath}"`, sshOptions);

            const after = await sshExec(server.ip, `sudo nl -ba "${filePath}" | sed -n '1,12p'`, sshOptions);
            const testOutput = await sshExec(server.ip, 'sudo nginx -t 2>&1 || nginx -t 2>&1', sshOptions);

            if (!nginxTestPassed(testOutput)) {
                await sshExec(server.ip, `sudo cp "${backupPath}" "${filePath}"`, sshOptions);
                return {
                    success: false,
                    output: [
                        `Attempted fix on ${filePath}, but nginx -t still failed. Restored backup.`,
                        '',
                        `Backup restored from: ${backupPath}`,
                        '',
                        'nginx -t output:',
                        '```',
                        testOutput || '(no output)',
                        '```',
                    ].join('\n'),
                };
            }

            const restartOutput = await sshExec(
                server.ip,
                'sudo systemctl restart nginx && sudo systemctl is-active nginx && sudo systemctl status nginx --no-pager -l | sed -n "1,30p"',
                sshOptions
            );

            return {
                success: true,
                output: [
                    `Nginx config remediation applied on ${formatServerTarget(server)}.`,
                    `File: ${filePath}`,
                    `Backup: ${backupPath}`,
                    '',
                    'Before (first 12 lines):',
                    '```',
                    before || '(no output)',
                    '```',
                    '',
                    'After (first 12 lines):',
                    '```',
                    after || '(no output)',
                    '```',
                    '',
                    `Literal \\n fix applied: ${literalNewlineFixApplied ? 'yes' : 'no'}`,
                    ...(verifyPreview
                        ? ['Verify preview (cat -A head -3):', '```', verifyPreview, '```', '']
                        : []),
                    '',
                    'nginx -t output:',
                    '```',
                    testOutput || '(no output)',
                    '```',
                    '',
                    'Restart/status output:',
                    '```',
                    restartOutput || '(no output)',
                    '```',
                ].join('\n'),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Nginx fix failed: ${msg}` };
        }
    },
};
