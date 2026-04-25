// Approximate cost in USD per 1,000,000 tokens.
// Add new models here when the LLM provider changes — no code restart needed.
export const LLM_PRICING: Record<string, { in: number; out: number }> = {
    // OpenAI
    'gpt-4o':                    { in: 5,    out: 15   },
    'gpt-4o-2024-05-13':         { in: 5,    out: 15   },
    'gpt-4o-mini':               { in: 0.15, out: 0.60 },

    // Anthropic
    'claude-3-5-sonnet-20240620': { in: 3,   out: 15   },

    // Groq
    'llama-3.1-70b-versatile':   { in: 0.59, out: 0.79 },
    'llama3-8b-8192':            { in: 0.05, out: 0.08 },

    // MiniMax
    'abab6.5s-chat':             { in: 1.0,  out: 1.0  },
    'minimax-m2.5':              { in: 0.8,  out: 0.8  },
};
