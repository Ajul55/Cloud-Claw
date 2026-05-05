import crypto from 'node:crypto';
import http from 'node:http';
import bcrypt from 'bcrypt';
import { getDashboardPool } from './pool.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const SESSION_TTL_MS      = 8 * 60 * 60 * 1000;   // 8 hours
const BCRYPT_COST         = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;        // 15 minutes

// In-memory IP rate limiter: max 10 login attempts per IP per 5 minutes
const ipAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS  = 5 * 60 * 1000;
const RATE_MAX        = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminUser {
    id: number;
    username: string;
    role: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCookies(req: http.IncomingMessage): Record<string, string> {
    const raw = req.headers['cookie'] ?? '';
    return Object.fromEntries(
        raw.split(';')
            .map(s => s.trim().split('='))
            .filter(p => p.length === 2)
            .map(([k, v]) => [k.trim(), decodeURIComponent(v.trim())])
    );
}

function setSessionCookie(res: http.ServerResponse, sessionId: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    const maxAge = SESSION_TTL_MS / 1000;
    const flags = [
        `HttpOnly`,
        `SameSite=Strict`,
        `Path=/`,
        `Max-Age=${maxAge}`,
        isProd ? `Secure` : '',
    ].filter(Boolean).join('; ');
    res.setHeader('Set-Cookie', `dash_session=${sessionId}; ${flags}`);
}

function clearSessionCookie(res: http.ServerResponse): void {
    res.setHeader('Set-Cookie', 'dash_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function getClientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress ?? 'unknown';
}

function checkIpRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = ipAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
        ipAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return true;
    }
    entry.count++;
    if (entry.count > RATE_MAX) return false;
    return true;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += String(chunk); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
}

// ─── Session Management ───────────────────────────────────────────────────────

async function createSession(adminId: number, req: http.IncomingMessage): Promise<string> {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? null;

    await getDashboardPool().query(
        `INSERT INTO dashboard_sessions (id, admin_id, ip, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, adminId, ip, userAgent, expiresAt]
    );
    return sessionId;
}

async function destroySession(sessionId: string): Promise<void> {
    await getDashboardPool().query('DELETE FROM dashboard_sessions WHERE id = $1', [sessionId]);
}

/** Purge expired sessions (called opportunistically). */
async function pruneExpiredSessions(): Promise<void> {
    await getDashboardPool().query('DELETE FROM dashboard_sessions WHERE expires_at < NOW()');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate the session cookie and return the logged-in admin, or null.
 * Also extends the session TTL on each valid request (sliding window).
 */
export async function getSessionAdmin(req: http.IncomingMessage): Promise<AdminUser | null> {
    const cookies = parseCookies(req);
    const sessionId = cookies['dash_session'];
    if (!sessionId || sessionId.length !== 64) return null;

    const { rows } = await getDashboardPool().query<{
        admin_id: number; username: string; role: string; expires_at: Date;
    }>(
        `SELECT s.admin_id, a.username, a.role, s.expires_at
         FROM dashboard_sessions s
         JOIN dashboard_admins a ON a.id = s.admin_id
         WHERE s.id = $1 AND s.expires_at > NOW()`,
        [sessionId]
    );

    if (rows.length === 0) return null;

    // Slide the expiry
    const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
    void getDashboardPool().query('UPDATE dashboard_sessions SET expires_at = $1 WHERE id = $2', [newExpiry, sessionId]);

    return { id: rows[0].admin_id, username: rows[0].username, role: rows[0].role };
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** POST /api/auth/login */
export async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const ip = getClientIp(req);

    if (!checkIpRateLimit(ip)) {
        json(res, 429, { error: 'too_many_attempts' });
        return;
    }

    let body: { username?: unknown; password?: unknown };
    try {
        body = JSON.parse(await readBody(req)) as { username?: unknown; password?: unknown };
    } catch {
        json(res, 400, { error: 'invalid_json' });
        return;
    }

    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
        json(res, 400, { error: 'missing_credentials' });
        return;
    }

    // Fetch admin (constant-time even if user not found)
    const { rows } = await getDashboardPool().query<{
        id: number; username: string; password_hash: string;
        role: string; failed_attempts: number; locked_until: Date | null;
    }>(
        `SELECT id, username, password_hash, role, failed_attempts, locked_until
         FROM dashboard_admins WHERE username = $1`,
        [username]
    );

    // Use a dummy hash to prevent timing attacks when user not found
    const dummyHash = '$2b$12$invalidhashforuserthatdoesnotexist000000000000000000000';
    const admin     = rows[0] ?? null;
    const hashToCheck = admin ? admin.password_hash : dummyHash;

    // Check account lock before bcrypt to fail fast
    if (admin?.locked_until && admin.locked_until > new Date()) {
        // Still run bcrypt to avoid timing leak
        await bcrypt.compare(password, hashToCheck);
        json(res, 403, { error: 'account_locked' });
        return;
    }

    const valid = await bcrypt.compare(password, hashToCheck);

    if (!admin || !valid) {
        if (admin) {
            const newFailed = admin.failed_attempts + 1;
            if (newFailed >= MAX_FAILED_ATTEMPTS) {
                const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
                await getDashboardPool().query(
                    `UPDATE dashboard_admins SET failed_attempts = $1, locked_until = $2 WHERE id = $3`,
                    [newFailed, lockUntil, admin.id]
                );
            } else {
                await getDashboardPool().query(
                    `UPDATE dashboard_admins SET failed_attempts = $1 WHERE id = $2`,
                    [newFailed, admin.id]
                );
            }
        }
        json(res, 401, { error: 'invalid_credentials' });
        return;
    }

    // Reset failed attempts + update last login
    await getDashboardPool().query(
        `UPDATE dashboard_admins
         SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW()
         WHERE id = $1`,
        [admin.id]
    );

    const sessionId = await createSession(admin.id, req);
    setSessionCookie(res, sessionId);

    // Opportunistic cleanup (don't await)
    void pruneExpiredSessions();

    json(res, 200, { ok: true, user: { username: admin.username, role: admin.role } });
}

/** POST /api/auth/logout */
export async function handleLogout(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const cookies = parseCookies(req);
    const sessionId = cookies['dash_session'];
    if (sessionId) {
        await destroySession(sessionId);
    }
    clearSessionCookie(res);
    json(res, 200, { ok: true });
}

/** GET /api/auth/me */
export async function handleMe(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const admin = await getSessionAdmin(req);
    if (!admin) {
        json(res, 401, { error: 'unauthenticated' });
        return;
    }
    json(res, 200, { user: { username: admin.username, role: admin.role } });
}

// ─── Password Utility ─────────────────────────────────────────────────────────

/** Hash a plain-text password. Used by the seed script. */
export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
}
