import { describe, it, expect } from 'vitest';
import { createApproval, resolveApproval } from './db.js';
// Do NOT call connectDB() — this exercises the in-memory path.
// Each test uses unique session_id + tool_call_id to avoid shared-state interference.

describe('resolveApproval — in-memory CAS', () => {
    it('second call on same approval returns null (idempotency)', async () => {
        // Note: Promise.all in Node.js does not guarantee truly concurrent execution
        // (JS is single-threaded). This test validates sequential idempotency.
        // For concurrent deployments, the PostgreSQL path uses WHERE status = 'pending'
        // which provides true atomicity at the database level.
        const record = await createApproval({
            session_id: 'test:cas-u1',
            command: 'TOOL:fix_nginx_config|file_path=%2Fetc%2Fnginx',
            target_host: 'srv',
            rationale: 'test',
            tool_call_id: 'tc-cas-1',
        });

        const [r1, r2] = await Promise.all([
            resolveApproval(record.id, 'approved'),
            resolveApproval(record.id, 'approved'),
        ]);

        const successes = [r1, r2].filter(r => r !== null);
        expect(successes).toHaveLength(1);
    });

    it('returns null for already-resolved approval', async () => {
        const record = await createApproval({
            session_id: 'test:cas-u2',
            command: 'TOOL:fix_nginx_config|file_path=%2Fetc%2Fnginx',
            target_host: 'srv',
            rationale: 'test',
            tool_call_id: 'tc-cas-2',
        });
        await resolveApproval(record.id, 'approved');
        const second = await resolveApproval(record.id, 'approved');
        expect(second).toBeNull();
    });

    it('returns null for non-existent approval id', async () => {
        const result = await resolveApproval(999999, 'approved');
        expect(result).toBeNull();
    });
});
