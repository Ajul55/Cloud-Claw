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

describe('host-aware hallucination guard', () => {
    function makeReceipt(host: string, toolName = 'fix_nginx_config', success = true): ToolReceipt {
        return { toolName, success, host, timestamp: Date.now(), outputHash: 'abc123' };
    }

    it('does NOT flag write claim when write receipt exists for the SAME host', () => {
        const receipts = new Map([['fix_nginx_config', makeReceipt('10.0.0.1')]]);
        expect(checkForHallucination('Nginx is now fixed and running', receipts, 60_000, '10.0.0.1')).toBe(false);
    });

    it('DOES flag write claim when write receipt is for a DIFFERENT host', () => {
        const receipts = new Map([['fix_nginx_config', makeReceipt('10.0.0.1')]]);
        expect(checkForHallucination('Nginx is now fixed and running', receipts, 60_000, '10.0.0.2')).toBe(true);
    });

    it('falls back to host-agnostic check when no currentHost provided', () => {
        const receipts = new Map([['fix_nginx_config', makeReceipt('10.0.0.1')]]);
        // host-agnostic: any write receipt satisfies the check
        expect(checkForHallucination('Nginx is now fixed and running', receipts, 60_000)).toBe(false);
    });

    it('DOES flag when write receipt exists but is failed (success=false)', () => {
        const receipts = new Map([['fix_nginx_config', makeReceipt('10.0.0.1', 'fix_nginx_config', false)]]);
        expect(checkForHallucination('Nginx is now fixed and running', receipts, 60_000, '10.0.0.1')).toBe(true);
    });
});
