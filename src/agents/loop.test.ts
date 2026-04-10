import { describe, expect, it } from 'vitest';
import {
    extractCompletionChoice,
    hydrateServerToolArgs,
    intentRequiresServerTarget,
    isNewWebsiteCreationRequest,
} from './loop.js';

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

    it('hydrates missing tool args from a resolved server target', () => {
        const toolArgs: Record<string, unknown> = {};

        hydrateServerToolArgs(toolArgs, {
            id: 42,
            label: 'mail-server',
            ip: '65.20.79.171',
        });

        expect(toolArgs).toEqual({
            server_id: '42',
            server_label: 'mail-server',
            host: '65.20.79.171',
        });
    });

    it('detects new website creation requests', () => {
        expect(isNewWebsiteCreationRequest('create a website named amru.ajul.site on mail-server')).toBe(true);
        expect(isNewWebsiteCreationRequest('create new site amru.ajul.site')).toBe(true);
    });

    it('does not misclassify explicit existing-site attach requests as new website creation', () => {
        expect(isNewWebsiteCreationRequest('add subdomain amru to existing website web.ajul.site')).toBe(false);
        expect(isNewWebsiteCreationRequest('attach domain amru.ajul.site to existing site web.ajul.site')).toBe(false);
    });

    it('throws a clear error when the provider returns no choices', () => {
        expect(() => extractCompletionChoice({
            id: 'chatcmpl_test',
            object: 'chat.completion',
            model: 'broken-provider',
        })).toThrow(/LLM returned no choices/);
    });
});
