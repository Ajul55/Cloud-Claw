/**
 * Shared types for the Cloud-Claw tool system.
 * Inspired by OpenClaw's Skills platform — each tool is a self-contained module.
 */

export interface Tool {
    /** Machine-readable name, used as the function name in LLM calls */
    name: string;
    /** Human + LLM-readable description of what the tool does */
    description: string;
    /** JSON Schema for the tool's parameters */
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
    };
    /** Optional HITL tier metadata used by the loop for approval routing */
    approvalTier?: number;
    /** Optional human-readable approval rationale for HITL cards */
    getRationale?: (args: Record<string, unknown>) => string;
    /** Optional: build the full approval request from args. Used by getToolApprovalRequest() in loop.ts. */
    getApprovalRequest?: (args: Record<string, unknown>) => { command: string; targetHost: string; rationale: string } | null;
    /** Optional: return a string snapshot of the current resource state.
     *  Used by the HITL flow to detect state drift between approval request and execution. */
    getCurrentState?: (args: Record<string, unknown>) => Promise<string>;
    /** Optional: tools that are redundant after this tool succeeds.
     *  The loop will block any subsequent call to a suppressed tool with a message
     *  explaining why it was suppressed (e.g. "Already handled by switch_php_api"). */
    suppressTools?: string[];
    /** Execute the tool and return a result */
    execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
    success: boolean;
    /** Text output to be fed back to the LLM / shown to the user */
    output: string;
    /** Optional structured data (e.g. for causality map records) */
    data?: unknown;
}

/** Sent from an interface (Telegram / Slack) into the agent loop */
export interface IncomingMessage {
    /** Unique session key, e.g. "telegram:123456789" or "cloudstick:acc_123" */
    sessionId: string;
    channel: 'telegram' | 'slack' | 'cloudstick';
    userId: string;
    text: string;
    /** Concrete reply target (Slack channel ID, Telegram chat ID) */
    replyTarget?: string;
    /** Tools that were executed during HITL resume before re-entering the loop.
     *  These are seeded into executedTools so the hallucination detector
     *  knows they genuinely ran. */
    resumedTools?: string[];
    /** Set to true when the user clicked "Proceed" on the clarification button card.
     *  Bypasses the shouldPauseForClarification gate so the loop continues instead of
     *  showing the card again. */
    isProceedClarification?: boolean;
    /** Plan tier for Cloudstick business users — drives SSH call rate limits. */
    planTier?: 'starter' | 'pro' | 'business';
    /** AbortSignal for hard timeout — check at each loop iteration. */
    signal?: AbortSignal;
}

/** Callback used by the loop to send text back to the user */
export type ReplyFn = (text: string, options?: { blocks?: any[]; metadata?: any; [key: string]: any }) => Promise<void>;

/** Callback used by the loop to request HITL approval */
export type ApprovalFn = (context: {
    approvalId: number;
    command: string;
    targetHost: string;
    rationale: string;
}) => Promise<void>;
