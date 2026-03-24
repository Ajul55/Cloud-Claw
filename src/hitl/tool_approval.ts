export interface ToolApprovalPayload {
    toolName: string;
    args: Record<string, string>;
}

const TOOL_PREFIX = 'TOOL:';
const INTERNAL_APPROVAL_ARG_KEYS = new Set(['__stateHash']);
const SENSITIVE_APPROVAL_ARG_PATTERNS = [
    /pass(word)?/i,
    /secret/i,
    /token/i,
    /api[-_]?key/i,
    /private[-_]?key/i,
];

export function isInternalApprovalArg(key: string): boolean {
    return INTERNAL_APPROVAL_ARG_KEYS.has(key);
}

export function isSensitiveApprovalArg(key: string): boolean {
    return SENSITIVE_APPROVAL_ARG_PATTERNS.some((pattern) => pattern.test(key));
}

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
                { label: 'Server', value: parsed.args.server_label ?? parsed.args.host ?? 'unknown' },
                ...(parsed.args.host ? [{ label: 'IP', value: parsed.args.host }] : []),
                { label: 'File', value: parsed.args.file_path ?? 'unknown' },
            ],
        };
    }

    return {
        title: `Run tool: ${parsed.toolName}`,
        details: Object.entries(parsed.args)
            .filter(([label]) => !isInternalApprovalArg(label))
            .map(([label, value]) => ({
                label,
                value: isSensitiveApprovalArg(label) ? '[REDACTED]' : value,
            })),
    };
}
