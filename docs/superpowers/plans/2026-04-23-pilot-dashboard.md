# Pilot Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only analytics dashboard served at `http://<host>:9000/dashboard` that shows token usage, cost, top tools, lane split, and recent sessions.

**Architecture:** Vite + React + TypeScript frontend in `dashboard/` builds static files to `dist/public/`; the existing Node health server at `src/health.ts` is refactored to delegate non-`/health` routes to a new `src/dashboard/server.ts` which also handles `GET /api/stats`. No new runtime dependencies on the backend — raw `http` module throughout.

**Tech Stack:** React 18, Vite 5, TypeScript, react-chartjs-2 + chart.js, Vitest + @testing-library/react (frontend), Vitest (backend)

---

## File Map

**Backend (new):**
- `src/dashboard/queries.ts` — all PostgreSQL aggregation queries, returns typed objects
- `src/dashboard/queries.test.ts` — unit tests with mocked pg Pool
- `src/dashboard/server.ts` — HTTP route handler: `/dashboard`, `/dashboard/assets/*`, `/api/stats`
- `src/dashboard/server.test.ts` — unit tests with mocked queries module

**Backend (modified):**
- `src/health.ts` — add delegation to `handleDashboardRequest()` for non-`/health` routes

**Frontend (new `dashboard/` project):**
- `dashboard/package.json`
- `dashboard/vite.config.ts`
- `dashboard/tsconfig.json`
- `dashboard/index.html`
- `dashboard/src/types.ts` — `StatsResponse` and sub-types
- `dashboard/src/hooks/useStats.ts` — polling fetch hook
- `dashboard/src/hooks/useStats.test.ts`
- `dashboard/src/components/StatCard.tsx`
- `dashboard/src/components/StatCard.test.tsx`
- `dashboard/src/components/Sidebar.tsx`
- `dashboard/src/components/Sidebar.test.tsx`
- `dashboard/src/components/BurnRateChart.tsx`
- `dashboard/src/components/BurnRateChart.test.tsx`
- `dashboard/src/components/TopToolsChart.tsx`
- `dashboard/src/components/TopToolsChart.test.tsx`
- `dashboard/src/components/LaneSplitChart.tsx`
- `dashboard/src/components/LaneSplitChart.test.tsx`
- `dashboard/src/components/SessionsTable.tsx`
- `dashboard/src/components/SessionsTable.test.tsx`
- `dashboard/src/App.tsx`
- `dashboard/src/main.tsx`

---

## Task 1: Backend — queries.ts with types and SQL

**Files:**
- Create: `src/dashboard/queries.ts`
- Create: `src/dashboard/queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/dashboard/queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

// Mock pg pool before importing queries
const mockQuery = vi.fn();
vi.mock('../database/db.js', () => ({
  getPool: () => ({ query: mockQuery } as unknown as Pool),
  isDBConfigured: () => true,
}));

import { fetchStats } from './queries.js';

const INTERVAL = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' } as const;

describe('fetchStats', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('returns zero totals when usage_log is empty', async () => {
    // totals query
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens: '0', cost_usd: '0', llm_calls: '0' }] });
    // pending hitl
    mockQuery.mockResolvedValueOnce({ rows: [{ pending_hitl: '0' }] });
    // burn rate
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // top tools
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // lane split
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // recent sessions
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await fetchStats('24h');
    expect(result.totals.tokens).toBe(0);
    expect(result.totals.costUsd).toBe(0);
    expect(result.totals.llmCalls).toBe(0);
    expect(result.totals.pendingHitl).toBe(0);
    expect(result.burnRate).toEqual([]);
    expect(result.topTools).toEqual([]);
    expect(result.laneSplit).toEqual([]);
    expect(result.recentSessions).toEqual([]);
  });

  it('maps burn rate rows to bucket + tokens', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens: '0', cost_usd: '0', llm_calls: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ pending_hitl: '0' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-04-23T10:00:00.000Z', tokens: '4200' },
        { bucket: '2026-04-23T11:00:00.000Z', tokens: '8100' },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await fetchStats('24h');
    expect(result.burnRate).toEqual([
      { bucket: '2026-04-23T10:00:00.000Z', tokens: 4200 },
      { bucket: '2026-04-23T11:00:00.000Z', tokens: 8100 },
    ]);
  });

  it('maps top tools rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens: '100', cost_usd: '0.01', llm_calls: '2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ pending_hitl: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { tool_name: 'execute_ssh_command', count: '42' },
        { tool_name: 'diagnose_nginx', count: '21' },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await fetchStats('24h');
    expect(result.topTools).toEqual([
      { toolName: 'execute_ssh_command', count: 42 },
      { toolName: 'diagnose_nginx', count: 21 },
    ]);
  });

  it('maps lane split rows with labels', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens: '0', cost_usd: '0', llm_calls: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ pending_hitl: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { lane: 1, count: '55' },
        { lane: 2, count: '28' },
        { lane: 3, count: '17' },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await fetchStats('24h');
    expect(result.laneSplit).toEqual([
      { lane: 1, label: 'API', count: 55 },
      { lane: 2, label: 'SSH Read', count: 28 },
      { lane: 3, label: 'SSH Write', count: 17 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx vitest run src/dashboard/queries.test.ts
```
Expected: fails with "Cannot find module './queries.js'"

- [ ] **Step 3: Implement `src/dashboard/queries.ts`**

```ts
import { getPool, isDBConfigured } from '../database/db.js';

export type Range = '24h' | '7d' | '30d';

export interface StatsResult {
  range: Range;
  totals: { tokens: number; costUsd: number; llmCalls: number; pendingHitl: number };
  burnRate: { bucket: string; tokens: number }[];
  topTools: { toolName: string; count: number }[];
  laneSplit: { lane: 1 | 2 | 3; label: 'API' | 'SSH Read' | 'SSH Write'; count: number }[];
  recentSessions: {
    sessionId: string;
    platform: 'slack' | 'telegram';
    tokensTotal: number;
    costUsd: number;
    toolCount: number;
    topLane: 1 | 2 | 3;
    createdAt: string;
  }[];
}

const RANGE_INTERVAL: Record<Range, string> = {
  '24h': '24 hours',
  '7d':  '7 days',
  '30d': '30 days',
};

const LANE1_TOOLS = [
  'create_system_user','delete_system_user','change_system_user_password',
  'create_database_user','delete_database_user','change_database_user_password',
  'create_database','delete_database','issue_ssl','renew_ssl_api','delete_ssl',
  'update_ssl_settings','switch_php_api',
];

const LANE3_TOOLS = [
  'execute_ssh_write','fix_nginx_config','fix_wordpress','renew_ssl',
  'manage_php','repair_mysql','cleanup_disk','create_nginx_vhost',
  'cloudflare_cache_purge','emergency_service_restart',
];

function laneCase(): string {
  const l1 = LANE1_TOOLS.map(t => `'${t}'`).join(',');
  const l3 = LANE3_TOOLS.map(t => `'${t}'`).join(',');
  return `CASE WHEN tool_name IN (${l1}) THEN 1 WHEN tool_name IN (${l3}) THEN 3 ELSE 2 END`;
}

const LANE_LABELS: Record<number, 'API' | 'SSH Read' | 'SSH Write'> = {
  1: 'API',
  2: 'SSH Read',
  3: 'SSH Write',
};

export async function fetchStats(range: Range): Promise<StatsResult> {
  const pool = getPool();
  const interval = RANGE_INTERVAL[range];
  const bucket = range === '24h' ? 'hour' : 'day';

  const [totalsRes, hitlRes, burnRes, toolsRes, laneRes, sessionsRes] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
         COALESCE(SUM(cost_usd), 0)               AS cost_usd,
         COUNT(*)                                  AS llm_calls
       FROM usage_log
       WHERE created_at >= NOW() - $1::interval`,
      [interval],
    ),
    pool.query(
      `SELECT COUNT(*) AS pending_hitl FROM approval_queue WHERE status = 'pending'`,
    ),
    pool.query(
      `SELECT date_trunc($1, created_at) AS bucket,
              SUM(tokens_in + tokens_out) AS tokens
       FROM usage_log
       WHERE created_at >= NOW() - $2::interval
       GROUP BY bucket
       ORDER BY bucket`,
      [bucket, interval],
    ),
    pool.query(
      `SELECT tool_name, COUNT(*) AS count
       FROM usage_log
       WHERE created_at >= NOW() - $1::interval
         AND tool_name IS NOT NULL
       GROUP BY tool_name
       ORDER BY count DESC
       LIMIT 10`,
      [interval],
    ),
    pool.query(
      `SELECT ${laneCase()} AS lane, COUNT(*) AS count
       FROM usage_log
       WHERE created_at >= NOW() - $1::interval
         AND tool_name IS NOT NULL
       GROUP BY lane
       ORDER BY lane`,
      [interval],
    ),
    pool.query(
      `WITH session_stats AS (
         SELECT session_id,
                SPLIT_PART(session_id, ':', 1) AS platform,
                SUM(tokens_in + tokens_out)    AS tokens_total,
                SUM(cost_usd)                  AS cost_usd,
                COUNT(CASE WHEN tool_name IS NOT NULL THEN 1 END) AS tool_count,
                MAX(created_at)                AS created_at
         FROM usage_log
         WHERE created_at >= NOW() - $1::interval
         GROUP BY session_id
       ),
       session_lanes AS (
         SELECT session_id, ${laneCase()} AS lane, COUNT(*) AS cnt
         FROM usage_log
         WHERE created_at >= NOW() - $1::interval AND tool_name IS NOT NULL
         GROUP BY session_id, lane
       ),
       top_lanes AS (
         SELECT DISTINCT ON (session_id) session_id, lane AS top_lane
         FROM session_lanes
         ORDER BY session_id, cnt DESC
       )
       SELECT s.session_id, s.platform, s.tokens_total, s.cost_usd,
              s.tool_count, s.created_at, COALESCE(l.top_lane, 2) AS top_lane
       FROM session_stats s
       LEFT JOIN top_lanes l ON l.session_id = s.session_id
       ORDER BY s.created_at DESC
       LIMIT 10`,
      [interval],
    ),
  ]);

  const t = totalsRes.rows[0];
  const h = hitlRes.rows[0];

  return {
    range,
    totals: {
      tokens:      Number(t.tokens),
      costUsd:     Number(t.cost_usd),
      llmCalls:    Number(t.llm_calls),
      pendingHitl: Number(h.pending_hitl),
    },
    burnRate: burnRes.rows.map(r => ({
      bucket: new Date(r.bucket).toISOString(),
      tokens: Number(r.tokens),
    })),
    topTools: toolsRes.rows.map(r => ({
      toolName: r.tool_name as string,
      count:    Number(r.count),
    })),
    laneSplit: laneRes.rows.map(r => ({
      lane:  Number(r.lane) as 1 | 2 | 3,
      label: LANE_LABELS[Number(r.lane)],
      count: Number(r.count),
    })),
    recentSessions: sessionsRes.rows.map(r => ({
      sessionId:   r.session_id as string,
      platform:    (r.platform === 'telegram' ? 'telegram' : 'slack') as 'slack' | 'telegram',
      tokensTotal: Number(r.tokens_total),
      costUsd:     Number(r.cost_usd),
      toolCount:   Number(r.tool_count),
      topLane:     Number(r.top_lane) as 1 | 2 | 3,
      createdAt:   new Date(r.created_at).toISOString(),
    })),
  };
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run src/dashboard/queries.test.ts
```
Expected: all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/queries.ts src/dashboard/queries.test.ts
git commit -m "feat(dashboard): backend stats queries with tests"
```

---

## Task 2: Backend — server.ts route handler

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `src/dashboard/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/dashboard/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import { Readable } from 'stream';

const mockFetchStats = vi.fn();
vi.mock('./queries.js', () => ({ fetchStats: mockFetchStats }));
vi.mock('../database/db.js', () => ({ isDBConfigured: () => true }));
vi.mock('node:fs', () => ({
  existsSync: () => false, // no dist/public in test env
  readFileSync: () => '',
  createReadStream: () => Readable.from([]),
  statSync: () => ({ size: 0 }),
}));

import { handleDashboardRequest } from './server.js';

function makeReq(url: string): http.IncomingMessage {
  const req = new Readable() as http.IncomingMessage;
  req.url = url;
  req.method = 'GET';
  req.headers = {};
  req._read = () => {};
  return req;
}

function makeRes() {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';
  const res = {
    writeHead: (code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      Object.assign(headers, hdrs ?? {});
    },
    end: (data?: string) => { body = data ?? ''; },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body; },
  };
  return res;
}

describe('handleDashboardRequest', () => {
  beforeEach(() => mockFetchStats.mockReset());

  it('GET /api/stats returns JSON stats', async () => {
    const fakeStats = { range: '24h', totals: {}, burnRate: [], topTools: [], laneSplit: [], recentSessions: [] };
    mockFetchStats.mockResolvedValueOnce(fakeStats);
    const req = makeReq('/api/stats?range=24h');
    const res = makeRes();
    await handleDashboardRequest(req, res as any);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(fakeStats);
    expect(mockFetchStats).toHaveBeenCalledWith('24h');
  });

  it('GET /api/stats defaults to 24h when range omitted', async () => {
    mockFetchStats.mockResolvedValueOnce({ range: '24h', totals: {}, burnRate: [], topTools: [], laneSplit: [], recentSessions: [] });
    const req = makeReq('/api/stats');
    const res = makeRes();
    await handleDashboardRequest(req, res as any);
    expect(mockFetchStats).toHaveBeenCalledWith('24h');
  });

  it('GET /api/stats rejects unknown range with 400', async () => {
    const req = makeReq('/api/stats?range=1y');
    const res = makeRes();
    await handleDashboardRequest(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown paths', async () => {
    const req = makeReq('/unknown');
    const res = makeRes();
    await handleDashboardRequest(req, res as any);
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx vitest run src/dashboard/server.test.ts
```
Expected: fails with "Cannot find module './server.js'"

- [ ] **Step 3: Implement `src/dashboard/server.ts`**

```ts
import http from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchStats, type Range } from './queries.js';
import { isDBConfigured } from '../database/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../dist/public');
const VALID_RANGES = new Set<Range>(['24h', '7d', '30d']);

function serveFile(res: http.ServerResponse, filePath: string): void {
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
  res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

export async function handleDashboardRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

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

  // ── /dashboard (SPA root) ─────────────────────────────────────────────────
  if (pathname === '/dashboard' || pathname === '/dashboard/') {
    serveFile(res, path.join(DIST_DIR, 'index.html'));
    return;
  }

  // ── /dashboard/assets/* ───────────────────────────────────────────────────
  if (pathname.startsWith('/dashboard/')) {
    const relative = pathname.replace('/dashboard/', '');
    serveFile(res, path.join(DIST_DIR, relative));
    return;
  }

  res.writeHead(404);
  res.end();
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run src/dashboard/server.test.ts
```
Expected: all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "feat(dashboard): HTTP route handler for /dashboard and /api/stats"
```

---

## Task 3: Refactor health.ts to delegate dashboard routes

**Files:**
- Modify: `src/health.ts`

- [ ] **Step 1: Add the delegation call**

In `src/health.ts`, find the `http.createServer` callback and replace the 404 fallback with a call to `handleDashboardRequest`:

```ts
// At the top of health.ts, add:
import { handleDashboardRequest } from './dashboard/server.js';

// Inside http.createServer(async (req, res) => { ... })
// Replace the final block that returns 404 for non-/health routes:

    if (req.url !== '/health') {
      // was: res.writeHead(404); res.end(); return;
      await handleDashboardRequest(req, res);
      return;
    }
```

Full updated `src/health.ts`:

```ts
import http from 'http';
import { getPool, isDBConfigured } from './database/db.js';
import { handleDashboardRequest } from './dashboard/server.js';

export function startHealthServer(port = 9000): void {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      const headers = { 'Content-Type': 'application/json' };

      if (!isDBConfigured()) {
        res.writeHead(503, headers);
        res.end(JSON.stringify({
          status: 'degraded',
          db: 'not_configured',
          uptime: process.uptime(),
          pid: process.pid,
        }));
        return;
      }

      try {
        await getPool().query('SELECT 1');
        res.writeHead(200, headers);
        res.end(JSON.stringify({
          status: 'ok',
          db: 'connected',
          uptime: Math.round(process.uptime()),
          pid: process.pid,
          memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        }));
      } catch {
        res.writeHead(503, headers);
        res.end(JSON.stringify({
          status: 'error',
          db: 'disconnected',
          uptime: Math.round(process.uptime()),
          pid: process.pid,
        }));
      }
      return;
    }

    await handleDashboardRequest(req, res);
  });

  server.listen(port, () => {
    console.log(`[health] Listening on :${port}/health`);
    console.log(`[dashboard] Available at :${port}/dashboard`);
  });

  server.unref();
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/health.ts
git commit -m "refactor(health): delegate non-/health routes to dashboard handler"
```

---

## Task 4: Scaffold the Vite + React frontend

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/index.html`
- Create: `dashboard/src/main.tsx`

- [ ] **Step 1: Create `dashboard/package.json`**

```json
{
  "name": "cloud-claw-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev":   "vite",
    "build": "tsc --noEmit && vite build",
    "test":  "vitest run"
  },
  "dependencies": {
    "chart.js":        "^4.4.4",
    "react":           "^18.3.1",
    "react-chartjs-2": "^5.2.0",
    "react-dom":       "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom":  "^6.6.3",
    "@testing-library/react":     "^16.0.0",
    "@testing-library/user-event":"^14.5.2",
    "@types/react":               "^18.3.12",
    "@types/react-dom":           "^18.3.1",
    "@vitejs/plugin-react":       "^4.3.4",
    "jsdom":                      "^25.0.1",
    "typescript":                 "^5.7.3",
    "vite":                       "^5.4.14",
    "vitest":                     "^2.1.9"
  }
}
```

- [ ] **Step 2: Create `dashboard/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `dashboard/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:9000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 4: Create `dashboard/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 5: Create `dashboard/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cloud-Claw — Analytics</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `dashboard/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 7: Install dependencies**

```bash
cd dashboard && npm install
```
Expected: `node_modules/` created, no errors

- [ ] **Step 8: Commit**

```bash
cd ..
git add dashboard/
git commit -m "feat(dashboard): scaffold Vite + React + TypeScript project"
```

---

## Task 5: Frontend types and useStats hook

**Files:**
- Create: `dashboard/src/types.ts`
- Create: `dashboard/src/hooks/useStats.ts`
- Create: `dashboard/src/hooks/useStats.test.ts`

- [ ] **Step 1: Create `dashboard/src/types.ts`**

```ts
export type Range = '24h' | '7d' | '30d';

export interface StatsResponse {
  range: Range;
  totals: {
    tokens: number;
    costUsd: number;
    llmCalls: number;
    pendingHitl: number;
  };
  burnRate: { bucket: string; tokens: number }[];
  topTools: { toolName: string; count: number }[];
  laneSplit: {
    lane: 1 | 2 | 3;
    label: 'API' | 'SSH Read' | 'SSH Write';
    count: number;
  }[];
  recentSessions: {
    sessionId: string;
    platform: 'slack' | 'telegram';
    tokensTotal: number;
    costUsd: number;
    toolCount: number;
    topLane: 1 | 2 | 3;
    createdAt: string;
  }[];
}
```

- [ ] **Step 2: Write the failing test**

Create `dashboard/src/hooks/useStats.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useStats } from './useStats';

const FAKE_STATS = {
  range: '24h' as const,
  totals: { tokens: 100, costUsd: 0.01, llmCalls: 5, pendingHitl: 0 },
  burnRate: [],
  topTools: [],
  laneSplit: [],
  recentSessions: [],
};

describe('useStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => FAKE_STATS,
    } as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches stats on mount', async () => {
    const { result } = renderHook(() => useStats('24h'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(FAKE_STATS);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/stats?range=24h');
  });

  it('re-fetches when range changes', async () => {
    let range = '24h' as '24h' | '7d';
    const { result, rerender } = renderHook(() => useStats(range));
    await waitFor(() => expect(result.current.loading).toBe(false));

    range = '7d';
    rerender();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stats?range=7d'));
  });

  it('sets error when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useStats('24h'));
    await waitFor(() => expect(result.current.error).toBe('network error'));
    expect(result.current.data).toBeNull();
  });

  it('re-fetches after 30 seconds', async () => {
    const { result } = renderHook(() => useStats('24h'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await waitFor(() => {
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
```

- [ ] **Step 3: Run test — confirm it fails**

```bash
cd dashboard && npm test -- hooks/useStats.test.ts
```
Expected: fails with "Cannot find module './useStats'"

- [ ] **Step 4: Implement `dashboard/src/hooks/useStats.ts`**

```ts
import { useState, useEffect, useCallback } from 'react';
import type { StatsResponse, Range } from '../types';

interface UseStatsResult {
  data: StatsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 30_000;

export function useStats(range: Range): UseStatsResult {
  const [data, setData]       = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stats?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as StatsResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetch_]);

  return { data, loading, error, refresh: fetch_ };
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd dashboard && npm test -- hooks/useStats.test.ts
```
Expected: all 4 tests pass

- [ ] **Step 6: Commit**

```bash
cd ..
git add dashboard/src/types.ts dashboard/src/hooks/
git commit -m "feat(dashboard): types and useStats polling hook"
```

---

## Task 6: StatCard and Sidebar components

**Files:**
- Create: `dashboard/src/components/StatCard.tsx`
- Create: `dashboard/src/components/StatCard.test.tsx`
- Create: `dashboard/src/components/Sidebar.tsx`
- Create: `dashboard/src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write failing StatCard test**

Create `dashboard/src/components/StatCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Tokens" value="1.24M" icon="🧠" iconBg="#ede9fe" />);
    expect(screen.getByText('Total Tokens')).toBeInTheDocument();
    expect(screen.getByText('1.24M')).toBeInTheDocument();
  });

  it('renders positive trend badge', () => {
    render(<StatCard label="Cost" value="$4.82" icon="💰" iconBg="#fef3c7" trend={{ direction: 'up', pct: '12%' }} />);
    expect(screen.getByText(/12%/)).toBeInTheDocument();
  });

  it('renders without trend when omitted', () => {
    render(<StatCard label="LLM Calls" value="184" icon="⚡" iconBg="#dbeafe" />);
    expect(screen.queryByText(/↑|↓|→/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd dashboard && npm test -- StatCard.test.tsx
```

- [ ] **Step 3: Implement `dashboard/src/components/StatCard.tsx`**

```tsx
import React from 'react';

interface Trend {
  direction: 'up' | 'down' | 'stable';
  pct: string;
}

interface StatCardProps {
  label: string;
  value: string;
  icon: string;
  iconBg: string;
  trend?: Trend;
  valueColor?: string;
}

const TREND_STYLE: Record<Trend['direction'], { bg: string; color: string; arrow: string }> = {
  up:     { bg: '#dcfce7', color: '#16a34a', arrow: '↑' },
  down:   { bg: '#fee2e2', color: '#dc2626', arrow: '↓' },
  stable: { bg: '#f1f5f9', color: '#64748b', arrow: '→' },
};

export function StatCard({ label, value, icon, iconBg, trend, valueColor }: StatCardProps) {
  const ts = trend ? TREND_STYLE[trend.direction] : null;

  return (
    <div style={{
      flex: 1,
      background: '#fff',
      border: '1px solid #f1f5f9',
      borderRadius: 14,
      padding: '16px',
      boxShadow: '0 1px 4px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{label}</span>
        <div style={{
          width: 34, height: 34, borderRadius: 9,
          background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: valueColor ?? '#0f172a', lineHeight: 1, marginBottom: 5 }}>
        {value}
      </div>
      {ts && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontSize: 11, fontWeight: 600, padding: '2px 7px',
          borderRadius: 99, background: ts.bg, color: ts.color,
        }}>
          {ts.arrow} {trend!.pct}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run StatCard tests — confirm they pass**

```bash
cd dashboard && npm test -- StatCard.test.tsx
```
Expected: all 3 tests pass

- [ ] **Step 5: Write Sidebar test**

Create `dashboard/src/components/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders Cloud-Claw branding', () => {
    render(<Sidebar pendingHitl={0} />);
    expect(screen.getByText('Cloud-Claw')).toBeInTheDocument();
  });

  it('shows "All Systems Clear" when no pending HITL', () => {
    render(<Sidebar pendingHitl={0} />);
    expect(screen.getByText(/All Systems Clear/i)).toBeInTheDocument();
  });

  it('shows pending count when HITL > 0', () => {
    render(<Sidebar pendingHitl={3} />);
    expect(screen.getByText(/3 pending/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test — confirm it fails**

```bash
cd dashboard && npm test -- Sidebar.test.tsx
```

- [ ] **Step 7: Implement `dashboard/src/components/Sidebar.tsx`**

```tsx
import React from 'react';

interface SidebarProps {
  pendingHitl: number;
}

const NAV_MAIN = [
  { icon: '📊', label: 'Dashboard' },
  { icon: '📈', label: 'Analytics', active: true },
  { icon: '💬', label: 'Sessions' },
  { icon: '🔧', label: 'Tools' },
  { icon: '🖥️', label: 'Servers' },
];

const NAV_GENERAL = [
  { icon: '⚙️', label: 'Settings' },
  { icon: '❓', label: 'Help' },
];

function NavItem({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '8px 10px', borderRadius: 8, marginBottom: 2,
      cursor: 'pointer',
      background: active ? 'linear-gradient(135deg,rgba(249,115,22,.12),rgba(236,72,153,.10))' : 'transparent',
      color: active ? '#f97316' : '#64748b',
      fontWeight: active ? 600 : 500,
      fontSize: 13,
    }}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

export function Sidebar({ pendingHitl }: SidebarProps) {
  return (
    <div style={{
      width: 200, minWidth: 200,
      background: '#fff',
      borderRight: '1px solid #f1f5f9',
      padding: '24px 16px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28, paddingLeft: 4 }}>
        <div style={{
          width: 30, height: 30,
          background: 'linear-gradient(135deg,#f97316,#ec4899)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: 12,
        }}>CC</div>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Cloud-Claw</span>
      </div>

      {/* Main nav */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.08em', textTransform: 'uppercase', padding: '0 8px', marginBottom: 6 }}>
          Main Menu
        </div>
        {NAV_MAIN.map(item => <NavItem key={item.label} {...item} />)}
      </div>

      {/* General nav */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.08em', textTransform: 'uppercase', padding: '0 8px', marginBottom: 6 }}>
          General
        </div>
        {NAV_GENERAL.map(item => <NavItem key={item.label} {...item} />)}
      </div>

      {/* Sentinel card */}
      <div style={{ marginTop: 'auto', background: 'linear-gradient(135deg,#fef3c7,#fde68a)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 22, marginBottom: 6 }}>{pendingHitl > 0 ? '🛑' : '🛡️'}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 3 }}>
          {pendingHitl > 0 ? `${pendingHitl} pending` : 'All Systems Clear'}
        </div>
        <div style={{ fontSize: 10, color: '#a16207', marginBottom: 10, lineHeight: 1.4 }}>
          {pendingHitl > 0 ? 'HITL approvals waiting' : 'Sentinel active. No pending HITL.'}
        </div>
        <button style={{
          background: 'linear-gradient(135deg,#f97316,#ec4899)',
          color: '#fff', fontSize: 11, fontWeight: 700,
          border: 'none', borderRadius: 8, padding: '7px 14px',
          cursor: 'pointer', width: '100%',
        }}>
          View Approvals
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run Sidebar tests — confirm they pass**

```bash
cd dashboard && npm test -- Sidebar.test.tsx
```
Expected: all 3 tests pass

- [ ] **Step 9: Commit**

```bash
cd ..
git add dashboard/src/components/StatCard.tsx dashboard/src/components/StatCard.test.tsx
git add dashboard/src/components/Sidebar.tsx dashboard/src/components/Sidebar.test.tsx
git commit -m "feat(dashboard): StatCard and Sidebar components"
```

---

## Task 7: BurnRateChart and TopToolsChart

**Files:**
- Create: `dashboard/src/components/BurnRateChart.tsx`
- Create: `dashboard/src/components/BurnRateChart.test.tsx`
- Create: `dashboard/src/components/TopToolsChart.tsx`
- Create: `dashboard/src/components/TopToolsChart.test.tsx`

- [ ] **Step 1: Write smoke tests**

Create `dashboard/src/components/BurnRateChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BurnRateChart } from './BurnRateChart';

vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }: { data: { labels: string[] } }) => (
    <div data-testid="bar-chart">{data.labels.join(',')}</div>
  ),
}));

describe('BurnRateChart', () => {
  it('renders without crashing with empty data', () => {
    render(<BurnRateChart data={[]} range="24h" />);
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('passes bucket labels to chart', () => {
    const data = [
      { bucket: '2026-04-23T10:00:00.000Z', tokens: 1000 },
      { bucket: '2026-04-23T11:00:00.000Z', tokens: 2000 },
    ];
    render(<BurnRateChart data={data} range="24h" />);
    expect(screen.getByTestId('bar-chart').textContent).toContain('10:00');
  });
});
```

Create `dashboard/src/components/TopToolsChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopToolsChart } from './TopToolsChart';

vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }: { data: { labels: string[] } }) => (
    <div data-testid="hbar-chart">{data.labels.join(',')}</div>
  ),
}));

describe('TopToolsChart', () => {
  it('renders without crashing with empty data', () => {
    render(<TopToolsChart data={[]} />);
    expect(screen.getByTestId('hbar-chart')).toBeInTheDocument();
  });

  it('shows tool names as labels', () => {
    const data = [
      { toolName: 'execute_ssh_command', count: 84 },
      { toolName: 'diagnose_nginx', count: 42 },
    ];
    render(<TopToolsChart data={data} />);
    expect(screen.getByTestId('hbar-chart').textContent).toContain('execute_ssh_command');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd dashboard && npm test -- BurnRateChart.test.tsx TopToolsChart.test.tsx
```

- [ ] **Step 3: Implement `dashboard/src/components/BurnRateChart.tsx`**

```tsx
import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { Range } from '../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface Props {
  data: { bucket: string; tokens: number }[];
  range: Range;
}

const TZ = 'Asia/Kolkata';

function formatLabel(bucket: string, range: Range): string {
  const d = new Date(bucket);
  if (range === '24h') {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  }
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: TZ });
}

export function BurnRateChart({ data, range }: Props) {
  const maxTokens = Math.max(...data.map(d => d.tokens), 1);

  const chartData = {
    labels: data.map(d => formatLabel(d.bucket, range)),
    datasets: [{
      data: data.map(d => d.tokens),
      backgroundColor: data.map(d =>
        d.tokens >= maxTokens * 0.7 ? '#7c3aed' : '#ede9fe'
      ),
      borderRadius: 4,
      borderSkipped: false,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: {
      callbacks: {
        label: (ctx: { parsed: { y: number } }) =>
          `${(ctx.parsed.y / 1000).toFixed(1)}k tokens`,
      },
    }},
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans' } } },
      y: { grid: { color: '#f1f5f9' }, ticks: {
        font: { family: 'Plus Jakarta Sans' },
        callback: (v: string | number) => `${(Number(v) / 1000).toFixed(0)}k`,
      }},
    },
  };

  return (
    <div style={{ height: 140 }}>
      <Bar data={chartData} options={options as never} />
    </div>
  );
}
```

- [ ] **Step 4: Implement `dashboard/src/components/TopToolsChart.tsx`**

```tsx
import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface Props {
  data: { toolName: string; count: number }[];
}

export function TopToolsChart({ data }: Props) {
  const chartData = {
    labels: data.map(d => d.toolName),
    datasets: [{
      data: data.map(d => d.count),
      backgroundColor: data.map((_, i) =>
        i === 0 ? '#f97316' : '#7c3aed'
      ),
      borderRadius: 4,
      borderSkipped: false,
    }],
  };

  const options = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Plus Jakarta Sans' } } },
      y: { grid: { display: false }, ticks: {
        font: { family: 'Plus Jakarta Sans', size: 11 },
      }},
    },
  };

  return (
    <div style={{ height: 220 }}>
      <Bar data={chartData} options={options as never} />
    </div>
  );
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd dashboard && npm test -- BurnRateChart.test.tsx TopToolsChart.test.tsx
```
Expected: all 4 tests pass

- [ ] **Step 6: Commit**

```bash
cd ..
git add dashboard/src/components/BurnRateChart.tsx dashboard/src/components/BurnRateChart.test.tsx
git add dashboard/src/components/TopToolsChart.tsx dashboard/src/components/TopToolsChart.test.tsx
git commit -m "feat(dashboard): BurnRateChart and TopToolsChart components"
```

---

## Task 8: LaneSplitChart and SessionsTable

**Files:**
- Create: `dashboard/src/components/LaneSplitChart.tsx`
- Create: `dashboard/src/components/LaneSplitChart.test.tsx`
- Create: `dashboard/src/components/SessionsTable.tsx`
- Create: `dashboard/src/components/SessionsTable.test.tsx`

- [ ] **Step 1: Write smoke tests**

Create `dashboard/src/components/LaneSplitChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LaneSplitChart } from './LaneSplitChart';

vi.mock('react-chartjs-2', () => ({
  Doughnut: () => <div data-testid="doughnut-chart" />,
}));

describe('LaneSplitChart', () => {
  it('renders without crashing', () => {
    render(<LaneSplitChart data={[{ lane: 1, label: 'API', count: 55 }]} />);
    expect(screen.getByTestId('doughnut-chart')).toBeInTheDocument();
  });
});
```

Create `dashboard/src/components/SessionsTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionsTable } from './SessionsTable';

const SESSIONS = [
  {
    sessionId: 'slack:U123',
    platform: 'slack' as const,
    tokensTotal: 42100,
    costUsd: 0.18,
    toolCount: 8,
    topLane: 1 as const,
    createdAt: '2026-04-23T10:00:00.000Z',
  },
];

describe('SessionsTable', () => {
  it('renders session rows', () => {
    render(<SessionsTable sessions={SESSIONS} />);
    expect(screen.getByText('slack:U123')).toBeInTheDocument();
  });

  it('shows API badge for lane 1', () => {
    render(<SessionsTable sessions={SESSIONS} />);
    expect(screen.getByText('API')).toBeInTheDocument();
  });

  it('renders empty state when no sessions', () => {
    render(<SessionsTable sessions={[]} />);
    expect(screen.getByText(/no sessions/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd dashboard && npm test -- LaneSplitChart.test.tsx SessionsTable.test.tsx
```

- [ ] **Step 3: Implement `dashboard/src/components/LaneSplitChart.tsx`**

```tsx
import React from 'react';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip);

interface LaneStat {
  lane: 1 | 2 | 3;
  label: 'API' | 'SSH Read' | 'SSH Write';
  count: number;
}

interface Props {
  data: LaneStat[];
}

const LANE_COLORS: Record<number, string> = {
  1: '#7c3aed',
  2: '#3b82f6',
  3: '#f43f5e',
};

export function LaneSplitChart({ data }: Props) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const dominant = data.length > 0 ? data.reduce((a, b) => (a.count > b.count ? a : b)) : null;
  const dominantPct = dominant && total > 0 ? Math.round((dominant.count / total) * 100) : 0;

  const chartData = {
    labels: data.map(d => d.label),
    datasets: [{
      data: data.map(d => d.count),
      backgroundColor: data.map(d => LANE_COLORS[d.lane]),
      borderWidth: 0,
      hoverOffset: 4,
    }],
  };

  const options = {
    cutout: '72%',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        label: (ctx: { label: string; parsed: number }) =>
          `${ctx.label}: ${ctx.parsed}`,
      }},
    },
  };

  return (
    <div>
      <div style={{ position: 'relative', height: 120, width: 120, margin: '0 auto 12px' }}>
        <Doughnut data={chartData} options={options as never} />
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{dominantPct}%</span>
          <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase' }}>
            {dominant?.label ?? ''}
          </span>
        </div>
      </div>
      <div>
        {data.map(d => (
          <div key={d.lane} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: LANE_COLORS[d.lane] }} />
              {d.label}
            </div>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>
              {total > 0 ? Math.round((d.count / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `dashboard/src/components/SessionsTable.tsx`**

```tsx
import React from 'react';
import type { StatsResponse } from '../types';

type Session = StatsResponse['recentSessions'][number];

interface Props {
  sessions: Session[];
}

const LANE_BADGE: Record<1 | 2 | 3, { label: string; bg: string; color: string }> = {
  1: { label: 'API',       bg: '#ede9fe', color: '#7c3aed' },
  2: { label: 'SSH Read',  bg: '#dbeafe', color: '#2563eb' },
  3: { label: 'SSH Write', bg: '#fee2e2', color: '#dc2626' },
};

const TZ = 'Asia/Kolkata';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: TZ,
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function SessionsTable({ sessions }: Props) {
  const th: React.CSSProperties = {
    fontSize: 11, color: '#94a3b8', fontWeight: 600,
    textAlign: 'left', padding: '0 8px 8px',
    borderBottom: '1px solid #f1f5f9',
  };
  const td: React.CSSProperties = {
    fontSize: 12, color: '#0f172a',
    padding: '8px 8px', borderBottom: '1px solid #f8fafc',
  };

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        No sessions recorded yet
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Session</th>
          <th style={th}>Platform</th>
          <th style={th}>Tools</th>
          <th style={th}>Tokens</th>
          <th style={th}>Cost</th>
          <th style={th}>Lane</th>
          <th style={th}>Time (IST)</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => {
          const badge = LANE_BADGE[s.topLane];
          const shortId = s.sessionId.length > 18 ? `${s.sessionId.slice(0, 18)}…` : s.sessionId;
          return (
            <tr key={s.sessionId}>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }} title={s.sessionId}>
                {shortId}
              </td>
              <td style={td}>{s.platform}</td>
              <td style={td}>{s.toolCount}</td>
              <td style={td}>{fmt(s.tokensTotal)}</td>
              <td style={{ ...td, color: '#f97316', fontWeight: 600 }}>
                ${s.costUsd.toFixed(4)}
              </td>
              <td style={td}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  fontSize: 10, fontWeight: 600, padding: '2px 8px',
                  borderRadius: 99, background: badge.bg, color: badge.color,
                }}>
                  {badge.label}
                </span>
              </td>
              <td style={{ ...td, color: '#94a3b8', fontSize: 11 }}>{fmtTime(s.createdAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd dashboard && npm test -- LaneSplitChart.test.tsx SessionsTable.test.tsx
```
Expected: all 4 tests pass

- [ ] **Step 6: Commit**

```bash
cd ..
git add dashboard/src/components/LaneSplitChart.tsx dashboard/src/components/LaneSplitChart.test.tsx
git add dashboard/src/components/SessionsTable.tsx dashboard/src/components/SessionsTable.test.tsx
git commit -m "feat(dashboard): LaneSplitChart and SessionsTable components"
```

---

## Task 9: App.tsx — wire layout together

**Files:**
- Create: `dashboard/src/App.tsx`

- [ ] **Step 1: Create `dashboard/src/App.tsx`**

```tsx
import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { StatCard } from './components/StatCard';
import { BurnRateChart } from './components/BurnRateChart';
import { TopToolsChart } from './components/TopToolsChart';
import { LaneSplitChart } from './components/LaneSplitChart';
import { SessionsTable } from './components/SessionsTable';
import { useStats } from './hooks/useStats';
import type { Range } from './types';

const RANGES: Range[] = ['24h', '7d', '30d'];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #f1f5f9',
  borderRadius: 14,
  padding: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,.04)',
};

const chartTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

export default function App() {
  const [range, setRange] = useState<Range>('24h');
  const { data, loading, error, refresh } = useStats(range);

  const totals = data?.totals ?? { tokens: 0, costUsd: 0, llmCalls: 0, pendingHitl: 0 };

  return (
    <div style={{
      background: '#f0f2f5', minHeight: '100vh',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: '#fff', borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,.10)',
        display: 'flex', width: '100%', maxWidth: 1200, minHeight: 680,
        overflow: 'hidden',
      }}>
        <Sidebar pendingHitl={totals.pendingHitl} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Topbar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '7px 14px',
              fontSize: 13, color: '#94a3b8',
            }}>
              🔍 Sessions, tools, servers…
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: 10, padding: '5px 12px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 700,
                }}>AJ</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>Pilot</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Admin</div>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto' }}>
            {/* Page header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>AIOps Analytics</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                  Token usage, tool calls, cost and agent behaviour across all sessions
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Range pills */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {RANGES.map(r => (
                    <button key={r} onClick={() => setRange(r)} style={{
                      padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                      border: 'none', cursor: 'pointer',
                      background: range === r ? '#7c3aed' : '#f1f5f9',
                      color: range === r ? '#fff' : '#64748b',
                    }}>{r}</button>
                  ))}
                </div>
                <button onClick={refresh} disabled={loading} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg,#f97316,#ec4899)',
                  color: '#fff', opacity: loading ? 0.7 : 1,
                }}>
                  {loading ? '…' : '↻'} Refresh
                </button>
              </div>
            </div>

            {error && (
              <div style={{ background: '#fee2e2', color: '#dc2626', padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                ⚠️ {error === 'HTTP 503' ? 'Database not connected — stats unavailable' : `Error: ${error}`}
              </div>
            )}

            {/* Stat cards */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <StatCard label="Total Tokens"  value={formatTokens(totals.tokens)}  icon="🧠" iconBg="#ede9fe" />
              <StatCard label="Cost (USD)"    value={`$${totals.costUsd.toFixed(4)}`} icon="💰" iconBg="#fef3c7" valueColor="#f97316" />
              <StatCard label="LLM Calls"     value={String(totals.llmCalls)}       icon="⚡" iconBg="#dbeafe" />
              <StatCard label="Pending HITL"  value={String(totals.pendingHitl)}    icon="🛑" iconBg="#fee2e2" valueColor={totals.pendingHitl > 0 ? '#dc2626' : '#0f172a'} />
            </div>

            {/* Charts row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              {/* Burn Rate */}
              <div style={{ ...card, flex: 2.2 }}>
                <div style={chartTitle}>
                  <span>Token Burn Rate</span>
                </div>
                <BurnRateChart data={data?.burnRate ?? []} range={range} />
              </div>

              {/* Top Tools */}
              <div style={{ ...card, flex: 1.5 }}>
                <div style={chartTitle}><span>Top Tools</span></div>
                <TopToolsChart data={data?.topTools ?? []} />
              </div>

              {/* Lane Split */}
              <div style={{ ...card, flex: 1 }}>
                <div style={chartTitle}><span>Lane Split</span></div>
                <LaneSplitChart data={data?.laneSplit ?? []} />
              </div>
            </div>

            {/* Sessions table */}
            <div style={card}>
              <div style={{ ...chartTitle, marginBottom: 12 }}>
                <span>Recent Sessions</span>
              </div>
              <SessionsTable sessions={data?.recentSessions ?? []} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd dashboard && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd ..
git add dashboard/src/App.tsx
git commit -m "feat(dashboard): App layout — wire all components together"
```

---

## Task 10: Build and end-to-end verification

- [ ] **Step 1: Run all frontend tests**

```bash
cd dashboard && npm test
```
Expected: all tests pass, no failures

- [ ] **Step 2: Build the frontend**

```bash
cd dashboard && npm run build
```
Expected: `dist/public/` created with `index.html`, `assets/` folder

- [ ] **Step 3: Typecheck the backend**

```bash
cd .. && npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Start the backend dev server**

```bash
npm run dev
```

- [ ] **Step 5: Verify the dashboard loads**

Open `http://localhost:9000/dashboard` in a browser.

Expected:
- Sidebar with Cloud-Claw logo, nav items, sentinel card
- 4 stat cards (may show zeroes if DB is empty — that is correct)
- Burn rate bar chart renders
- Top tools chart renders
- Lane split donut renders
- Sessions table shows "No sessions recorded yet" or real rows
- No console errors

- [ ] **Step 6: Verify the API endpoint**

```bash
curl http://localhost:9000/api/stats?range=24h | jq .
```
Expected: JSON with `totals`, `burnRate`, `topTools`, `laneSplit`, `recentSessions` keys

- [ ] **Step 7: Verify /health is unchanged**

```bash
curl http://localhost:9000/health
```
Expected: `{"status":"ok","db":"connected",...}`

- [ ] **Step 8: Add build script to root package.json**

`dist/` is in `.gitignore` — build output is never committed. Instead, add a build step to the root so the backend always has fresh static files:

In `package.json` (root), update `"scripts"`:

```json
"build:dashboard": "cd dashboard && npm run build",
"start": "npm run build:dashboard && node dist/src/index.js"
```

Run once to verify:
```bash
npm run build:dashboard
```
Expected: `dist/public/index.html` created

- [ ] **Step 9: Final commit**

```bash
git add dashboard/ package.json
git commit -m "feat(dashboard): pilot analytics dashboard — Vite+React frontend, /api/stats endpoint"
```

---

## Checklist

- [ ] Backend queries tested and typed
- [ ] `/api/stats` returns correct JSON for all three ranges
- [ ] `/health` unchanged
- [ ] `/dashboard` serves the React SPA
- [ ] All frontend components have passing tests
- [ ] `npm run typecheck` passes
- [ ] Dashboard visible at `http://localhost:9000/dashboard`
