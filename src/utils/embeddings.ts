/**
 * Ollama Embedding Utility
 *
 * Standalone embedding helper for semantic search in fix_memory.
 * Uses Ollama nomic-embed-text model (768 dimensions) — runs locally, free.
 * Can be swapped to another provider by changing this single file.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

/**
 * Generate a 768-dimension embedding vector for the given text.
 * Returns null if Ollama is unreachable or the call fails.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt: text.slice(0, 2000),
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[embeddings] Ollama error:', response.status, err);
            return null;
        }

        const data = await response.json() as { embedding?: number[] };
        const vector = data.embedding;
        if (!Array.isArray(vector) || vector.length !== 768) {
            console.error('[embeddings] Unexpected vector dimensions:', vector?.length);
            return null;
        }
        return vector;
    } catch (err) {
        console.error('[embeddings] generateEmbedding threw:', err);
        return null;
    }
}

/**
 * Check if the Ollama embedding service is reachable.
 */
export async function isEmbeddingAvailable(): Promise<boolean> {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Compute cosine similarity between two vectors (0.0 to 1.0).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Convert a number[] vector to pgvector SQL string format: '[0.1,0.2,...]'
 */
export function vectorToSQL(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
}
