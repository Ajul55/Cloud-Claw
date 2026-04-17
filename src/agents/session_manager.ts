/**
 * Session Manager — extracted from loop.ts
 *
 * Handles session lifecycle utilities:
 *   - Message history cleanup (ephemeral messages, length guards)
 *   - Tool receipt tracking (success/failure, freshness, hash verification)
 *   - Progress summary generation for the LLM
 *
 * These functions were extracted from the "god file" loop.ts to improve
 * maintainability and enable unit testing of session logic independently.
 */

import { createHash } from 'crypto';
import type OpenAI from 'openai';

// ─── Tool Receipts (Layer 4) ────────────────────────────────────────────────

export interface ToolReceipt {
    toolName: string;
    success: boolean;
    host: string;
    timestamp: number;
    outputHash: string;
}

export function hashOutput(output: string): string {
    return createHash('sha256').update(output.slice(0, 200)).digest('hex');
}

export function loadReceiptsFromSession(raw: unknown): Map<string, ToolReceipt> {
    const map = new Map<string, ToolReceipt>();
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, any>;
        for (const [key, value] of Object.entries(obj)) {
            if (value && typeof value === 'object' && typeof (value as any).toolName === 'string') {
                map.set(key, {
                    toolName: (value as any).toolName,
                    success: (value as any).success === true,
                    host: String((value as any).host ?? ''),
                    timestamp: Number((value as any).timestamp ?? Date.now()),
                    outputHash: String((value as any).outputHash ?? ''),
                });
            }
        }
    }
    return map;
}

export function serializeReceipts(map: Map<string, ToolReceipt>): Record<string, ToolReceipt> {
    return Object.fromEntries(map.entries());
}

export function recordReceipt(
    receipts: Map<string, ToolReceipt>,
    key: string,
    success: boolean,
    host: string,
    outputOrHash: string,
    isAlreadyHashed = false
): void {
    receipts.set(key, {
        toolName: key.includes(':') ? key.split(':')[0] : key,
        success,
        host,
        timestamp: Date.now(),
        outputHash: isAlreadyHashed ? outputOrHash : hashOutput(outputOrHash ?? ''),
    });
}

// Receipts older than this are considered stale and should not bypass guards
const RECEIPT_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes

// Fix #2: added optional expectedOutputHash parameter
export function hasReceipt(
    receipts: Map<string, ToolReceipt>,
    toolNames: string | string[],
    requireSuccess = false,
    maxAgeMs?: number,
    expectedHost?: string,
    expectedOutputHash?: string
): boolean {
    const list = Array.isArray(toolNames) ? toolNames : [toolNames];
    const now = Date.now();
    const expected = expectedHost?.toLowerCase().trim();

    return list.some((name) => {
        const rec = receipts.get(name);
        if (!rec) return false;
        if (requireSuccess && !rec.success) return false;
        if (maxAgeMs && now - rec.timestamp > maxAgeMs) return false;
        if (expected && rec.host?.toLowerCase().trim() !== expected) return false;
        if (expectedOutputHash && rec.outputHash !== expectedOutputHash) return false;
        return true;
    });
}

/** Default freshness window for receipt checks */
export { RECEIPT_FRESHNESS_MS };

// ─── Message utilities ────────────────────────────────────────────────────────

export function containsInternalToolSyntax(text: string): boolean {
    return /\bfunctions\.[a-z_]+\s*\(/i.test(text)
        || /```(?:typescript|json)?[\s\S]*functions\.[a-z_]+\s*\(/i.test(text)
        || /<minimax:tool_call>/i.test(text)
        || /<\/minimax:tool_call>/i.test(text)
        || /<invoke\s+name=/i.test(text)
        || /<parameter\s+name=/i.test(text);
}

export function getMessageText(content: OpenAI.ChatCompletionMessageParam['content'] | null | undefined): string {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .map((part: any) => {
            if (typeof part === 'string') return part;
            if (part?.type === 'text' && typeof part.text === 'string') return part.text;
            return '';
        })
        .filter(Boolean)
        .join(' ');
}

export function summarizeText(text: string, maxLength = 220): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
        return '';
    }

    return collapsed.length > maxLength
        ? `${collapsed.slice(0, maxLength - 3).trimEnd()}...`
        : collapsed;
}

// Quality fix #13: rewrite as filter + slice instead of reverse-iterate + .reverse()
export function buildProgressSummary(messages: OpenAI.ChatCompletionMessageParam[]): string {
    const summaryLines = messages
        .filter((msg: any) => {
            if (msg.role === 'tool') return true;
            if (msg.role === 'assistant' && typeof msg.content === 'string' && !containsInternalToolSyntax(msg.content)) return true;
            if (msg.role === 'user') return true;
            return false;
        })
        .slice(-5)
        .map((msg: any) => {
            if (msg.role === 'tool') {
                const text = summarizeText(getMessageText(msg.content), 220);
                return text ? `- Tool result: ${text}` : null;
            }
            if (msg.role === 'assistant' && typeof msg.content === 'string') {
                const text = summarizeText(msg.content, 160);
                return text ? `- Assistant: ${text}` : null;
            }
            if (msg.role === 'user') {
                const text = summarizeText(getMessageText(msg.content), 160);
                return text ? `- Pilot: ${text}` : null;
            }
            return null;
        })
        .filter(Boolean) as string[];

    return summaryLines.length > 0
        ? summaryLines.join('\n')
        : '- No concrete findings captured yet.';
}

// ─── Fix #5: Extended stripEphemeralMessages ──────────────────────────────────
export function stripEphemeralMessages(
    msgs: OpenAI.ChatCompletionMessageParam[]
): OpenAI.ChatCompletionMessageParam[] {
    const filtered = msgs.filter((m: any) => {
        // Strip user-role ephemeral messages
        if (m.role === 'user' && typeof m.content === 'string') {
            if (m.content.startsWith('[AUTO-CHAIN]')
                || m.content.startsWith('[AUTO')
                || m.content.startsWith('[SYSTEM GUARD]')
                || m.content.startsWith('[SYSTEM]')
                || m.content.startsWith('[HALLUCINATION')
                || m.content.startsWith('[GUARD')
            ) {
                return false;
            }
        }
        // Strip assistant-role messages with [AUTO-CHAIN] content (legacy cleanup)
        if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('[AUTO-CHAIN]')) {
            return false;
        }
        return true;
    });

    // Session length guard: cap at 40 messages from a clean user-role boundary
    if (filtered.length > 60) {
        let startIndex = filtered.length - 40;
        while (startIndex < filtered.length && filtered[startIndex].role !== 'user') {
            startIndex++;
        }
        if (startIndex >= filtered.length) {
            // Fallback: no user message found, trim strictly to 40 but drop leading tools
            startIndex = filtered.length - 40;
            while (startIndex < filtered.length && filtered[startIndex].role === 'tool') startIndex++;
        }
        return filtered.slice(startIndex);
    }

    return filtered;
}
