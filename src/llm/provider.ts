import OpenAI from 'openai';
import { env } from '../config/env.js';

export interface LLMConfig {
    client: OpenAI;
    model: string;
    provider: string;
}

let globalProviderOverride: string | undefined;
let globalModelOverride: string | undefined;

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

export function getLLMClient(): LLMConfig {
    const provider = (globalProviderOverride || env.LLM_PROVIDER).toLowerCase();

    let apiKey = env.LLM_API_KEY;
    let baseURL = env.LLM_BASE_URL;
    let model = globalModelOverride || env.LLM_MODEL;

    if (provider === 'groq') {
        apiKey = env.GROQ_API_KEY || apiKey;
        baseURL = 'https://api.groq.com/openai/v1';
        if (!globalModelOverride && env.LLM_MODEL === 'gpt-4o') model = 'llama-3.1-70b-versatile';
    } else if (provider === 'minimax') {
        apiKey = env.MINIMAX_API_KEY || apiKey;
        baseURL = 'https://api.minimaxi.chat/v1';
        // MiniMax-M2.5 is optimized for agentic workflows and tool calling
        if (!globalModelOverride && env.LLM_MODEL === 'gpt-4o') model = 'MiniMax-M2.5';
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
