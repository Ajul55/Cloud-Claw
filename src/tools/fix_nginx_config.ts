import { sshExec } from '../utils/ssh.js';
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
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
            file_path: {
                type: 'string',
                description: 'Absolute nginx config path to repair (example: /etc/nginx/sites-enabled/example.com).',
            },
        },
        required: ['host', 'file_path'],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host ?? '').trim();
        const filePath = String(args.file_path ?? '').trim();

        if (!host || !filePath) {
            return { success: false, output: 'Error: host and file_path are required.' };
        }
        if (!isSafeUnixPath(filePath)) {
            return { success: false, output: `Error: Invalid file_path: ${filePath}` };
        }

        const backupPath = `${filePath}.cloudclaw.bak.${Date.now()}`;

        try {
            const before = await sshExec(host, `sudo nl -ba "${filePath}" | sed -n '1,12p'`);
            await sshExec(host, `sudo cp "${filePath}" "${backupPath}"`);

            let literalNewlineFixApplied = false;
            let verifyPreview = '';

            // Some broken writes store literal "\n" characters instead of real newlines.
            // If detected, rewrite the file content using base64 transfer + decode.
            const currentContent = await sshExec(host, `sudo cat "${filePath}"`);
            if (currentContent.includes('\\n')) {
                const normalizedContent = currentContent
                    .replace(/\\r\\n/g, '\n')
                    .replace(/\\n/g, '\n');
                const encoded = Buffer.from(normalizedContent, 'utf8').toString('base64');
                await sshExec(host, `echo '${encoded}' | base64 -d | sudo tee "${filePath}" > /dev/null`);

                verifyPreview = await sshExec(host, `sudo cat -A "${filePath}" | head -3`);
                console.log('[fix_nginx_config] Written file preview:', verifyPreview);

                if (verifyPreview.includes('\\n')) {
                    throw new Error('File was written with literal \\n — write failed');
                }
                literalNewlineFixApplied = true;
            }

            // Safe normalizations for this specific failure class.
            await sshExec(host, `sudo sed -i '1s/^\\xEF\\xBB\\xBF//' "${filePath}"`);
            await sshExec(host, `sudo sed -i 's/\\r$//' "${filePath}"`);
            await sshExec(host, `sudo sed -i '1{/^[[:space:]]*\\"[[:space:]]*$/d;}' "${filePath}"`);
            await sshExec(host, `sudo sed -i '1s/^[[:space:]]*\\"[[:space:]]*server[[:space:]]*{/server {/' "${filePath}"`);

            const after = await sshExec(host, `sudo nl -ba "${filePath}" | sed -n '1,12p'`);
            const testOutput = await sshExec(host, 'sudo nginx -t 2>&1 || nginx -t 2>&1');

            if (!nginxTestPassed(testOutput)) {
                await sshExec(host, `sudo cp "${backupPath}" "${filePath}"`);
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
                host,
                'sudo systemctl restart nginx && sudo systemctl is-active nginx && sudo systemctl status nginx --no-pager -l | sed -n "1,30p"'
            );

            return {
                success: true,
                output: [
                    `Nginx config remediation applied on ${host}.`,
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
            return { success: false, output: `Nginx fix failed on ${host}: ${msg}` };
        }
    },
};
