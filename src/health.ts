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

export function startHealthServer(port = 9000): void {
    const server = http.createServer(async (req, res) => {
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
    });

    // Don't let the health server keep the process alive if everything else shuts down
    server.unref();
}
