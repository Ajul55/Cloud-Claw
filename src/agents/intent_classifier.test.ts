import { describe, it, expect, vi } from 'vitest';

// Force the LLM call to throw — simulates API outage
vi.mock('../llm/provider.js', () => ({
    getLLMClient: vi.fn(() => ({
        client: {
            chat: {
                completions: {
                    create: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
                },
            },
        },
        model: 'gpt-4o',
        provider: 'openai',
    })),
}));

import { classifyIntent } from './intent_classifier.js';

describe('classifyIntent fallback — LLM API outage', () => {
    it('does NOT set requiresTool=true for a casual message', async () => {
        const intent = await classifyIntent('thanks!');
        expect(intent.requiresTool).toBe(false);
    });

    it('does NOT set requiresTool=true for "ok"', async () => {
        const intent = await classifyIntent('ok');
        expect(intent.requiresTool).toBe(false);
    });

    it('DOES set requiresTool=true for obvious server action', async () => {
        const intent = await classifyIntent('nginx is down on production, fix it');
        expect(intent.requiresTool).toBe(true);
    });

    it('sets isAudit correctly via regex override for audit keywords', async () => {
        const intent = await classifyIntent('run a full health check');
        expect(intent.isAudit).toBe(true);
    });
});
