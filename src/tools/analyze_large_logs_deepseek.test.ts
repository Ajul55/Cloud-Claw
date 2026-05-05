import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// Mock SSH so we don't need a real server
vi.mock('../utils/ssh.js', () => ({
    sshExec: vi.fn(),
}));

// Mock server registry
vi.mock('../utils/server_registry.js', () => ({
    resolveServerArg: vi.fn().mockResolvedValue({
        ip: '1.2.3.4',
        sshUser: 'root',
        sshPort: 22,
        label: 'test-server',
    }),
    formatServerTarget: vi.fn().mockReturnValue('test-server (1.2.3.4)'),
}));

// Mock the LLM provider — must use vi.hoisted for variable access
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('../llm/provider.js', () => ({
    getDeepSeekClient: vi.fn().mockReturnValue(null),
    getLLMClient: vi.fn().mockReturnValue({
        client: { chat: { completions: { create: mockCreate } } },
        model: 'MiniMax-M2.7',
        provider: 'minimax',
    }),
    recordDeepSeekSuccess: vi.fn(),
    recordDeepSeekFailure: vi.fn(),
}));

// Mock usage tracker
vi.mock('../telemetry/usage_tracker.js', () => ({
    trackUsage: vi.fn(),
}));

import { sshExec } from '../utils/ssh.js';
import { analyzeLargeLogsDeepseekTool } from './analyze_large_logs_deepseek.js';

describe('analyze_large_logs_deepseek', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns error when command is missing', async () => {
        const result = await analyzeLargeLogsDeepseekTool.execute({ query: 'find errors' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('command is required');
    });

    it('returns error when query is missing', async () => {
        const result = await analyzeLargeLogsDeepseekTool.execute({ command: 'tail -n 100 /var/log/syslog' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('query is required');
    });

    it('handles empty log output gracefully', async () => {
        vi.mocked(sshExec).mockResolvedValue('');
        const result = await analyzeLargeLogsDeepseekTool.execute({
            command: 'tail -n 100 /var/log/syslog',
            query: 'any errors?',
            server_label: 'test',
        });
        expect(result.success).toBe(true);
        expect(result.output).toContain('no output');
    });

    it('calls LLM with log content and returns analysis', async () => {
        vi.mocked(sshExec).mockResolvedValue('2026-05-05 ERROR php-fpm: pool www: max_children reached');
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'PHP-FPM pool exhausted at max_children limit.' } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });

        const result = await analyzeLargeLogsDeepseekTool.execute({
            command: 'tail -n 100 /var/log/php-fpm.log',
            query: 'why is PHP crashing?',
            server_label: 'test',
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('PHP-FPM pool exhausted');
        expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('handles SSH failure', async () => {
        vi.mocked(sshExec).mockRejectedValue(new Error('Connection refused'));
        const result = await analyzeLargeLogsDeepseekTool.execute({
            command: 'cat /var/log/syslog',
            query: 'any errors?',
            server_label: 'test',
        });
        expect(result.success).toBe(false);
        expect(result.output).toContain('SSH command failed');
    });

    it('handles LLM failure gracefully', async () => {
        vi.mocked(sshExec).mockResolvedValue('some log output');
        mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

        const result = await analyzeLargeLogsDeepseekTool.execute({
            command: 'cat /var/log/syslog',
            query: 'any errors?',
            server_label: 'test',
        });

        expect(result.success).toBe(true);
        // Should contain a warning about the failure
        expect(result.output).toContain('Log analysis failed');
    });

    it('tool has correct name and required parameters', () => {
        expect(analyzeLargeLogsDeepseekTool.name).toBe('analyze_large_logs_deepseek');
        expect(analyzeLargeLogsDeepseekTool.parameters.required).toContain('command');
        expect(analyzeLargeLogsDeepseekTool.parameters.required).toContain('query');
    });
});
