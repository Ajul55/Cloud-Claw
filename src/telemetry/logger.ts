/**
 * Structured Logger
 * 
 * Replaces console.log with JSON-formatted logs for easier 
 * dashboarding and ingestion into ELK/Datadog/CloudWatch.
 */

interface LogPayload {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    module?: string;
    event?: string;
    requestId?: string;
    sessionId?: string;
    accountId?: string;
    approvalId?: number;
    toolName?: string;
    [key: string]: unknown;
}

function formatLog(payload: LogPayload): string {
    return JSON.stringify({
        timestamp: new Date().toISOString(),
        ...payload
    });
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> {
    if (!meta) return {};
    return Object.fromEntries(
        Object.entries(meta).filter(([, value]) => value !== undefined)
    );
}

export const logger = {
    info(message: string, meta?: Record<string, unknown>) {
        console.log(formatLog({ level: 'info', message, ...sanitizeMeta(meta) }));
    },
    
    warn(message: string, meta?: Record<string, unknown>) {
        console.warn(formatLog({ level: 'warn', message, ...sanitizeMeta(meta) }));
    },
    
    error(message: string, error?: unknown, meta?: Record<string, unknown>) {
        let errStr: string | undefined;
        if (error instanceof Error) {
            errStr = error.stack ?? error.message;
        } else if (error) {
            errStr = String(error);
        }
        console.error(formatLog({ level: 'error', message, error: errStr, ...sanitizeMeta(meta) }));
    },

    debug(message: string, meta?: Record<string, unknown>) {
        if (process.env.DEBUG) {
            console.debug(formatLog({ level: 'debug', message, ...sanitizeMeta(meta) }));
        }
    }
};
