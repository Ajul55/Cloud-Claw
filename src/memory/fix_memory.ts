/**
 * Fix Memory — Semantic vector search system
 *
 * Stores past problems and solutions so the LLM can reference them
 * for future similar issues. Uses Voyage AI embeddings + pgvector
 * for semantic similarity search (1536 dimensions).
 *
 * Works in two modes:
 *   1. In-memory Map (always active)
 *   2. PostgreSQL + pgvector (when DATABASE_URL is configured)
 *
 * Graceful degradation: if Voyage API is unavailable, falls back
 * to exact-match or most-recent results.
 */

import { getPool, isDBConfigured } from '../database/db.js';
import {
    generateEmbedding,
    cosineSimilarity,
    vectorToSQL,
} from '../utils/embeddings.js';
import type { Tool, ToolResult } from '../tools/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FixRecord {
    id: number;
    issueText: string;
    fixCommand: string;
    problemClass: string;
    embedding: number[] | null;
    createdAt: Date;
}

// ─── In-memory store (always active, DB mirrors it when connected) ────────────

const memoryFixes = new Map<number, FixRecord>();
let memoryIdCounter = 1;

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Check if this fix is a duplicate of an existing record.
 * Uses cosine similarity > 0.95 via pgvector or in-memory vectors.
 * Falls back to exact fixCommand match if no embeddings available.
 */
export async function isDuplicate(
    issueText: string,
    fixCommand: string,
): Promise<boolean> {
    if (memoryFixes.size === 0 && !isDBConfigured()) return false;

    const combinedText = `${issueText} ${fixCommand}`.trim();
    const queryEmbedding = await generateEmbedding(combinedText);

    // DB path — pgvector cosine similarity
    if (isDBConfigured() && queryEmbedding) {
        try {
            const result = await getPool().query(
                `SELECT 1 FROM fix_memory
                 WHERE embedding IS NOT NULL
                 AND 1 - (embedding <=> $1::vector) > 0.95
                 LIMIT 1`,
                [vectorToSQL(queryEmbedding)],
            );
            if ((result.rowCount ?? 0) > 0) return true;
        } catch (err) {
            console.warn('[fix_memory] isDuplicate DB check failed, using memory:', err);
        }
    }

    // In-memory path — cosine similarity
    if (queryEmbedding) {
        for (const fix of memoryFixes.values()) {
            if (!fix.embedding) continue;
            if (cosineSimilarity(queryEmbedding, fix.embedding) > 0.95) return true;
        }
        return false;
    }

    // No embedding available — exact fixCommand match fallback
    for (const fix of memoryFixes.values()) {
        if (fix.fixCommand.trim() === fixCommand.trim()) return true;
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
        if (await isDuplicate(issueText, fixCommand)) {
            console.log('[fix_memory] Duplicate skipped');
            return;
        }

        const combinedText = `${issueText} ${fixCommand}`.trim();
        const embedding = await generateEmbedding(combinedText);

        const id = memoryIdCounter++;
        const record: FixRecord = {
            id,
            issueText: issueText.slice(0, 500),
            fixCommand: fixCommand.slice(0, 500),
            problemClass,
            embedding,
            createdAt: new Date(),
        };
        memoryFixes.set(id, record);

        // Mirror to PostgreSQL
        if (isDBConfigured()) {
            try {
                if (embedding) {
                    await getPool().query(
                        `INSERT INTO fix_memory
                         (issue_text, fix_command, problem_class, embedding, created_at)
                         VALUES ($1, $2, $3, $4::vector, NOW())`,
                        [
                            record.issueText,
                            record.fixCommand,
                            record.problemClass,
                            vectorToSQL(embedding),
                        ],
                    );
                } else {
                    await getPool().query(
                        `INSERT INTO fix_memory
                         (issue_text, fix_command, problem_class, created_at)
                         VALUES ($1, $2, $3, NOW())`,
                        [
                            record.issueText,
                            record.fixCommand,
                            record.problemClass,
                        ],
                    );
                }
            } catch (err) {
                console.warn('[fix_memory] DB insert failed (non-fatal):', err);
            }
        }

        console.log(`[fix_memory] Saved fix #${id} — class: ${problemClass}`);
    } catch (err) {
        console.warn('[fix_memory] saveFix failed (non-fatal):', err);
    }
}

/**
 * Search for fixes similar to the query using semantic vector search.
 * Returns top 3 with cosine similarity > 0.5.
 * Falls back to most-recent if no embeddings available.
 */
export async function searchFixes(query: string): Promise<FixRecord[]> {
    const queryEmbedding = await generateEmbedding(query);

    // DB path — pgvector nearest neighbor
    if (isDBConfigured() && queryEmbedding) {
        try {
            // Use native distance operator (<=> < threshold) so the pgvector
            // HNSW/IVFFlat index can be used. Cosine similarity > 0.5 ≡ distance < 0.5.
            const result = await getPool().query(
                `SELECT id,
                        issue_text    AS "issueText",
                        fix_command   AS "fixCommand",
                        problem_class AS "problemClass",
                        created_at    AS "createdAt"
                 FROM fix_memory
                 WHERE embedding IS NOT NULL
                   AND embedding <=> $1::vector < 0.5
                 ORDER BY embedding <=> $1::vector
                 LIMIT 3`,
                [vectorToSQL(queryEmbedding)],
            );
            return result.rows.map((row: Record<string, unknown>) => ({
                id: row.id as number,
                issueText: row.issueText as string,
                fixCommand: row.fixCommand as string,
                problemClass: row.problemClass as string,
                embedding: null,
                createdAt: new Date(row.createdAt as string),
            }));
        } catch (err) {
            console.warn('[fix_memory] searchFixes DB failed, using memory:', err);
        }
    }

    // In-memory path — cosine similarity
    if (queryEmbedding && memoryFixes.size > 0) {
        const scored = [...memoryFixes.values()]
            .filter(f => f.embedding !== null)
            .map(f => ({
                fix: f,
                score: cosineSimilarity(queryEmbedding, f.embedding!),
            }))
            .filter(({ score }) => score > 0.5)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
        return scored.map(({ fix }) => fix);
    }

    // No embedding available — return 3 most recent as best effort
    return [...memoryFixes.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 3);
}

/**
 * Get the N most recent fixes, sorted by creation date descending.
 */
export async function getRecentFixes(n: number): Promise<FixRecord[]> {
    if (isDBConfigured()) {
        try {
            const result = await getPool().query(
                `SELECT id,
                        issue_text    AS "issueText",
                        fix_command   AS "fixCommand",
                        problem_class AS "problemClass",
                        created_at    AS "createdAt"
                 FROM fix_memory
                 ORDER BY created_at DESC
                 LIMIT $1`,
                [n],
            );
            return result.rows.map((row: Record<string, unknown>) => ({
                id: row.id as number,
                issueText: row.issueText as string,
                fixCommand: row.fixCommand as string,
                problemClass: row.problemClass as string,
                embedding: null,
                createdAt: new Date(row.createdAt as string),
            }));
        } catch (err) {
            console.warn('[fix_memory] getRecentFixes DB failed:', err);
        }
    }
    return [...memoryFixes.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, n);
}

/**
 * Format fix records for injection into the system prompt.
 */
export function formatFixesForPrompt(fixes: FixRecord[]): string {
    if (fixes.length === 0) return '';
    return fixes
        .map(f =>
            `- [${f.problemClass}] ${f.issueText.slice(0, 80)} → ${f.fixCommand.slice(0, 120)}`
        )
        .join('\n');
}

// ─── Tool registration ────────────────────────────────────────────────────────

export const fixMemorySearchTool: Tool = {
    name: 'search_fix_memory',
    description:
        'Searches past problems and their applied fixes using semantic similarity. '
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
