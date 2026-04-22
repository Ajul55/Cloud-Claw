import { describe, it, expect } from 'vitest';
import { createApproval, resolveApproval } from './db.js';
// Do NOT call connectDB() — this exercises the in-memory path

describe('resolveApproval — in-memory CAS', () => {
    it('concurrent calls only succeed once', async () => {
        const record = await createApproval({
            session_id: 'test:u1',
            command: 'TOOL:fix_nginx_config|file_path=%2Fetc%2Fnginx',
            target_host: 'srv',
            rationale: 'test',
            tool_call_id: 'tc1',
        });

        const [r1, r2] = await Promise.all([
            resolveApproval(record.id, 'approved'),
            resolveApproval(record.id, 'approved'),
        ]);

        const successes = [r1, r2].filter(Boolean);
        expect(successes).toHaveLength(1);
    });

    it('returns null for already-resolved approval', async () => {
        const record = await createApproval({
            session_id: 'test:u2',
            command: 'TOOL:fix_nginx_config|file_path=%2Fetc%2Fnginx',
            target_host: 'srv',
            rationale: 'test',
            tool_call_id: 'tc2',
        });
        await resolveApproval(record.id, 'approved');
        const second = await resolveApproval(record.id, 'approved');
        expect(second).toBeNull();
    });
});
