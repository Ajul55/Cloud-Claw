/**
 * Fix Memory — Keyword-based recall system
 *
 * Stores past problems and solutions so the LLM can reference them
 * for future similar issues. Uses keyword-based search (no OpenAI embeddings).
 *
 * Works in two modes:
 *   1. In-memory Map (always active)
 *   2. PostgreSQL (when DATABASE_URL is configured) — mirrors the in-memory store
 */

import { getPool, isDBConfigured } from '../database/db.js';
import type { Tool, ToolResult } from '../tools/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FixRecord {
    id: number;
    issueText: string;
    fixCommand: string;
    problemClass: string;
    keywords: string;       // space-separated keyword tokens
    createdAt: Date;
}

// ─── In-memory store (always active, DB mirrors it when connected) ────────────

const memoryFixes = new Map<number, FixRecord>();
let memoryIdCounter = 1;

// ─── Stop words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'was', 'it', 'to', 'of', 'and', 'or',
    'in', 'on', 'at', 'for', 'with', 'this', 'that', 'are', 'be',
    'has', 'have', 'had', 'do', 'did', 'not', 'but',
]);

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Extract searchable keywords from text.
 * Lowercases, removes punctuation, filters stop words and short words.
 */
export function extractKeywords(text: string): string {
    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    // Deduplicate and limit to 50 keywords
    const unique = [...new Set(words)].slice(0, 50);
    return unique.join(' ');
}

/**
 * Score a candidate fix against a query using keyword overlap.
 * Returns 0.0 to 1.0 (fraction of query keywords found in candidate).
 */
export function keywordScore(query: string, candidate: FixRecord): number {
    const queryKw = extractKeywords(query).split(' ').filter(Boolean);
    if (queryKw.length === 0) return 0;

    const candidateKwSet = new Set(candidate.keywords.split(' '));
    let matches = 0;
    for (const kw of queryKw) {
        if (candidateKwSet.has(kw)) matches++;
    }
    return matches / queryKw.length;
}

/**
 * Calculate character-level similarity between two strings (0.0 to 1.0).
 */
function charSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length < b.length ? a : b;
    if (longer.length === 0) return 1.0;

    // Simple: count how many characters of shorter appear in longer
    let matches = 0;
    const used = new Set<number>();
    for (const ch of shorter) {
        for (let i = 0; i < longer.length; i++) {
            if (!used.has(i) && longer[i] === ch) {
                matches++;
                used.add(i);
                break;
            }
        }
    }
    return matches / longer.length;
}

/**
 * Check if this fix is a duplicate of an existing record.
 * Returns true if keyword overlap > 0.8 AND command is > 70% char-similar.
 */
export async function isDuplicate(
    issueText: string,
    fixCommand: string,
): Promise<boolean> {
    if (memoryFixes.size === 0) return false;

    const queryKw = extractKeywords(issueText + ' ' + fixCommand);
    const tempRecord: FixRecord = {
        id: -1,
        issueText,
        fixCommand,
        problemClass: '',
        keywords: queryKw,
        createdAt: new Date(),
    };

    for (const existing of memoryFixes.values()) {
        const kwOverlap = keywordScore(
            issueText + ' ' + fixCommand,
            existing,
        );
        if (kwOverlap > 0.8) {
            const cmdSim = charSimilarity(
                fixCommand.toLowerCase(),
                existing.fixCommand.toLowerCase(),
            );
            if (cmdSim > 0.7) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Save a fix to memory (in-memory + DB when available).
 * Checks for duplicates first. Non-fatal — never throws.
 */
export async function saveFix(
    issueText: string,
    fixCommand: string,
    problemClass: string,
): Promise<void> {
    try {
        // Deduplication check
        if (await isDuplicate(issueText, fixCommand)) {
            console.log(`[fix_memory] Duplicate detected, skipping save — class: ${problemClass}`);
            return;
        }

        const keywords = extractKeywords(issueText + ' ' + fixCommand);
        const id = memoryIdCounter++;
        const record: FixRecord = {
            id,
            issueText,
            fixCommand,
            problemClass,
            keywords,
            createdAt: new Date(),
        };

        // Always save to in-memory store
        memoryFixes.set(id, record);
        console.log(`[fix_memory] Saved fix #${id} — class: ${problemClass}`);

        // Mirror to DB if configured
        if (isDBConfigured()) {
            try {
                const pool = getPool();
                const result = await pool.query(
                    `INSERT INTO fix_memory (issue_text, fix_command, problem_class, keywords)
                     VALUES ($1, $2, $3, $4) RETURNING id`,
                    [issueText, fixCommand, problemClass, keywords],
                );
                // Update in-memory record with DB-assigned id
                const dbId = result.rows[0]?.id;
                if (dbId) {
                    memoryFixes.delete(id);
                    record.id = dbId;
                    memoryFixes.set(dbId, record);
                }
            } catch (dbErr) {
                console.warn('[fix_memory] DB insert failed (in-memory copy kept):', dbErr);
            }
        }
    } catch (err) {
        console.error('[fix_memory] saveFix error (non-fatal):', err);
    }
}

/**
 * Get the N most recent fixes, sorted by creation date descending.
 */
export async function getRecentFixes(n: number): Promise<FixRecord[]> {
    // Try DB first if configured
    if (isDBConfigured()) {
        try {
            const pool = getPool();
            const { rows } = await pool.query(
                `SELECT id, issue_text, fix_command, problem_class, keywords, created_at
                 FROM fix_memory ORDER BY created_at DESC LIMIT $1`,
                [n],
            );
            return rows.map(r => ({
                id: r.id,
                issueText: r.issue_text,
                fixCommand: r.fix_command,
                problemClass: r.problem_class ?? '',
                keywords: r.keywords ?? '',
                createdAt: new Date(r.created_at),
            }));
        } catch (err) {
            console.warn('[fix_memory] DB getRecentFixes failed, using in-memory:', err);
        }
    }

    // In-memory fallback
    return [...memoryFixes.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, n);
}

/**
 * Search for fixes similar to the query. Returns top 3 with score > 0.3.
 */
export async function searchFixes(query: string): Promise<FixRecord[]> {
    // Try DB full-text search if configured
    if (isDBConfigured()) {
        try {
            const pool = getPool();
            const { rows } = await pool.query(
                `SELECT id, issue_text, fix_command, problem_class, keywords, created_at
                 FROM fix_memory
                 WHERE to_tsvector('english', keywords) @@ plainto_tsquery('english', $1)
                 ORDER BY created_at DESC LIMIT 3`,
                [query],
            );
            if (rows.length > 0) {
                return rows.map(r => ({
                    id: r.id,
                    issueText: r.issue_text,
                    fixCommand: r.fix_command,
                    problemClass: r.problem_class ?? '',
                    keywords: r.keywords ?? '',
                    createdAt: new Date(r.created_at),
                }));
            }
        } catch (err) {
            console.warn('[fix_memory] DB search failed, using in-memory:', err);
        }
    }

    // In-memory keyword search
    const scored = [...memoryFixes.values()]
        .map(record => ({ record, score: keywordScore(query, record) }))
        .filter(x => x.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    return scored.map(x => x.record);
}

/**
 * Format fix records for injection into the system prompt.
 */
export function formatFixesForPrompt(fixes: FixRecord[]): string {
    return fixes
        .map(f => {
            const issue = f.issueText.slice(0, 80);
            const cmd = f.fixCommand.slice(0, 120);
            return `- [${f.problemClass}] ${issue} → ${cmd}`;
        })
        .join('\n');
}

// ─── Tool registration ────────────────────────────────────────────────────────

export const fixMemorySearchTool: Tool = {
    name: 'search_fix_memory',
    description:
        'Searches past problems and their applied fixes using keyword similarity. '
        + 'Use this when diagnosing a new issue to see what was previously approved.',
    parameters: {
        type: 'object',
        properties: {
            issue: {
                type: 'string',
                description: 'A description of the problem or error message you want to look up.',
            },
        },
        required: ['issue'],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const issue = args.issue as string;
        if (!issue) return { success: false, output: 'Missing "issue" parameter.' };

        try {
            const results = await searchFixes(issue);

            if (results.length === 0) {
                return { success: true, output: 'No similar past fixes found in memory.' };
            }

            let output = 'Found similar past fixes:\n';
            results.forEach((row, i) => {
                output += `\n${i + 1}. [${row.problemClass}]\n`
                    + `   Problem: ${row.issueText.slice(0, 200)}\n`
                    + `   Fix: ${row.fixCommand.slice(0, 200)}\n`;
            });

            return { success: true, output };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Search failed: ${msg}` };
        }
    },
};
