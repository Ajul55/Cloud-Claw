import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordLlmSuccess,
    recordLlmFailure,
    getConsecutiveLlmFailures,
} from './llm_health.js';

describe('LLM health counter', () => {
    beforeEach(() => {
        recordLlmSuccess(); // reset counter before each test
    });

    it('starts at 0', () => {
        expect(getConsecutiveLlmFailures()).toBe(0);
    });

    it('increments on failure', () => {
        recordLlmFailure();
        recordLlmFailure();
        expect(getConsecutiveLlmFailures()).toBe(2);
    });

    it('resets to 0 on success', () => {
        recordLlmFailure();
        recordLlmFailure();
        recordLlmSuccess();
        expect(getConsecutiveLlmFailures()).toBe(0);
    });

    it('continues counting if success never called', () => {
        for (let i = 0; i < 5; i++) recordLlmFailure();
        expect(getConsecutiveLlmFailures()).toBe(5);
    });
});
