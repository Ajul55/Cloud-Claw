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
    // New format: TOOL:toolName|<encodeURIComponent(JSON.stringify(args))>
    // No delimiter collision possible — args is a single encoded blob
    const encodedArgs = encodeURIComponent(JSON.stringify(args));
    return `${TOOL_PREFIX}${toolName}|${encodedArgs}`;
}

export function decodeToolApprovalCommand(command: string): ToolApprovalPayload | null {
    if (!command.startsWith(TOOL_PREFIX)) return null;

    const afterPrefix = command.slice(TOOL_PREFIX.length);
    const pipeIdx = afterPrefix.indexOf('|');

    if (pipeIdx === -1) {
        // No args at all
        const toolName = afterPrefix.trim();
        return toolName ? { toolName, args: {} } : null;
    }

    const toolName = afterPrefix.slice(0, pipeIdx).trim();
    if (!toolName) return null;

    const encodedArgs = afterPrefix.slice(pipeIdx + 1);

    // New format: single JSON blob (encoded with encodeURIComponent, starts with %7B when encoded {)
    if (encodedArgs.startsWith('%7B') || encodedArgs.startsWith('%7b')) {
        try {
            const args = JSON.parse(decodeURIComponent(encodedArgs)) as Record<string, string>;
            return { toolName, args };
        } catch {
            // Fall through to legacy decoder
        }
    }

    // Legacy format: key=encodeURIComponent(value) separated by |
    // Support this for existing pending approvals in the database
    const args: Record<string, string> = {};
    for (const part of encodedArgs.split('|')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const key = part.slice(0, eq);
        const rawValue = part.slice(eq + 1);
        try {
            args[key] = decodeURIComponent(rawValue);
        } catch {
            args[key] = rawValue;
        }
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
