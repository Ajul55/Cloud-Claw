/**
 * Voyage AI Embedding Utility
 *
 * Standalone embedding helper for semantic search in fix_memory.
 * Uses Voyage AI voyage-code-2 model (1536 dimensions).
 * Can be swapped to another provider by changing this single file.
 */

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? 'voyage-code-2';
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

/**
 * Generate a 1536-dimension embedding vector for the given text.
 * Returns null if API key is missing or the API call fails.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
    if (!VOYAGE_API_KEY) {
        console.warn('[embeddings] VOYAGE_API_KEY not set — skipping embedding');
        return null;
    }
    try {
        const response = await fetch(VOYAGE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VOYAGE_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                input: [text.slice(0, 2000)],
                model: VOYAGE_MODEL,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[embeddings] Voyage API error:', response.status, err);
            return null;
        }

        const data = await response.json() as {
            data?: Array<{ embedding?: number[] }>;
        };
        const vector = data.data?.[0]?.embedding;
        if (!Array.isArray(vector) || vector.length !== 1536) {
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
 * Check if the Voyage embedding API is configured.
 */
export function isEmbeddingAvailable(): boolean {
    return Boolean(VOYAGE_API_KEY);
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
