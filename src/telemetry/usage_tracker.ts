import { getPool, isDBConfigured } from '../database/db.js';

export interface UsageData {
    sessionId: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    toolName?: string;
    accountId?: string;
}

// Approximate cost in USD per 1,000,000 tokens
const PRICING: Record<string, { in: number; out: number }> = {
    // OpenAI Settings
    'gpt-4o': { in: 5, out: 15 },
    'gpt-4o-2024-05-13': { in: 5, out: 15 },
    'gpt-4o-mini': { in: 0.15, out: 0.60 },

    // Anthropic Settings
    'claude-3-5-sonnet-20240620': { in: 3, out: 15 },

    // Groq Settings
    'llama-3.1-70b-versatile': { in: 0.59, out: 0.79 },
    'llama3-8b-8192': { in: 0.05, out: 0.08 },

    // MiniMax Settings
    'abab6.5s-chat': { in: 1.0, out: 1.0 },
    'minimax-m2.5': { in: 0.8, out: 0.8 },
};

function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
    const rate = PRICING[model.toLowerCase()] || { in: 0, out: 0 };
    return (tokensIn / 1_000_000) * rate.in + (tokensOut / 1_000_000) * rate.out;
}

export async function trackUsage(data: UsageData): Promise<void> {
    if (!isDBConfigured()) return;

    const costUsd = calculateCost(data.model, data.tokensIn, data.tokensOut);

    try {
        const pool = getPool();
        await pool.query(
            `INSERT INTO usage_log (session_id, model, tokens_in, tokens_out, cost_usd, latency_ms, tool_name, account_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                data.sessionId,
                data.model,
                data.tokensIn,
                data.tokensOut,
                costUsd,
                data.latencyMs,
                data.toolName ?? null,
                data.accountId ?? null,
            ]
        );
    } catch (err) {
        console.error('[UsageTracker] Failed to insert usage log:', err);
    }
}
