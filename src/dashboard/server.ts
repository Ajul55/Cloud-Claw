import http from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { fetchStats, fetchSessions, fetchServers, fetchApprovals, fetchTools, fetchBurnRate, type Range, type BurnRange } from './queries.js';
import { isDBConfigured } from '../database/db.js';

// process.cwd() is /app in Docker and repo root in dev — both correct
const DIST_DIR = path.resolve(process.cwd(), 'dist/public');
const VALID_RANGES      = new Set<Range>(['24h', '7d', '30d']);
const VALID_BURN_RANGES = new Set<BurnRange>(['7d', '14d', '30d']);

function checkDashboardAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const token = process.env.DASHBOARD_TOKEN;
    if (!token) return true; // auth disabled when token not configured
    const header = req.headers['authorization'] ?? '';
    if (header === `Bearer ${token}`) return true;
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string, isHashed = false): void {
    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const ext = path.extname(filePath);
    const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js':   'application/javascript',
        '.css':  'text/css',
        '.svg':  'image/svg+xml',
        '.png':  'image/png',
        '.ico':  'image/x-icon',
    };
    // Hashed assets (e.g. index-BdNqlVK4.js) are content-addressed — cache forever.
    // index.html is never hashed — must not be cached so browsers always get the
    // latest bundle filenames after a deploy.
    const cacheControl = isHashed
        ? 'public, max-age=31536000, immutable'
        : 'no-store, must-revalidate';
    res.writeHead(200, {
        'Content-Type': mime[ext] ?? 'application/octet-stream',
        'Cache-Control': cacheControl,
    });
    const stream = fs.createReadStream(filePath);
    req.on('close', () => stream.destroy());
    stream.pipe(res as unknown as NodeJS.WritableStream);
}

export async function handleDashboardRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // ── Auth gate for all API routes ─────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
        if (!checkDashboardAuth(req, res)) return;
    }

    // ── /api/stats ────────────────────────────────────────────────────────────
    if (pathname === '/api/stats') {
        if (!isDBConfigured()) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'db_not_configured' }));
            return;
        }
        const rangeParam = url.searchParams.get('range') ?? '24h';
        if (!VALID_RANGES.has(rangeParam as Range)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_range', valid: ['24h', '7d', '30d'] }));
            return;
        }
        try {
            const stats = await fetchStats(rangeParam as Range);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (err) {
            console.error('[dashboard] /api/stats error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal_error' }));
        }
        return;
    }

    // ── /api/sessions ────────────────────────────────────────────────────────
    if (pathname === '/api/sessions') {
        if (!isDBConfigured()) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'db_not_configured' }));
            return;
        }
        try {
            const sessions = await fetchSessions(100);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sessions }));
        } catch (err) {
            console.error('[dashboard] /api/sessions error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal_error' }));
        }
        return;
    }

    // ── /api/servers ─────────────────────────────────────────────────────────
    if (pathname === '/api/servers') {
        if (!isDBConfigured()) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'db_not_configured' }));
            return;
        }
        try {
            const servers = await fetchServers();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ servers }));
        } catch (err) {
            console.error('[dashboard] /api/servers error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal_error' }));
        }
        return;
    }

    // ── /api/approvals ───────────────────────────────────────────────────────
    if (pathname === '/api/approvals') {
        if (!isDBConfigured()) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'db_not_configured' }));
            return;
        }
        try {
            const statusFilter = url.searchParams.get('status') ?? undefined;
            const approvals = await fetchApprovals(statusFilter);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ approvals }));
        } catch (err) {
            console.error('[dashboard] /api/approvals error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal_error' }));
        }
        return;
    }

    // ── /api/burnrate ─────────────────────────────────────────────────────────
    if (pathname === '/api/burnrate') {
        if (!isDBConfigured()) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'db_not_configured' }));
            return;
        }
        const rangeParam = url.searchParams.get('range') ?? '7d';
        if (!VALID_BURN_RANGES.has(rangeParam as BurnRange)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_range', valid: ['7d', '14d', '30d'] }));
            return;
        }
        try {
            const data = await fetchBurnRate(rangeParam as BurnRange);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data }));
        } catch (err) {
            console.error('[dashboard] /api/burnrate error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal_error' }));
        }
        return;
    }

    // ── /api/tools ───────────────────────────────────────────────────────────
    if (pathname === '/api/tools') {
        if (!isDBConfigured()) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'db_not_configured' }));
            return;
        }
        const rangeParam = url.searchParams.get('range') ?? '24h';
        if (!VALID_RANGES.has(rangeParam as Range)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_range' }));
            return;
        }
        try {
            const result = await fetchTools(rangeParam as Range);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch (err) {
            console.error('[dashboard] /api/tools error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal_error' }));
        }
        return;
    }

    // ── /dashboard (SPA root) ─────────────────────────────────────────────────
    if (pathname === '/dashboard' || pathname === '/dashboard/') {
        serveFile(req, res, path.join(DIST_DIR, 'index.html'));
        return;
    }

    // ── /dashboard/assets/* ───────────────────────────────────────────────────
    if (pathname.startsWith('/dashboard/')) {
        const relative = pathname.replace('/dashboard/', '');
        // Assets under /assets/ are Vite content-hashed — safe to cache forever.
        const isHashed = relative.startsWith('assets/');
        serveFile(req, res, path.join(DIST_DIR, relative), isHashed);
        return;
    }

    res.writeHead(404);
    res.end();
}
