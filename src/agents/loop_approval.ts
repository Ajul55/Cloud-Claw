import {
    encodeToolApprovalCommand,
    isInternalApprovalArg,
    isSensitiveApprovalArg,
} from '../hitl/tool_approval.js';
import { getToolByName } from '../tools/tool_registry.js';

// ─── Approval-args encoding ───────────────────────────────────────────────────
// No double-encoding: strings pass through as-is; objects/arrays are JSON-stringified.

export function encodeApprovalArgs(
    toolArgs: Record<string, unknown>
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(toolArgs)
            .filter(([key]) => !isInternalApprovalArg(key) && !isSensitiveApprovalArg(key))
            .map(([key, value]) => {
                if (typeof value === 'string') return [key, value];
                if (Array.isArray(value) || (value && typeof value === 'object')) return [key, JSON.stringify(value)];
                return [key, String(value ?? '')];
            })
    );
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function getTargetHostDisplay(toolArgs: Record<string, unknown>): string {
    const label = String(toolArgs.server_label ?? '').trim();
    const host = String(toolArgs.host ?? '').trim();

    if (label && host) return `${label} (${host})`;
    if (host) return host;
    if (label) return label;
    return 'unknown';
}

// ─── Tool approval request ────────────────────────────────────────────────────
// Simplified registry lookup with rationale fallback.

export function getToolApprovalRequest(
    toolName: string,
    toolArgs: Record<string, unknown>
): { command: string; targetHost: string; rationale: string } | null {
    const tool = getToolByName(toolName);
    if (!tool) return null;

    if (tool.getApprovalRequest) {
        return tool.getApprovalRequest(toolArgs);
    }

    if (tool.approvalTier === 3) {
        return {
            command: encodeToolApprovalCommand(toolName, encodeApprovalArgs(toolArgs)),
            targetHost: getTargetHostDisplay(toolArgs),
            rationale: tool.getRationale?.(toolArgs)
                ?? `This action will run ${toolName} on ${getTargetHostDisplay(toolArgs)}.`,
        };
    }

    return null;
}

// ─── Fanout timeout helper ─────────────────────────────────────────────────────

export function withTimeout(
    p: Promise<{ success: boolean; output: string }>,
    ms: number,
    label: string
): Promise<{ success: boolean; output: string }> {
    return Promise.race([
        p,
        new Promise<{ success: boolean; output: string }>(res =>
            setTimeout(() => res({ success: false, output: `[${label}] Timed out after ${ms / 1000}s` }), ms)
        ),
    ]);
}
