/**
 * Dynamic Tool Registry (ARCH-5)
 *
 * Provides per-tenant tool enable/disable overrides sourced from the `tools`
 * PostgreSQL table. Results are cached in-process for 60 seconds.
 * Gracefully degrades to an empty set (all tools enabled) when the DB is
 * unavailable or not configured.
 */

import { isDBConfigured, getPool } from '../database/db.js';

interface CacheEntry {
    disabledTools: Set<string>;
    expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/**
 * Returns the set of tool names that are disabled for the given tenant.
 * A tool is disabled if a row in `tools` has `enabled = false` and either:
 *   - `tenant_id IS NULL`  (global override), or
 *   - `tenant_id = tenantId` (tenant-specific override).
 */
export async function getDynamicToolOverrides(tenantId?: string): Promise<Set<string>> {
    const cacheKey = tenantId ?? '__global__';
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.disabledTools;

    if (!isDBConfigured()) return new Set();

    try {
        const pool = getPool();
        const { rows } = await pool.query<{ name: string }>(
            `SELECT name FROM tools
             WHERE enabled = false
               AND (tenant_id IS NULL OR tenant_id = $1)`,
            [tenantId ?? null],
        );
        const disabledTools = new Set(rows.map(r => r.name));
        _cache.set(cacheKey, { disabledTools, expiresAt: Date.now() + CACHE_TTL_MS });
        return disabledTools;
    } catch {
        return new Set();
    }
}
