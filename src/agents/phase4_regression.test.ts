/**
 * Phase 4 Regression Tests
 *
 * Tests for:
 * 1. SSH Escalation Analyzer lane classification and reporting
 * 2. Hallucination guard new Phase 3/4 patterns
 * 3. Server disambiguation expanded nickname matching
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { recordToolUsage, getEscalationReport, resetUsageLog } from '../telemetry/ssh_escalation_analyzer.js';
import { checkForHallucination } from './hallucination_guard.js';
import type { ToolReceipt } from './loop.js';

// ─── SSH Escalation Analyzer Tests ──────────────────────────────────────────

describe('SSH Escalation Analyzer', () => {
    beforeEach(() => resetUsageLog());

    it('classifies API tools as Lane 1', () => {
        recordToolUsage('create_system_user', 'sess-1', true);
        recordToolUsage('issue_ssl', 'sess-1', true);
        recordToolUsage('switch_php_api', 'sess-1', true);
        const report = getEscalationReport();
        expect(report.lane1Count).toBe(3);
        expect(report.lane2Count).toBe(0);
        expect(report.lane3Count).toBe(0);
    });

    it('classifies SSH tools as Lane 2/3', () => {
        recordToolUsage('execute_ssh_command', 'sess-1', true);
        recordToolUsage('diagnose_nginx', 'sess-1', true);
        recordToolUsage('fix_nginx_config', 'sess-1', true);
        const report = getEscalationReport();
        expect(report.lane1Count).toBe(0);
        expect(report.lane2Count).toBe(2);
        expect(report.lane3Count).toBe(1);
    });

    it('reports SSH percentage correctly', () => {
        recordToolUsage('issue_ssl', 'sess-1', true);
        recordToolUsage('execute_ssh_command', 'sess-1', true);
        const report = getEscalationReport();
        expect(report.sshPct).toBe('50.0%');
        expect(report.apiOnlyPct).toBe('50.0%');
    });

    it('generates recommendation based on SSH percentage', () => {
        // 100% SSH => warning
        recordToolUsage('execute_ssh_command', 'sess-1', true);
        const report = getEscalationReport();
        expect(report.recommendation).toContain('⚠️');
    });
});

// ─── Hallucination Guard Phase 3/4 Tests ────────────────────────────────────

describe('Hallucination Guard — Phase 3/4 patterns', () => {
    const emptyReceipts = new Map<string, ToolReceipt>();
    const ONE_HOUR = 60 * 60 * 1000;

    it('flags SSL claim without receipt', () => {
        expect(checkForHallucination(
            'The SSL certificate has been issued successfully.',
            emptyReceipts, ONE_HOUR
        )).toBe(true);
    });

    it('flags database creation claim without receipt', () => {
        expect(checkForHallucination(
            'The database has been created.',
            emptyReceipts, ONE_HOUR
        )).toBe(true);
    });

    it('flags PHP switch claim without receipt', () => {
        expect(checkForHallucination(
            'PHP has been switched to 8.3 on the server.',
            emptyReceipts, ONE_HOUR
        )).toBe(true);
    });

    it('flags cron job creation claim without receipt', () => {
        expect(checkForHallucination(
            'A new cron job has been created for this website.',
            emptyReceipts, ONE_HOUR
        )).toBe(true);
    });

    it('flags "i have already configured" without receipt', () => {
        expect(checkForHallucination(
            "I've already configured the SSL for your domain.",
            emptyReceipts, ONE_HOUR
        )).toBe(true);
    });

    it('does not flag read-only status report', () => {
        expect(checkForHallucination(
            'Here is the current SSL status for your domain: Let\'s Encrypt, expires 2025-12-01.',
            emptyReceipts, ONE_HOUR
        )).toBe(false);
    });

    it('does not flag normal question', () => {
        expect(checkForHallucination(
            'Which PHP version would you like to switch to?',
            emptyReceipts, ONE_HOUR
        )).toBe(false);
    });
});
