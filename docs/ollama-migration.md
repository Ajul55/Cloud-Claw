# Switching from Voyage AI to Ollama (nomic-embed-text)

**Server**: Ubuntu 24 VPS  
**Goal**: Replace Voyage AI embeddings with free local Ollama embeddings  
**Files changed**: `src/utils/embeddings.ts`, `src/database/schema.sql`, DB migration  
**Downtime**: ~2 minutes (PM2 restart)

---

## Why this works

Your embedding code is isolated in one file (`src/utils/embeddings.ts`). Everything else
(`fix_memory.ts`, the DB, pgvector) stays exactly the same. The only real difference:

| | Voyage AI | Ollama nomic-embed-text |
|---|---|---|
| Cost | Monthly subscription | Free forever |
| Dimensions | 1536 | 768 |
| Location | External API | Runs on your VPS |
| Speed | ~200ms (network) | ~50ms (local) |

The dimension change (1536 → 768) means the DB column must be recreated. Existing fix_memory
rows with old vectors will be cleared — they are incompatible. New rows will use 768-dim vectors.

---

## Step 1 — Install Ollama on your VPS

SSH into your server, then run:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

This installs Ollama as a systemd service. Verify it started:

```bash
systemctl status ollama
```

You should see `active (running)`. If not:

```bash
sudo systemctl enable --now ollama
```

---

## Step 2 — Pull the embedding model

```bash
ollama pull nomic-embed-text
```

This downloads ~274MB. Wait for it to finish. Verify:

```bash
ollama list
```

You should see `nomic-embed-text` in the list.

---

## Step 3 — Quick sanity check

Test that Ollama is producing embeddings correctly:

```bash
curl http://localhost:11434/api/embeddings \
  -d '{"model":"nomic-embed-text","prompt":"nginx is down"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Dims:', len(d['embedding']))"
```

Expected output: `Dims: 768`

If you see that, Ollama is working correctly.

---

## Step 4 — Update the embeddings.ts file

Navigate to your project:

```bash
cd /home/ajul/cloud-claw/Cloud-Claw
```

Replace the entire contents of `src/utils/embeddings.ts`:

```bash
cat > src/utils/embeddings.ts << 'EOF'
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
EOF
```

---

## Step 5 — Update the DB schema file

Update the dimension in `src/database/schema.sql`:

```bash
sed -i 's/vector(1536)/vector(768)/g' src/database/schema.sql
```

Verify the change:

```bash
grep "vector(" src/database/schema.sql
```

Should show `vector(768)`.

---

## Step 6 — Migrate the database column

> This clears any existing fix_memory rows (they used 1536-dim vectors, incompatible with 768).
> If your fix_memory table is empty or new, this is a no-op.

Connect to PostgreSQL:

```bash
psql $DATABASE_URL
```

Run these commands inside psql:

```sql
-- Drop old index (required before altering column)
DROP INDEX IF EXISTS idx_fix_memory_embedding;

-- Change column dimension from 1536 to 768
-- (pgvector requires drop+add for dimension changes)
ALTER TABLE fix_memory DROP COLUMN IF EXISTS embedding;
ALTER TABLE fix_memory ADD COLUMN embedding vector(768);

-- Recreate the index
CREATE INDEX IF NOT EXISTS idx_fix_memory_embedding
  ON fix_memory USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Confirm
\d fix_memory
```

You should see `embedding | vector(768)`. Type `\q` to exit.

---

## Step 7 — Remove VOYAGE_API_KEY from .env

Open your `.env` file:

```bash
nano .env
```

Remove or comment out these lines:

```
# VOYAGE_API_KEY=...      ← delete or comment this out
# VOYAGE_MODEL=...        ← delete or comment this out
```

Optionally add Ollama config (only needed if Ollama runs on a different host or port):

```
# OLLAMA_URL=http://localhost:11434     ← only add if non-default
# OLLAMA_EMBED_MODEL=nomic-embed-text   ← only add if you want a different model
```

Save and close.

---

## Step 8 — Rebuild and restart

```bash
# Rebuild TypeScript
npm run build

# Restart via PM2
pm2 restart all

# Watch logs for errors
pm2 logs --lines 30
```

Look for these lines in the logs (good signs):

```
[fix_memory] Saved fix #1 — class: nginx
[embeddings] vector dims: 768
```

No errors about Voyage API key missing = success.

---

## Step 9 — End-to-end test

Send a test message through Slack or Telegram that triggers a diagnostic. After the session
completes, check that a fix was stored:

```bash
psql $DATABASE_URL -c "SELECT id, issue_text, problem_class, array_length(embedding::real[], 1) as dims FROM fix_memory ORDER BY created_at DESC LIMIT 5;"
```

Expected output: `dims = 768` for new rows.

---

## Troubleshooting

**Ollama not responding:**
```bash
sudo systemctl restart ollama
curl http://localhost:11434/api/tags   # should return JSON
```

**Wrong dimensions error in logs:**
```bash
ollama list   # confirm nomic-embed-text is listed
ollama pull nomic-embed-text   # re-pull if missing
```

**pgvector dimension mismatch error in PostgreSQL:**
```
ERROR: expected 768 dimensions, not 1536
```
This means Step 6 wasn't run. Go back and run the SQL migration.

**Build errors after editing embeddings.ts:**

The old `isEmbeddingAvailable()` was synchronous (`boolean`), the new one is async (`Promise<boolean>`).
If any file calls it synchronously, update to use `await`:

```bash
grep -r "isEmbeddingAvailable" src/
```

For each match, ensure it uses `await isEmbeddingAvailable()`.

---

## Rollback (if needed)

To go back to Voyage AI:

1. Restore `src/utils/embeddings.ts` from git: `git checkout src/utils/embeddings.ts`
2. Run the DB migration in reverse (768 → 1536)
3. Re-add `VOYAGE_API_KEY` to `.env`
4. `npm run build && pm2 restart all`

---

## Summary of what changed

| File | What changed |
|------|-------------|
| `src/utils/embeddings.ts` | Replaced Voyage HTTP call with Ollama HTTP call. Dimension 1536→768. |
| `src/database/schema.sql` | `vector(1536)` → `vector(768)` |
| PostgreSQL | `embedding` column recreated at 768 dims, index rebuilt |
| `.env` | Removed `VOYAGE_API_KEY`, optionally added `OLLAMA_URL` |
| Everything else | Unchanged |
