import { describe, expect, it } from 'vitest';
import { checkCommand, isWriteCommand, requiresApproval } from './command_filter.js';

describe('command_filter', () => {
    it('allows docker inspection commands', () => {
        expect(checkCommand('docker ps --format "{{.Names}}"')).toEqual({ safe: true });
        expect(checkCommand('docker logs n8n --tail 50')).toEqual({ safe: true });
        expect(checkCommand('docker inspect n8n')).toEqual({ safe: true });
    });

    it('allows safe docker exec reads', () => {
        expect(checkCommand('docker exec n8n cat /etc/nginx/nginx.conf')).toEqual({ safe: true });
        expect(checkCommand('docker exec web nginx -T')).toEqual({ safe: true });
    });

    it('routes docker restart through approval instead of blocking it', () => {
        expect(checkCommand('docker restart n8n')).toEqual({ safe: true });
        expect(requiresApproval('docker restart n8n')).toBe('Docker container state change');
        expect(isWriteCommand('docker restart n8n')).toBe(true);
    });

    it('allows sleep for sequencing', () => {
        expect(checkCommand('sleep 2')).toEqual({ safe: true });
        expect(checkCommand('docker restart n8n && sleep 2 && docker ps')).toEqual({ safe: true });
    });

    it('still blocks dangerous docker exec writes', () => {
        const result = checkCommand('docker exec n8n rm -rf /tmp/test');
        expect(result.safe).toBe(false);
        expect(result.reason).toMatch(/BLOCKED/);
    });
});
