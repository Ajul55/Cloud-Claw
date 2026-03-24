import { describe, expect, it } from 'vitest';
import { describeApprovalCommand, encodeToolApprovalCommand } from './tool_approval.js';

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
