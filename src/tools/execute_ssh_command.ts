import { env } from '../config/env.js';
import { sshExec } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

function enrichServiceRestartCommand(command: string): string {
    const trimmed = command.trim();
    const restartMatch = trimmed.match(/^sudo\s+systemctl\s+restart\s+([a-zA-Z0-9_.@-]+)\s*$/i)
        ?? trimmed.match(/^systemctl\s+restart\s+([a-zA-Z0-9_.@-]+)\s*$/i);

    if (!restartMatch) return command;
    const service = restartMatch[1];
    return `${trimmed} && systemctl is-active ${service} && systemctl status ${service} --no-pager -l | sed -n '1,30p'`;
}

export const executeSshCommandTool: Tool = {
    name: 'execute_ssh_command',
    description:
        'Execute a read-only or diagnostic shell command on a remote Linux server via SSH. ' +
        'Use this to check service status, read logs, view processes, or perform other systems administrative discovery. ' +
        'Note: If the command modifies state, it will be automatically routed for human approval.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server.',
            },
            command: {
                type: 'string',
                description: 'The shell command to execute. Must be a valid bash command.',
            },
        },
        required: ['host', 'command'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host);
        const command = String(args.command);
        const commandToRun = enrichServiceRestartCommand(command);

        if (!host || !command) {
            return {
                success: false,
                output: 'Error: host and command are required.',
            };
        }

        try {
            console.log(`[execute_ssh_command] Running '${commandToRun}' on ${host}`);
            const output = await sshExec(host, commandToRun);

            return {
                success: true,
                output: output ? output : '(Command executed successfully but returned no output)'
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[execute_ssh_command] Error:`, message);
            return {
                success: false,
                output: `❌ SSH Command failed on ${host}: ${message}`,
            };
        }
    },
};
