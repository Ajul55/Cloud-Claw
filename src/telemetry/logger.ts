/**
 * Structured Logger
 * 
 * Replaces console.log with JSON-formatted logs for easier 
 * dashboarding and ingestion into ELK/Datadog/CloudWatch.
 */

interface LogPayload {
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    message: string;
    module?: string;
    [key: string]: unknown;
}

function formatLog(payload: LogPayload): string {
    return JSON.stringify({
        timestamp: new Date().toISOString(),
        ...payload
    });
}

export const logger = {
    info(message: string, meta?: Record<string, unknown>) {
        console.log(formatLog({ level: 'INFO', message, ...meta }));
    },
    
    warn(message: string, meta?: Record<string, unknown>) {
        console.warn(formatLog({ level: 'WARN', message, ...meta }));
    },
    
    error(message: string, error?: unknown, meta?: Record<string, unknown>) {
        let errStr = '';
        if (error instanceof Error) {
            errStr = error.stack ?? error.message;
        } else if (error) {
            errStr = String(error);
        }
        console.error(formatLog({ level: 'ERROR', message, error: errStr, ...meta }));
    },

    debug(message: string, meta?: Record<string, unknown>) {
        if (process.env.DEBUG) {
            console.debug(formatLog({ level: 'DEBUG', message, ...meta }));
        }
    }
};
