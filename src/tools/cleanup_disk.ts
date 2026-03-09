import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

export const cleanupDiskTool: Tool = {
    name: 'cleanup_disk',
    description:
        'Analyze disk usage and clean up large/old files on a remote host. ' +
        'In "analyze" mode, finds large files and old logs. In "cleanup" mode, truncates old logs and removes tmp files. ' +
        'Use when disk is full, or during audits when large files are found.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
            action: {
                type: 'string',
                enum: ['analyze', 'cleanup'],
                description: '"analyze" shows disk usage only. "cleanup" truncates old logs and removes tmp files older than 7 days.',
            },
        },
        required: ['host'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host ?? '').trim();
        const action = String(args.action ?? 'analyze').trim();

        if (!host) {
            return { success: false, output: 'Error: host is required.' };
        }

        try {
            // Common analysis
            const [dfOutput, tmpLarge, logLarge, homeLarge, tmpTop, journalSize] = await Promise.all([
                sshExec(host, 'df -h 2>&1'),
                sshExec(host, 'find /tmp -size +50M -ls 2>/dev/null || echo "(none)"'),
                sshExec(host, 'find /var/log -size +100M -ls 2>/dev/null || echo "(none)"'),
                sshExec(host, 'find /home -size +500M -ls 2>/dev/null || echo "(none)"'),
                sshExec(host, 'du -sh /tmp/* 2>/dev/null | sort -rh | head -10 || echo "(empty)"'),
                sshExec(host, 'journalctl --disk-usage 2>/dev/null || echo "(journalctl not available)"'),
            ]);

            if (action === 'analyze') {
                const report = [
                    `Disk analysis for ${host}`,
                    '',
                    '1) Disk Usage:',
                    '```',
                    dfOutput,
                    '```',
                    '',
                    '2) Large files in /tmp (>50MB):',
                    '```',
                    tmpLarge,
                    '```',
                    '',
                    '3) Large files in /var/log (>100MB):',
                    '```',
                    logLarge,
                    '```',
                    '',
                    '4) Large files in /home (>500MB):',
                    '```',
                    homeLarge,
                    '```',
                    '',
                    '5) Top /tmp contents by size:',
                    '```',
                    tmpTop,
                    '```',
                    '',
                    '6) Journal disk usage:',
                    '```',
                    journalSize,
                    '```',
                ].join('\n');

                return { success: true, output: report };
            }

            if (action === 'cleanup') {
                // Safe cleanup steps
                const cleanupSteps = await sshExec(host, [
                    // Truncate (not delete) old log files > 100MB
                    "find /var/log -name '*.log' -size +100M -exec truncate -s 0 {} \\; 2>/dev/null; echo 'Truncated large logs'",
                    // Remove old rotated logs
                    "find /var/log -name '*.gz' -mtime +30 -delete 2>/dev/null; echo 'Removed old .gz logs (>30 days)'",
                    // Clean tmp files older than 7 days
                    "find /tmp -type f -mtime +7 -delete 2>/dev/null; echo 'Removed tmp files older than 7 days'",
                    // Vacuum journal logs to 100MB
                    'journalctl --vacuum-size=100M 2>/dev/null || echo "(journal vacuum skipped)"',
                    // Clean apt cache
                    'apt-get clean 2>/dev/null; echo "Cleaned apt cache"',
                ].join(' && '));

                // Re-check disk after cleanup
                const afterDf = await sshExec(host, 'df -h 2>&1');

                const report = [
                    `Disk cleanup completed on ${host}`,
                    '',
                    '1) Before cleanup:',
                    '```',
                    dfOutput,
                    '```',
                    '',
                    '2) Cleanup actions:',
                    '```',
                    cleanupSteps,
                    '```',
                    '',
                    '3) After cleanup:',
                    '```',
                    afterDf,
                    '```',
                ].join('\n');

                return { success: true, output: report };
            }

            return { success: false, output: `Unknown action: ${action}. Use "analyze" or "cleanup".` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Disk cleanup failed on ${host}: ${msg}` };
        }
    },
};
