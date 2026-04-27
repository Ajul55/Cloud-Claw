/**
 * Health Check Server — Cloud-Claw
 *
 * Lightweight HTTP endpoint for load balancers and monitoring.
 * Reports database connectivity status.
 *
 * GET /health → 200 { status: 'ok', db: 'connected', uptime: ... }
 *            → 503 { status: 'error', db: 'disconnected' }
 */

import http from 'http';
import { getPool, isDBConfigured } from './database/db.js';
import { handleDashboardRequest } from './dashboard/server.js';
import { getTotalActiveSessions } from './services/session_limiter.js';

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

// MED-8: Readiness registry — index.ts marks services ready as they connect
const readinessChecks = new Map<string, () => boolean>();

export function registerReadinessCheck(name: string, check: () => boolean): void {
    readinessChecks.set(name, check);
}

export function startHealthServer(port = 9000, gatewayHandler?: RequestHandler): void {
    const server = http.createServer(async (req, res) => {
        const url = req.url ?? '/';

        // ── Serve Cloudstick HTTP Gateway ─────────────────────────────────────
        if (gatewayHandler && url.startsWith('/api/')) {
            try {
                await gatewayHandler(req, res);
            } catch (err) {
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
            }
            return;
        }

        if (req.url === '/ready') {
            const failing: string[] = [];
            for (const [name, check] of readinessChecks) {
                if (!check()) failing.push(name);
            }
            const ready = failing.length === 0;
            res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ready, failing: ready ? [] : failing }));
            return;
        }

        if (req.url !== '/health') {
            res.writeHead(404);
            res.end();
            return;
        }

        const headers = { 'Content-Type': 'application/json' };

        if (!isDBConfigured()) {
            res.writeHead(503, headers);
            res.end(JSON.stringify({
                status: 'degraded',
                db: 'not_configured',
                uptime: process.uptime(),
            }));
            return;
        }

        try {
            await getPool().query('SELECT 1');
            let pendingApprovals = 0;
            try {
                const r = await getPool().query<{ count: string }>(
                    `SELECT COUNT(*) AS count FROM approval_queue WHERE status = 'pending'`
                );
                pendingApprovals = parseInt(r.rows[0]?.count ?? '0', 10);
            } catch { /* non-fatal */ }

            // Resolve all async values BEFORE writing headers so the catch block
            // can still send a 503 if any of these throw.
            let activeSessions = 0;
            try { activeSessions = await getTotalActiveSessions(); } catch { /* non-fatal */ }

            res.writeHead(200, headers);
            res.end(JSON.stringify({
                status: 'ok',
                db: 'connected',
                uptime: Math.round(process.uptime()),
                memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
                activeSessions,
                pendingApprovals,
            }));
        } catch {
            res.writeHead(503, headers);
            res.end(JSON.stringify({
                status: 'error',
                db: 'disconnected',
                uptime: Math.round(process.uptime()),
            }));
        }
    });

    server.listen(port, () => {
        console.log(`[health] Listening on :${port}/health`);
        if (gatewayHandler) console.log(`[health] Gateway mounted on :${port}/api/`);
    });

    // Don't let the health server keep the process alive if everything else shuts down
    server.unref();
}

export function startDashboardServer(port = 3001): void {
    const server = http.createServer(async (req, res) => {
        try {
            await handleDashboardRequest(req, res);
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'internal_error' }));
            }
        }
    });
    server.listen(port, () => {
        console.log(`[dashboard] Listening on :${port}`);
    });
    server.unref();
}
