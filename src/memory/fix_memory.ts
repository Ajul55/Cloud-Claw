import { env } from '../config/env.js';
import { getPool, isDBConfigured } from '../database/db.js';
import OpenAI from 'openai';
import type { Tool, ToolResult } from '../tools/types.js';

// Since some providers (Groq/Anthropic) don't have text-embedding-3-small,
// we default to the standard OpenAI client or OPENAI_API_KEY for vector embeddings.
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || env.LLM_API_KEY
});

export async function saveFix(issueText: string, fixCommand: string): Promise<void> {
    if (!isDBConfigured()) return;

    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: issueText,
        });

        const embedding = response.data[0].embedding;
        const pool = getPool();

        await pool.query(
            `INSERT INTO fix_memory (issue_text, fix_command, embedding) 
             VALUES ($1, $2, $3::vector)`,
            [issueText, fixCommand, `[${embedding.join(',')}]`]
        );
        console.log(`[FixMemory] Stored fix memory for: ${issueText.slice(0, 50)}...`);
    } catch (err) {
        console.error('[FixMemory] Failed to save fix memory vector:', err);
    }
}

export const fixMemorySearchTool: Tool = {
    name: 'search_fix_memory',
    description: 'Searches the pgvector database for past problems and their applied fixes using semantic similarity. Use this first when diagnosing a new issue to see what commands were previously approved.',
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
        if (!isDBConfigured()) {
            return { success: false, output: 'Database not configured; cannot search fix memory.' };
        }

        const issue = args.issue as string;
        if (!issue) return { success: false, output: 'Missing "issue" parameter.' };

        try {
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: issue,
            });

            const embedding = response.data[0].embedding;
            const pool = getPool();

            const { rows } = await pool.query(
                `SELECT issue_text, fix_command, 1 - (embedding <=> $1::vector) as similarity
                 FROM fix_memory
                 ORDER BY embedding <=> $1::vector
                 LIMIT 3`,
                [`[${embedding.join(',')}]`]
            );

            if (rows.length === 0) {
                return { success: true, output: 'No similar past fixes found in memory.' };
            }

            let output = 'Found similar past fixes:\n';
            rows.forEach((row, i) => {
                const score = (row.similarity * 100).toFixed(1);
                output += `\n${i + 1}. Match: ${score}%\nProblem: ${row.issue_text}\nFix Command:\n\`\`\`\n${row.fix_command}\n\`\`\`\n`;
            });

            return { success: true, output };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Search failed: ${msg}` };
        }
    }
};
