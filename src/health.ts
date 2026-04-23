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

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

export function startHealthServer(port = 9000, gatewayHandler?: RequestHandler): void {
    const server = http.createServer(async (req, res) => {
        // Dashboard routes (/api/stats and /dashboard/*) take priority
        const url = req.url ?? '/';
        if (url === '/api/stats' || url.startsWith('/api/stats?') || url === '/dashboard' || url.startsWith('/dashboard/')) {
            await handleDashboardRequest(req, res);
            return;
        }

        if (gatewayHandler && req.url?.startsWith('/api/')) {
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
                pid: process.pid,
            }));
            return;
        }

        try {
            await getPool().query('SELECT 1');
            res.writeHead(200, headers);
            res.end(JSON.stringify({
                status: 'ok',
                db: 'connected',
                uptime: Math.round(process.uptime()),
                pid: process.pid,
                memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
            }));
        } catch {
            res.writeHead(503, headers);
            res.end(JSON.stringify({
                status: 'error',
                db: 'disconnected',
                uptime: Math.round(process.uptime()),
                pid: process.pid,
            }));
        }
    });

    server.listen(port, () => {
        console.log(`[health] Listening on :${port}/health`);
        console.log(`[dashboard] Available at :${port}/dashboard`);
        if (gatewayHandler) console.log(`[health] Gateway mounted on :${port}/api/`);
    });

    // Don't let the health server keep the process alive if everything else shuts down
    server.unref();
}
