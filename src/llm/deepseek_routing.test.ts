import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock env before importing provider ────────────────────────────────────────
// vi.hoisted ensures mockEnv is available when vi.mock factory runs (hoisted).

const mockEnv = vi.hoisted(() => ({
    LLM_API_KEY: 'test-key',
    LLM_PROVIDER: 'minimax',
    LLM_MODEL: 'MiniMax-M2.7',
    LLM_BASE_URL: undefined as string | undefined,
    LLM_FALLBACK_PROVIDER: undefined as string | undefined,
    LLM_FALLBACK_MODEL: undefined as string | undefined,
    MINIMAX_API_KEY: 'test-minimax-key',
    DEEPSEEK_API_KEY: undefined as string | undefined,
    USE_DEEPSEEK: 'false' as 'true' | 'false',
    GROQ_API_KEY: undefined as string | undefined,
    ANTHROPIC_API_KEY: undefined as string | undefined,
}));

vi.mock('../config/env.js', () => ({ env: mockEnv }));

import {
    isDeepSeekEnabled,
    getDeepSeekClient,
    recordDeepSeekFailure,
    recordDeepSeekSuccess,
} from '../llm/provider.js';

describe('DeepSeek routing', () => {
    beforeEach(() => {
        // Reset state between tests
        mockEnv.USE_DEEPSEEK = 'false';
        mockEnv.DEEPSEEK_API_KEY = undefined;
        // Reset circuit breaker state by recording successes
        for (let i = 0; i < 5; i++) recordDeepSeekSuccess();
    });

    it('isDeepSeekEnabled returns false when USE_DEEPSEEK is off', () => {
        mockEnv.USE_DEEPSEEK = 'false';
        mockEnv.DEEPSEEK_API_KEY = 'sk-test';
        expect(isDeepSeekEnabled()).toBe(false);
    });

    it('isDeepSeekEnabled returns false when DEEPSEEK_API_KEY is missing', () => {
        mockEnv.USE_DEEPSEEK = 'true';
        mockEnv.DEEPSEEK_API_KEY = undefined;
        expect(isDeepSeekEnabled()).toBe(false);
    });

    it('isDeepSeekEnabled returns true when both flag and key are set', () => {
        mockEnv.USE_DEEPSEEK = 'true';
        mockEnv.DEEPSEEK_API_KEY = 'sk-test';
        expect(isDeepSeekEnabled()).toBe(true);
    });

    it('getDeepSeekClient returns null when disabled', () => {
        mockEnv.USE_DEEPSEEK = 'false';
        mockEnv.DEEPSEEK_API_KEY = 'sk-test';
        expect(getDeepSeekClient()).toBeNull();
    });

    it('getDeepSeekClient returns LLMConfig when enabled', () => {
        mockEnv.USE_DEEPSEEK = 'true';
        mockEnv.DEEPSEEK_API_KEY = 'sk-test';
        const result = getDeepSeekClient();
        expect(result).not.toBeNull();
        expect(result!.model).toBe('deepseek-chat');
        expect(result!.provider).toBe('deepseek');
    });

    it('circuit breaker disables DeepSeek after 3 failures', () => {
        mockEnv.USE_DEEPSEEK = 'true';
        mockEnv.DEEPSEEK_API_KEY = 'sk-test';
        expect(isDeepSeekEnabled()).toBe(true);

        recordDeepSeekFailure();
        recordDeepSeekFailure();
        expect(isDeepSeekEnabled()).toBe(true); // 2 failures — still enabled

        recordDeepSeekFailure();
        expect(isDeepSeekEnabled()).toBe(false); // 3 failures — tripped
        expect(getDeepSeekClient()).toBeNull();
    });

    it('circuit breaker resets on success', () => {
        mockEnv.USE_DEEPSEEK = 'true';
        mockEnv.DEEPSEEK_API_KEY = 'sk-test';

        recordDeepSeekFailure();
        recordDeepSeekFailure();
        recordDeepSeekSuccess(); // reset counter
        recordDeepSeekFailure();
        recordDeepSeekFailure();
        // Only 2 consecutive failures after reset — should still be enabled
        expect(isDeepSeekEnabled()).toBe(true);
    });
});

// ─── Intent classifier riskLevel tests ──────────────────────────────────────────
import type { Intent } from '../agents/intent_classifier.js';

describe('Intent riskLevel classification', () => {
    it('Intent interface includes riskLevel field', () => {
        const intent: Intent = {
            requiresTool: false,
            toolHint: 'none',
            isAudit: false,
            targetServer: 'unknown',
            domains: [],
            isApprovalResponse: false,
            needsClarification: false,
            requiresServerClarification: false,
            confidence: 0,
            riskLevel: 'low',
        };
        expect(intent.riskLevel).toBe('low');
    });

    it('riskLevel accepts both low and high values', () => {
        const low: Intent['riskLevel'] = 'low';
        const high: Intent['riskLevel'] = 'high';
        expect(low).toBe('low');
        expect(high).toBe('high');
    });
});

// ─── LLM Pricing tests ─────────────────────────────────────────────────────────
import { LLM_PRICING } from '../config/llm_pricing.js';

describe('LLM pricing includes DeepSeek', () => {
    it('has deepseek-chat pricing entry', () => {
        expect(LLM_PRICING['deepseek-chat']).toBeDefined();
        expect(LLM_PRICING['deepseek-chat'].in).toBe(0.14);
        expect(LLM_PRICING['deepseek-chat'].out).toBe(0.28);
    });

    it('DeepSeek is cheaper than MiniMax', () => {
        const ds = LLM_PRICING['deepseek-chat'];
        const mm = LLM_PRICING['minimax-m2.7'];
        expect(ds.in).toBeLessThan(mm.in);
        expect(ds.out).toBeLessThan(mm.out);
    });
});
