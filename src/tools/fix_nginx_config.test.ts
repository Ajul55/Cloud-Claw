import { describe, it, expect, vi } from 'vitest';

// Mock SSH and server resolution — no real network calls
vi.mock('../utils/ssh.js', () => ({ sshExec: vi.fn().mockResolvedValue('') }));
vi.mock('../utils/server_registry.js', () => ({
    getServerByLabel: vi.fn().mockResolvedValue({ ip: '127.0.0.1', sshUser: 'root', sshPort: 22, label: 'test', id: 1, active: true }),
    resolveServerFromMessage: vi.fn().mockResolvedValue({ ip: '127.0.0.1', sshUser: 'root', sshPort: 22, label: 'test', id: 1, active: true }),
    resolveServerArg: vi.fn().mockResolvedValue({ ip: '127.0.0.1', sshUser: 'root', sshPort: 22, label: 'test', id: 1, active: true }),
    getAllServers: vi.fn().mockResolvedValue([]),
    formatServerTarget: vi.fn().mockReturnValue('test'),
}));

import { fixNginxConfigTool } from './fix_nginx_config.js';

describe('fix_nginx_config path whitelist', () => {
    it('rejects /etc/passwd', async () => {
        const result = await fixNginxConfigTool.execute({ server_label: 'test', file_path: '/etc/passwd' });
        expect(result.success).toBe(false);
        expect(String(result.output)).toMatch(/blocked/i);
    });

    it('rejects /root/.bashrc', async () => {
        const result = await fixNginxConfigTool.execute({ server_label: 'test', file_path: '/root/.bashrc' });
        expect(result.success).toBe(false);
        expect(String(result.output)).toMatch(/blocked/i);
    });

    it('rejects /etc/sudoers', async () => {
        const result = await fixNginxConfigTool.execute({ server_label: 'test', file_path: '/etc/sudoers' });
        expect(result.success).toBe(false);
        expect(String(result.output)).toMatch(/blocked/i);
    });

    it('accepts /etc/nginx-cs/vhosts.d/site.conf', async () => {
        const result = await fixNginxConfigTool.execute({ server_label: 'test', file_path: '/etc/nginx-cs/vhosts.d/site.conf' });
        expect(String(result.output)).not.toMatch(/blocked/i);
    });

    it('accepts /etc/nginx/sites-available/default', async () => {
        const result = await fixNginxConfigTool.execute({ server_label: 'test', file_path: '/etc/nginx/sites-available/default' });
        expect(String(result.output)).not.toMatch(/blocked/i);
    });
});
