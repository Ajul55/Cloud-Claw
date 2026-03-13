import { sshExec } from '../utils/ssh.js';
import { formatServerTarget, resolveServerArg } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';

function buildWriteRationale(host: string, command: string): string {
    const trimmed = command.trim();

    const systemctlMatch = trimmed.match(
        /^(?:sudo\s+)?systemctl\s+(restart|start|stop|reload|enable|disable|mask|unmask)\s+([a-zA-Z0-9_.@-]+)\s*$/i
    );
    if (systemctlMatch) {
        const action = systemctlMatch[1].toLowerCase();
        const service = systemctlMatch[2];
        return `This will ${action} the ${service} service on ${host}.`;
    }

    const redisPortMatch = trimmed.match(
        /^(?:sudo\s+)?sed\s+-i\s+['"]s\/\^port\s+(\d+)\/port\s+(\d+)\/['"]\s+(\S+)\s*$/i
    );
    if (redisPortMatch) {
        const [, fromPort, toPort, filePath] = redisPortMatch;
        return `This will change the configured port from ${fromPort} to ${toPort} in ${filePath} on ${host}.`;
    }

    const sedMatch = trimmed.match(/^(?:sudo\s+)?sed\s+-i\b.*\s+(\S+)\s*$/i);
    if (sedMatch) {
        return `This will edit ${sedMatch[1]} in place on ${host}.`;
    }

    const copyMatch = trimmed.match(/^(?:sudo\s+)?cp\s+(\S+)\s+(\S+)\s*$/i);
    if (copyMatch) {
        return `This will copy ${copyMatch[1]} to ${copyMatch[2]} on ${host}.`;
    }

    const moveMatch = trimmed.match(/^(?:sudo\s+)?mv\s+(\S+)\s+(\S+)\s*$/i);
    if (moveMatch) {
        return `This will move ${moveMatch[1]} to ${moveMatch[2]} on ${host}.`;
    }

    const removeMatch = trimmed.match(/^(?:sudo\s+)?rm\b\s+(.+)$/i);
    if (removeMatch) {
        return `This will remove ${removeMatch[1]} on ${host}.`;
    }

    const chmodMatch = trimmed.match(/^(?:sudo\s+)?chmod\s+(\S+)\s+(\S+)\s*$/i);
    if (chmodMatch) {
        return `This will change permissions on ${chmodMatch[2]} to ${chmodMatch[1]} on ${host}.`;
    }

    const chownMatch = trimmed.match(/^(?:sudo\s+)?chown\s+(\S+)\s+(\S+)\s*$/i);
    if (chownMatch) {
        return `This will change ownership of ${chownMatch[2]} to ${chownMatch[1]} on ${host}.`;
    }

    const installMatch = trimmed.match(
        /^(?:sudo\s+)?(apt(?:-get)?|yum|dnf|pacman)\s+(install|remove|purge|autoremove)\b(.*)$/i
    );
    if (installMatch) {
        const manager = installMatch[1];
        const action = installMatch[2].toLowerCase();
        const target = installMatch[3].trim() || 'the requested package set';
        return `This will ${action} ${target} using ${manager} on ${host}.`;
    }

    return `This will execute a write command on ${host}: \`${trimmed}\``;
}

export const executeSshWriteTool: Tool = {
    name: 'execute_ssh_write',
    description: 'Execute a write/mutating command on a remote server via SSH. Always requires HITL approval. Use for: systemctl restart/stop/start, sed, cp, mv, rm, chmod, chown, port changes, config edits, package installs.',
    parameters: {
        type: 'object' as const,
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
            command: {
                type: 'string',
                description: 'The mutating bash command to execute.',
            },
        },
        required: ['command'],
    },
    approvalTier: 3,
    getRationale: (args: Record<string, unknown>) =>
        buildWriteRationale(String(args.server_label ?? args.host ?? 'unknown'), String(args.command ?? '')),
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const command = String(args.command ?? '');

        if (!command) {
            return {
                success: false,
                output: 'Error: command is required.',
            };
        }

        let target = String(args.server_label ?? args.host ?? 'unknown');
        try {
            const server = await resolveServerArg(args);
            target = formatServerTarget(server);
            const output = await sshExec(server.ip, command, {
                user: server.sshUser,
                port: server.sshPort,
            });
            return {
                success: true,
                output: output ? output : '(Command executed successfully but returned no output)',
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: `❌ SSH write command failed on ${target}: ${msg}`,
            };
        }
    },
};
