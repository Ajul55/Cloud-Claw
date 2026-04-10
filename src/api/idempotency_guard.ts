import { createHash } from 'crypto';
import { getCloudstickClient } from './cloudstick_client.js';

/**
 * Idempotency Guard — List Before Act
 * 
 * Prevents duplicate resource creation by:
 * 1. Generating a deterministic idempotency key from (sessionId + action + args)
 * 2. Checking if the resource already exists before creating
 * 3. Returning the existing resource if found
 */

// ─── Idempotency Key Generator ──────────────────────────────────────────────

export function generateIdempotencyKey(sessionId: string, action: string, args: Record<string, unknown>): string {
    const payload = JSON.stringify({ sessionId, action, ...args });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ─── In-memory idempotency cache (per-process) ─────────────────────────────
// Maps idempotency keys to their results for the current process lifetime.
const idempotencyCache = new Map<string, { result: unknown; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCachedResult(key: string): unknown | null {
    const entry = idempotencyCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        idempotencyCache.delete(key);
        return null;
    }
    return entry.result;
}

function setCachedResult(key: string, result: unknown): void {
    idempotencyCache.set(key, { result, timestamp: Date.now() });
    // Prevent unbounded growth
    if (idempotencyCache.size > 500) {
        const oldest = [...idempotencyCache.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        if (oldest) idempotencyCache.delete(oldest[0]);
    }
}

// ─── List-Before-Act Guards ─────────────────────────────────────────────────

export interface ListBeforeActResult<T = unknown> {
    alreadyExists: boolean;
    existing?: T;
}

/**
 * Check if a system user already exists before creating one.
 */
export async function checkSystemUserExists(
    serverId: string,
    userId: string,
    username: string,
): Promise<ListBeforeActResult> {
    try {
        const client = getCloudstickClient();
        const users: any = await client.listSystemUsers(serverId, userId);
        const existing = (users?.data ?? users ?? []).find(
            (u: any) => u.username?.toLowerCase() === username.toLowerCase()
        );
        if (existing) {
            return { alreadyExists: true, existing };
        }
    } catch (err) {
        console.warn('[idempotency] Failed to list system users for pre-check:', err);
    }
    return { alreadyExists: false };
}

/**
 * Check if a database user already exists before creating one (V2 server-level).
 */
export async function checkDatabaseUserExists(
    serverId: string,
    userId: string,
    username: string,
): Promise<ListBeforeActResult> {
    try {
        const client = getCloudstickClient();
        const dbUsers: any = await client.listServerDatabaseUsers(serverId, userId);
        const existing = (dbUsers?.data ?? dbUsers ?? []).find(
            (u: any) => (u.username ?? u.db_user_name)?.toLowerCase() === username.toLowerCase()
        );
        if (existing) {
            return { alreadyExists: true, existing };
        }
    } catch (err) {
        console.warn('[idempotency] Failed to list DB users for pre-check:', err);
    }
    return { alreadyExists: false };
}

/**
 * Check if an email account already exists before creating one.
 */
export async function checkEmailExists(
    websiteId: string,
    serverId: string,
    userId: string,
    emailAddress: string,
): Promise<ListBeforeActResult> {
    try {
        const client = getCloudstickClient();
        const emails: any = await client.listEmailAccounts(websiteId, serverId, userId);
        const existing = (emails?.data ?? emails ?? []).find(
            (e: any) => e.email?.toLowerCase() === emailAddress.toLowerCase()
        );
        if (existing) {
            return { alreadyExists: true, existing };
        }
    } catch (err) {
        console.warn('[idempotency] Failed to list emails for pre-check:', err);
    }
    return { alreadyExists: false };
}

/**
 * Check if a team already exists before creating one.
 */
export async function checkTeamExists(
    userId: string,
    teamName: string,
): Promise<ListBeforeActResult> {
    try {
        const client = getCloudstickClient();
        const teams: any = await client.listTeams(userId);
        const existing = (teams?.data ?? teams ?? []).find(
            (t: any) => t.name?.toLowerCase() === teamName.toLowerCase()
        );
        if (existing) {
            return { alreadyExists: true, existing };
        }
    } catch (err) {
        console.warn('[idempotency] Failed to list teams for pre-check:', err);
    }
    return { alreadyExists: false };
}

export { getCachedResult, setCachedResult };
