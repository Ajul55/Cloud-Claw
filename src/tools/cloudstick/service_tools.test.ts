import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sshExecMock, resolveServerArgMock } = vi.hoisted(() => ({
    sshExecMock: vi.fn(),
    resolveServerArgMock: vi.fn(),
}));

vi.mock('../../utils/ssh.js', () => ({
    sshExec: sshExecMock,
}));

vi.mock('../../utils/server_registry.js', () => ({
    resolveServerArg: resolveServerArgMock,
    formatServerTarget: (server: { label: string; ip: string }) => `${server.label} (${server.ip})`,
}));

import { manageServiceTool } from './service_tools.js';

describe('manageServiceTool', () => {
    beforeEach(() => {
        sshExecMock.mockReset();
        resolveServerArgMock.mockReset();
        resolveServerArgMock.mockResolvedValue({
            id: 65,
            label: 'Cloud-Claw-Test',
            ip: '65.20.83.180',
            sshUser: 'root',
            sshPort: 22,
        });
    });

    it('uses SSH status checks and normalizes nginx to nginx-cs', async () => {
        sshExecMock.mockResolvedValueOnce('active\nnginx-cs status output');

        const result = await manageServiceTool.execute({
            server_label: 'Cloud-Claw-Test',
            service: 'nginx',
            action: 'status',
        });

        expect(result.success).toBe(true);
        expect(sshExecMock).toHaveBeenCalledWith(
            '65.20.83.180',
            expect.stringContaining('systemctl is-active nginx-cs'),
            expect.objectContaining({ user: 'root', port: 22 }),
        );
        expect(result.output).toContain('nginx-cs');
        expect(result.output).toContain('Cloud-Claw-Test (65.20.83.180)');
    });

    it('restarts services over SSH instead of using the API', async () => {
        sshExecMock
            .mockResolvedValueOnce('inactive')
            .mockResolvedValueOnce('restart output')
            .mockResolvedValueOnce('active')
            .mockResolvedValueOnce('status detail');

        const result = await manageServiceTool.execute({
            server_id: '65',
            server_label: 'Cloud-Claw-Test',
            service: 'redis',
            action: 'restart',
        });

        expect(result.success).toBe(true);
        expect(sshExecMock).toHaveBeenNthCalledWith(
            2,
            '65.20.83.180',
            'systemctl restart redis-server 2>&1',
            expect.objectContaining({ user: 'root', port: 22 }),
        );
        expect(result.output).toContain('redis-server');
        expect(result.output).toContain('succeeded over SSH');
    });

    it('blocks services outside the allowlist', async () => {
        const result = await manageServiceTool.execute({
            server_label: 'Cloud-Claw-Test',
            service: 'docker',
            action: 'restart',
        });

        expect(result.success).toBe(false);
        expect(result.output).toContain('BLOCKED');
        expect(sshExecMock).not.toHaveBeenCalled();
    });
});
