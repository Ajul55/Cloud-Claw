import { describe, it, expect, vi } from 'vitest';
import { checkForHallucination } from './hallucination_guard.js';
import type { ToolReceipt } from './loop.js';

vi.mock('./loop.js', () => ({
    hasReceipt: vi.fn((receipts: Map<string, ToolReceipt>, acceptable: string[], requireSuccess: boolean) => {
        for (const tool of acceptable) {
            if (receipts.has(tool)) return true;
        }
        return false;
    })
}));

describe('Hallucination Guard', () => {
    it('blocks planning language regardless of receipts', () => {
        const receipts = new Map<string, ToolReceipt>();
        expect(checkForHallucination('I will now run the check', receipts, 1000)).toBe(true);
        expect(checkForHallucination('please give me a moment', receipts, 1000)).toBe(true);
    });

    it('blocks fix claims when no tool has run', () => {
        const receipts = new Map<string, ToolReceipt>();
        expect(checkForHallucination('issue has been resolved', receipts, 1000)).toBe(true);
    });

    it('allows fix claims when a WRITE receipt exists', () => {
        const receipts = new Map<string, ToolReceipt>();
        receipts.set('fix_nginx_config', { toolName: 'fix_nginx_config', success: true, host: 'all', timestamp: Date.now(), outputHash: 'test' });
        expect(checkForHallucination('issue has been resolved', receipts, 1000)).toBe(false);
    });

    it('blocks fix claims when only a READ receipt exists (diagnose_nginx)', () => {
        const receipts = new Map<string, ToolReceipt>();
        // diagnose_nginx is READ-only — should NOT satisfy "is now active/running" claims
        receipts.set('diagnose_nginx', { toolName: 'diagnose_nginx', success: true, host: 'all', timestamp: Date.now(), outputHash: 'test' });
        expect(checkForHallucination('nginx is now active', receipts, 1000)).toBe(true);
    });

    it('allows "is now active" when a WRITE receipt exists', () => {
        const receipts = new Map<string, ToolReceipt>();
        receipts.set('execute_ssh_write', { toolName: 'execute_ssh_write', success: true, host: 'all', timestamp: Date.now(), outputHash: 'test' });
        expect(checkForHallucination('nginx is now active', receipts, 1000)).toBe(false);
    });

    it('blocks SSH key addition claims', () => {
        const receipts = new Map<string, ToolReceipt>();
        receipts.set('execute_ssh_write', { toolName: 'execute_ssh_write', success: true, host: 'all', timestamp: Date.now(), outputHash: 'test' });
        expect(checkForHallucination('SSH key was added successfully', receipts, 1000)).toBe(true);
    });

    it('allows generic text without patterns', () => {
        const receipts = new Map<string, ToolReceipt>();
        expect(checkForHallucination('nginx configuration is in /etc/nginx/nginx.conf', receipts, 1000)).toBe(false);
    });
});
