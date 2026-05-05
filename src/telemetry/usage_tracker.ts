import { getPool, isDBConfigured } from '../database/db.js';
import { LLM_PRICING } from '../config/llm_pricing.js';

export interface UsageData {
    sessionId: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    toolName?: string;
    accountId?: string;
    /** Routing path taken: 'primary' | 'deepseek' | 'deepseek_fallback' */
    routingDecision?: string;
}

function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
    const rate = LLM_PRICING[model.toLowerCase()];
    if (!rate) {
        console.warn(`[usage_tracker] Unknown model "${model}" — cost will be $0. Add pricing to LLM_PRICING.`);
        return 0;
    }
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
