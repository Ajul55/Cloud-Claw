export interface ToolApprovalPayload {
    toolName: string;
    args: Record<string, string>;
}

const TOOL_PREFIX = 'TOOL:';

export function encodeToolApprovalCommand(toolName: string, args: Record<string, string>): string {
    const encodedArgs = Object.entries(args)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('|');

    return encodedArgs ? `${TOOL_PREFIX}${toolName}|${encodedArgs}` : `${TOOL_PREFIX}${toolName}`;
}

export function decodeToolApprovalCommand(command: string): ToolApprovalPayload | null {
    if (!command.startsWith(TOOL_PREFIX)) return null;

    const parts = command.split('|');
    const toolName = parts[0].slice(TOOL_PREFIX.length).trim();
    if (!toolName) return null;

    const args: Record<string, string> = {};
    for (const part of parts.slice(1)) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const key = part.slice(0, eq);
        const rawValue = part.slice(eq + 1);
        args[key] = decodeURIComponent(rawValue);
    }

    return { toolName, args };
}

export function describeApprovalCommand(command: string): {
    title: string;
    details: Array<{ label: string; value: string }>;
} {
    const parsed = decodeToolApprovalCommand(command);
    if (!parsed) {
        return {
            title: command,
            details: [],
        };
    }

    if (parsed.toolName === 'fix_nginx_config') {
        return {
            title: 'Apply Nginx Auto-Fix',
            details: [
                { label: 'Host', value: parsed.args.host ?? 'unknown' },
                { label: 'File', value: parsed.args.file_path ?? 'unknown' },
            ],
        };
    }

    return {
        title: `Run tool: ${parsed.toolName}`,
        details: Object.entries(parsed.args).map(([label, value]) => ({ label, value })),
    };
}
