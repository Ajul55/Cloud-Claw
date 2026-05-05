import OpenAI from 'openai';
import { env } from '../config/env.js';

export interface LLMConfig {
    client: OpenAI;
    model: string;
    provider: string;
}

let globalProviderOverride: string | undefined;
let globalModelOverride: string | undefined;

// HIGH-9: Circuit breaker — auto-fallback after 3 consecutive LLM failures
let _consecutiveFailures = 0;
let _fallbackUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const FALLBACK_DURATION_MS = 5 * 60 * 1000;

export function recordLLMProviderSuccess(): void {
    _consecutiveFailures = 0;
}

export function recordLLMProviderFailure(): void {
    _consecutiveFailures++;
    if (_consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        _fallbackUntil = Date.now() + FALLBACK_DURATION_MS;
        console.warn(`[provider] Circuit breaker tripped after ${_consecutiveFailures} failures — using fallback for 5 min`);
    }
}

export function isUsingFallback(): boolean {
    return _fallbackUntil > 0 && Date.now() < _fallbackUntil;
}

export function setGlobalLLMOverride(provider: string, model: string) {
    globalProviderOverride = provider;
    globalModelOverride = model;
}

export function getCurrentLLMConfig() {
    return {
        provider: globalProviderOverride || env.LLM_PROVIDER,
        model: globalModelOverride || env.LLM_MODEL,
    };
}

// ─── DeepSeek integration ─────────────────────────────────────────────────────
// Returns a DeepSeek-specific LLMConfig if the feature flag is enabled and the
// API key is present.  Returns `null` otherwise so the caller can cleanly fall
// through to the default provider (getLLMClient).
//
// Usage in the loop / routing layer:
//     const ds = getDeepSeekClient();
//     const { client, model, provider } = ds ?? getLLMClient();

// Circuit breaker state for DeepSeek specifically — prevents repeated calls to
// a flaky DeepSeek endpoint from blocking the loop.
let _dsConsecutiveFailures = 0;
let _dsFallbackUntil = 0;
const DS_CIRCUIT_BREAKER_THRESHOLD = 3;
const DS_FALLBACK_DURATION_MS = 5 * 60 * 1000;

export function recordDeepSeekSuccess(): void {
    _dsConsecutiveFailures = 0;
    _dsFallbackUntil = 0;
}

export function recordDeepSeekFailure(): void {
    _dsConsecutiveFailures++;
    if (_dsConsecutiveFailures >= DS_CIRCUIT_BREAKER_THRESHOLD) {
        _dsFallbackUntil = Date.now() + DS_FALLBACK_DURATION_MS;
        console.warn(`[provider] DeepSeek circuit breaker tripped after ${_dsConsecutiveFailures} failures — disabled for 5 min`);
    }
}

export function isDeepSeekEnabled(): boolean {
    return env.USE_DEEPSEEK === 'true'
        && !!env.DEEPSEEK_API_KEY
        && !(_dsFallbackUntil > 0 && Date.now() < _dsFallbackUntil);
}

export function getDeepSeekClient(): LLMConfig | null {
    if (!isDeepSeekEnabled()) return null;

    const client = new OpenAI({
        apiKey: env.DEEPSEEK_API_KEY!,
        baseURL: 'https://api.deepseek.com/v1',
    });

    return { client, model: 'deepseek-chat', provider: 'deepseek' };
}

// ─── Primary provider (unchanged default path) ───────────────────────────────

export function getLLMClient(): LLMConfig {
    // HIGH-9: If circuit breaker tripped and a fallback is configured, use it
    const isFallback = isUsingFallback() && !!env.LLM_FALLBACK_PROVIDER;
    const provider = isFallback
        ? env.LLM_FALLBACK_PROVIDER!.toLowerCase()
        : (globalProviderOverride || env.LLM_PROVIDER).toLowerCase();
    if (isFallback) {
        console.log(`[provider] Using fallback provider: ${provider}`);
    }

    let apiKey = env.LLM_API_KEY;
    let baseURL = env.LLM_BASE_URL;
    let model = globalModelOverride || (isFallback ? env.LLM_FALLBACK_MODEL || env.LLM_MODEL : env.LLM_MODEL);

    if (provider === 'groq') {
        apiKey = env.GROQ_API_KEY || apiKey;
        baseURL = 'https://api.groq.com/openai/v1';
        if (!globalModelOverride && env.LLM_MODEL === 'gpt-4o') model = 'llama-3.1-70b-versatile';
    } else if (provider === 'minimax') {
        apiKey = env.MINIMAX_API_KEY || apiKey;
        baseURL = 'https://api.minimaxi.chat/v1';
        // MiniMax-M2.7 is optimized for agentic workflows and tool calling
        if (!globalModelOverride && env.LLM_MODEL === 'gpt-4o') model = 'MiniMax-M2.7';
    } else if (provider === 'deepseek') {
        apiKey = env.DEEPSEEK_API_KEY || apiKey;
        baseURL = 'https://api.deepseek.com/v1';
        if (!globalModelOverride && env.LLM_MODEL === 'gpt-4o') model = 'deepseek-chat';
    } else if (provider === 'anthropic') {
        apiKey = env.ANTHROPIC_API_KEY || apiKey;
        // Anthropic doesn't have a native OpenAI endpoints, typically people use LiteLLM 
        // so we rely on the user having set LLM_BASE_URL to their proxy.
    }

    if (!apiKey) {
        throw new Error(`API Key missing for provider: ${provider}`);
    }

    const client = new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
    });

    return { client, model, provider };
}
