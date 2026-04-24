import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock fns so they are available inside vi.mock factories (which are hoisted to top)
const { mockWrite, mockEnd, mockRequest } = vi.hoisted(() => {
    const mockWrite = vi.fn();
    const mockEnd = vi.fn();
    const mockRequest = vi.fn(() => ({ write: mockWrite, end: mockEnd, on: vi.fn() }));
    return { mockWrite, mockEnd, mockRequest };
});

// Mock env before importing ops_alerts
vi.mock('../config/env.js', () => ({
    env: { SLACK_OPS_WEBHOOK_URL: 'https://hooks.slack.com/test/webhook' },
}));

// Capture https.request calls
vi.mock('https', () => ({
    default: { request: mockRequest },
    request: mockRequest,
}));

// Mock DB as unavailable so alert scheduler doesn't need a real DB
vi.mock('../database/db.js', () => ({
    isDBConfigured: () => false,
    getPool: () => { throw new Error('no db'); },
}));

vi.mock('../services/session_limiter.js', () => ({
    getTotalActiveSessions: () => 0,
}));

vi.mock('./llm_health.js', () => ({
    getConsecutiveLlmFailures: () => 0,
}));

import { sendOpsAlert } from './ops_alerts.js';

describe('sendOpsAlert', () => {
    beforeEach(() => {
        mockRequest.mockClear();
        mockWrite.mockClear();
        mockEnd.mockClear();
    });

    it('POSTs to the webhook URL', async () => {
        // Simulate the https response ending immediately
        type HttpsCb = (res: { resume: () => void; on: (e: string, fn: () => void) => void }) => void;
        (mockRequest.mockImplementationOnce as unknown as (fn: (_opts: unknown, cb: HttpsCb) => unknown) => void)(
            (_opts: unknown, cb: HttpsCb) => {
                const res = { resume: vi.fn(), on: (event: string, fn: () => void) => { if (event === 'end') fn(); } };
                cb(res);
                return { write: mockWrite, end: mockEnd, on: vi.fn() };
            },
        );

        await sendOpsAlert('Test Alert', 'Something happened', 'warning');

        expect(mockRequest).toHaveBeenCalledOnce();
        const opts = (mockRequest.mock.calls[0] as unknown as [{ hostname: string; method: string }])[0];
        expect(opts.hostname).toBe('hooks.slack.com');
        expect(opts.method).toBe('POST');
        expect(mockWrite).toHaveBeenCalledOnce();
        const payload = JSON.parse(mockWrite.mock.calls[0][0] as string) as { attachments: { color: string }[] };
        expect(payload.attachments[0].color).toBe('#f59e0b'); // warning = yellow
    });

    it('uses red for critical severity', async () => {
        type HttpsCb = (res: { resume: () => void; on: (e: string, fn: () => void) => void }) => void;
        (mockRequest.mockImplementationOnce as unknown as (fn: (_opts: unknown, cb: HttpsCb) => unknown) => void)(
            (_opts: unknown, cb: HttpsCb) => {
                const res = { resume: vi.fn(), on: (event: string, fn: () => void) => { if (event === 'end') fn(); } };
                cb(res);
                return { write: mockWrite, end: mockEnd, on: vi.fn() };
            },
        );

        await sendOpsAlert('DB Down', 'Cannot connect', 'critical');

        const payload = JSON.parse(mockWrite.mock.calls[0][0] as string) as { attachments: { color: string }[] };
        expect(payload.attachments[0].color).toBe('#dc2626');
    });

    it('does nothing when webhookUrl is undefined', async () => {
        await sendOpsAlert('x', 'y', 'warning', undefined);
        expect(mockRequest).not.toHaveBeenCalled();
    });
});
