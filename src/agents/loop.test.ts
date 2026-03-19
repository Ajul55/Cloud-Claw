import { describe, expect, it } from 'vitest';
import { intentRequiresServerTarget } from './loop.js';

describe('Loop routing', () => {
    it('does not require a server target for Cloudstick connectivity checks', () => {
        expect(intentRequiresServerTarget({
            requiresTool: true,
            toolHint: 'check_cloudstick_connection',
        })).toBe(false);
    });

    it('still requires a server target for SSH-backed diagnostics', () => {
        expect(intentRequiresServerTarget({
            requiresTool: true,
            toolHint: 'diagnose_nginx',
        })).toBe(true);
    });
});
