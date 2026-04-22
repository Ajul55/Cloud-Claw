import { describe, expect, it } from 'vitest';
import { describeApprovalCommand, encodeToolApprovalCommand, decodeToolApprovalCommand } from './tool_approval.js';

describe('Tool approval metadata', () => {
    it('redacts sensitive args and hides internal args from approval details', () => {
        const command = encodeToolApprovalCommand('change_system_user_password', {
            server_label: 'production',
            username: 'alice',
            password: 'super-secret',
            __stateHash: 'deadbeef',
        });

        const details = describeApprovalCommand(command);

        expect(details.title).toBe('Run tool: change_system_user_password');
        expect(details.details).toContainEqual({ label: 'server_label', value: 'production' });
        expect(details.details).toContainEqual({ label: 'username', value: 'alice' });
        expect(details.details).toContainEqual({ label: 'password', value: '[REDACTED]' });
        expect(details.details.some((detail) => detail.label === '__stateHash')).toBe(false);
    });
});

describe('encodeToolApprovalCommand / decodeToolApprovalCommand round-trip', () => {
    it('round-trips standard args', () => {
        const args = { server_label: 'prod', host: '10.0.0.1', file_path: '/etc/nginx/site.conf' };
        const enc = encodeToolApprovalCommand('fix_nginx_config', args);
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.toolName).toBe('fix_nginx_config');
        expect(dec?.args).toEqual(args);
    });

    it('round-trips value containing a pipe character', () => {
        const enc = encodeToolApprovalCommand('execute_ssh_write', {
            command: 'echo "a|b"',
            server_label: 'prod',
        });
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.args.command).toBe('echo "a|b"');
    });

    it('round-trips value containing an equals sign', () => {
        const enc = encodeToolApprovalCommand('fix_nginx_config', {
            file_path: '/etc/nginx/k=v.conf',
        });
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.args.file_path).toBe('/etc/nginx/k=v.conf');
    });

    it('round-trips empty args', () => {
        const enc = encodeToolApprovalCommand('some_tool', {});
        const dec = decodeToolApprovalCommand(enc);
        expect(dec?.toolName).toBe('some_tool');
        expect(dec?.args).toEqual({});
    });

    it('decodes legacy pipe-delimited format (backwards compat)', () => {
        // Simulate a legacy-format approval command already in the DB
        const legacy = 'TOOL:fix_nginx_config|server_label=prod|file_path=%2Fetc%2Fnginx%2Fsite.conf';
        const dec = decodeToolApprovalCommand(legacy);
        expect(dec?.toolName).toBe('fix_nginx_config');
        expect(dec?.args.server_label).toBe('prod');
        expect(dec?.args.file_path).toBe('/etc/nginx/site.conf');
    });

    it('returns null for non-TOOL: prefix', () => {
        expect(decodeToolApprovalCommand('not-a-tool-command')).toBeNull();
    });

    it('decodes legacy format with __stateHash appended after encoding', () => {
        // Simulate what loop.ts currently does: append |__stateHash= after the encoded command
        const legacy = 'TOOL:fix_nginx_config|server_label=prod|file_path=%2Fetc%2Fnginx%2Fsite.conf|__stateHash=deadbeef1234';
        const dec = decodeToolApprovalCommand(legacy);
        expect(dec?.toolName).toBe('fix_nginx_config');
        expect(dec?.args.server_label).toBe('prod');
        expect(dec?.args.file_path).toBe('/etc/nginx/site.conf');
        expect(dec?.args.__stateHash).toBe('deadbeef1234');
    });
});
