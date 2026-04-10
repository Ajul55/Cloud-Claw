import { describe, expect, it, beforeEach } from 'vitest';
import {
    recordAttempt,
    getStrategyContext,
    shouldEscalate,
    getEscalationSummary,
    clearSession,
    getAttempts,
    getFailedCountInCategory,
    detectCategory,
} from './troubleshooting_tracker.js';

const SESSION = 'test-session-1';

beforeEach(() => {
    clearSession(SESSION);
});

// ─── Category Detection ───────────────────────────────────────────────────────

describe('detectCategory', () => {
    it('maps SSL tools directly', () => {
        expect(detectCategory('check_ssl_api', '{}')).toBe('ssl');
        expect(detectCategory('renew_ssl_api', '{}')).toBe('ssl');
        expect(detectCategory('issue_ssl', '{}')).toBe('ssl');
    });

    it('maps nginx tools directly', () => {
        expect(detectCategory('diagnose_nginx', '{}')).toBe('nginx');
        expect(detectCategory('fix_nginx_config', '{}')).toBe('nginx');
    });

    it('maps database tools directly', () => {
        expect(detectCategory('repair_mysql', '{}')).toBe('database');
    });

    it('infers SSL from execute_ssh_command args', () => {
        expect(detectCategory('execute_ssh_command', '{"command":"openssl s_client -connect foo:443"}')).toBe('ssl');
        expect(detectCategory('execute_ssh_command', '{"command":"cat /home/user/ssl/cert.pem"}')).toBe('ssl');
    });

    it('infers nginx from execute_ssh_command args', () => {
        expect(detectCategory('execute_ssh_command', '{"command":"cat /etc/nginx-cs/vhosts.d/site.conf"}')).toBe('nginx');
    });

    it('infers database from execute_ssh_command args', () => {
        expect(detectCategory('execute_ssh_command', '{"command":"systemctl status mariadb"}')).toBe('database');
    });

    it('infers disk from execute_ssh_command args', () => {
        expect(detectCategory('execute_ssh_command', '{"command":"df -h"}')).toBe('disk');
    });

    it('falls back to generic for unknown tools/args', () => {
        expect(detectCategory('execute_ssh_command', '{"command":"whoami"}')).toBe('generic');
        expect(detectCategory('unknown_tool', '{}')).toBe('generic');
    });
});

// ─── Attempt Recording ────────────────────────────────────────────────────────

describe('recordAttempt', () => {
    it('records and retrieves attempts', () => {
        recordAttempt(SESSION, 'check_ssl_api', { server_id: '1' }, false, 'timeout');

        const attempts = getAttempts(SESSION);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].toolName).toBe('check_ssl_api');
        expect(attempts[0].category).toBe('ssl');
        expect(attempts[0].success).toBe(false);
        expect(attempts[0].outputSnippet).toContain('timeout');
    });

    it('truncates long output', () => {
        const longOutput = 'x'.repeat(500);
        recordAttempt(SESSION, 'check_ssl_api', {}, false, longOutput);

        const attempts = getAttempts(SESSION);
        expect(attempts[0].outputSnippet.length).toBeLessThanOrEqual(300);
    });

    it('caps stored attempts at 30', () => {
        for (let i = 0; i < 35; i++) {
            recordAttempt(SESSION, 'execute_ssh_command', { command: `cmd-${i}` }, false, `output-${i}`);
        }
        expect(getAttempts(SESSION)).toHaveLength(30);
    });
});

// ─── Strategy Context ─────────────────────────────────────────────────────────

describe('getStrategyContext', () => {
    it('returns undefined when no attempts recorded', () => {
        expect(getStrategyContext(SESSION)).toBeUndefined();
    });

    it('returns undefined when all attempts succeeded', () => {
        recordAttempt(SESSION, 'check_ssl_api', {}, true, 'SSL valid');
        expect(getStrategyContext(SESSION)).toBeUndefined();
    });

    it('returns context with failed attempts and next strategy suggestion', () => {
        recordAttempt(SESSION, 'check_ssl_api', { server_id: '1' }, false, 'Invalid token');

        const ctx = getStrategyContext(SESSION);
        expect(ctx).toBeDefined();
        expect(ctx).toContain('SSL');
        expect(ctx).toContain('check_ssl_api');
        expect(ctx).toContain('Invalid token');
        expect(ctx).toContain('NEXT');
        expect(ctx).toContain('DO NOT REPEAT');
    });

    it('suggests progressively different strategies as more fail', () => {
        // Fail api_check
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'error 1');
        const ctx1 = getStrategyContext(SESSION)!;
        // Next SSL strategy after api_check is dns_check (diagnose_domain)
        expect(ctx1).toContain('diagnose_domain');

        // Fail cert_files too (stays in SSL category)
        recordAttempt(SESSION, 'execute_ssh_command', { command: 'cat /home/user/ssl/cert.pem' }, false, 'not found');
        const ctx2 = getStrategyContext(SESSION)!;
        // Should still suggest next untried SSL strategies
        expect(ctx2).toContain('NEXT');
    });

    it('tells LLM to escalate when all strategies in a category are exhausted', () => {
        // Exhaust all SSL strategies — including cross-category ones
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'fail');          // api_check
        recordAttempt(SESSION, 'diagnose_domain', {}, false, 'fail');        // dns_check (cross-category)
        recordAttempt(SESSION, 'execute_ssh_command', { command: 'cat /home/user/ssl/cert.pem' }, false, 'fail');  // cert_files
        recordAttempt(SESSION, 'execute_ssh_command', { command: 'cat /etc/nginx-cs/ssl.conf listen 443' }, false, 'fail');  // nginx_ssl_config
        recordAttempt(SESSION, 'renew_ssl_api', {}, false, 'fail');          // renewal
        recordAttempt(SESSION, 'execute_ssh_command', { command: 'ss -tlnp | grep :443' }, false, 'fail');  // firewall
        recordAttempt(SESSION, 'execute_ssh_command', { command: 'curl -kI https://example.com' }, false, 'fail');  // connectivity

        const ctx = getStrategyContext(SESSION)!;
        expect(ctx).toContain('SSL');
        expect(ctx).toContain('EXHAUSTED');
    });
});

// ─── Escalation ───────────────────────────────────────────────────────────────

describe('shouldEscalate', () => {
    it('returns false with no attempts', () => {
        expect(shouldEscalate(SESSION)).toBe(false);
    });

    it('returns false with few failures', () => {
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'fail');
        recordAttempt(SESSION, 'diagnose_domain', {}, true, 'ok');
        expect(shouldEscalate(SESSION)).toBe(false);
    });

    it('returns true after 5 consecutive failures', () => {
        for (let i = 0; i < 5; i++) {
            recordAttempt(SESSION, 'execute_ssh_command', { command: `cmd-${i}` }, false, `fail-${i}`);
        }
        expect(shouldEscalate(SESSION)).toBe(true);
    });

    it('resets consecutive count on success', () => {
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'fail');
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'fail');
        recordAttempt(SESSION, 'diagnose_domain', {}, true, 'ok'); // breaks the streak
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'fail');
        expect(shouldEscalate(SESSION)).toBe(false);
    });
});

describe('getEscalationSummary', () => {
    it('returns empty message with no attempts', () => {
        expect(getEscalationSummary(SESSION)).toContain('No troubleshooting attempts');
    });

    it('produces a formatted summary with attempt history', () => {
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'Invalid token');
        recordAttempt(SESSION, 'diagnose_domain', {}, false, 'DNS timeout');
        recordAttempt(SESSION, 'execute_ssh_command', { command: 'curl https://example.com' }, false, 'Connection refused');

        const summary = getEscalationSummary(SESSION);
        expect(summary).toContain('Troubleshooting Summary');
        expect(summary).toContain('check_ssl_api');
        expect(summary).toContain('diagnose_domain');
        expect(summary).toContain('3 failed');
    });

    it('includes root cause hypothesis for SSL timeout patterns', () => {
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'Request timed out');
        recordAttempt(SESSION, 'renew_ssl_api', {}, false, 'Connection timed out');

        const summary = getEscalationSummary(SESSION);
        expect(summary).toContain('Root cause hypothesis');
        expect(summary).toContain('firewall');
    });
});

// ─── Session Management ───────────────────────────────────────────────────────

describe('clearSession', () => {
    it('removes all attempts for a session', () => {
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'fail');
        expect(getAttempts(SESSION)).toHaveLength(1);

        clearSession(SESSION);
        expect(getAttempts(SESSION)).toHaveLength(0);
    });
});

describe('getFailedCountInCategory', () => {
    it('counts failures in a specific category', () => {
        recordAttempt(SESSION, 'check_ssl_api', {}, false, 'fail');
        recordAttempt(SESSION, 'check_ssl_api', {}, true, 'ok');
        recordAttempt(SESSION, 'diagnose_nginx', {}, false, 'fail');

        expect(getFailedCountInCategory(SESSION, 'ssl')).toBe(1);
        expect(getFailedCountInCategory(SESSION, 'nginx')).toBe(1);
        expect(getFailedCountInCategory(SESSION, 'database')).toBe(0);
    });
});
