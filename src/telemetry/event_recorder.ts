import { insertAgentEvent, type AgentEvent } from '../database/db.js';
import { logger } from './logger.js';
import { isSensitiveApprovalArg } from '../hitl/tool_approval.js';

const SAMPLE_RATE = parseFloat(process.env.TRACE_SAMPLE_RATE ?? '1.0');
const MAX_SUMMARY_LENGTH = 500;

/**
 * Redact sensitive keys from tool args before storing in agent_events.
 * Reuses isSensitiveApprovalArg() from tool_approval.ts.
 */
function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
        redacted[key] = isSensitiveApprovalArg(key) ? '[REDACTED]' : value;
    }
    return redacted;
}

/**
 * Fire-and-forget event insert.
 * Never blocks the agent loop — errors are logged but not thrown.
 */
export function recordEvent(event: Omit<AgentEvent, 'id' | 'timestamp'>): void {
    if (Math.random() > SAMPLE_RATE) return;

    const stored: Omit<AgentEvent, 'id'> = {
        ...event,
        args: event.args ? redactArgs(event.args) : null,
        result_summary: event.result_summary
            ? event.result_summary.slice(0, MAX_SUMMARY_LENGTH)
            : null,
        timestamp: new Date(),
    };

    insertAgentEvent(stored).catch(err => {
        logger.error('[event_recorder] Failed to write event', err instanceof Error ? err : undefined, {
            event_type: event.event_type,
        });
    });
}
