# Pilot Dashboard — Design Spec

**Date:** 2026-04-23
**Status:** Approved

---

## Overview

A read-only analytics dashboard for Cloud-Claw pilots. Surfaces token usage, cost, tool call frequency, lane distribution, and recent session activity. Served from the existing Node health server (port 9000). No authentication for now.

---

## Visual Design

- **Style:** Clean Light — white cards on light grey canvas, crisp shadows
- **Font:** Plus Jakarta Sans (Google Fonts CDN)
- **Accent:** Violet (#7c3aed) primary, orange (#f97316) for cost/highlight
- **Reference:** Sociafy-inspired layout (sidebar nav + stat cards + charts + table)
- **No dark mode** in v1

---

## Architecture

### Frontend — `dashboard/` (Vite + React + TypeScript)

Separate Vite project inside the repo. Builds static files to `../dist/public/`.

```
dashboard/
  src/
    components/
      Sidebar.tsx
      StatCard.tsx
      BurnRateChart.tsx
      TopToolsChart.tsx
      LaneSplitChart.tsx
      SessionsTable.tsx
    hooks/
      useStats.ts
    types.ts
    App.tsx
    main.tsx
  index.html
  vite.config.ts
  package.json
  tsconfig.json
```

**Key decisions:**
- Chart.js via `react-chartjs-2` npm package
- `useStats` hook polls `GET /api/stats?range=<range>` every 30 seconds
- Time range state (`24h | 7d | 30d`) lives in `App.tsx`, passed down as a prop
- No global state library — prop drilling is fine at this scale

### Backend — `src/dashboard/`

Two new files added to the existing backend:

```
src/dashboard/
  server.ts     — HTTP route handler for /dashboard and /api/stats
  queries.ts    — All PostgreSQL aggregation queries
```

`src/health.ts` is refactored to delegate non-`/health` requests to `handleDashboardRequest()` from `server.ts`.

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dashboard` | Serves `dist/public/index.html` |
| `GET` | `/dashboard/assets/*` | Serves Vite build assets |
| `GET` | `/api/stats?range=24h\|7d\|30d` | Returns aggregated stats JSON |
| `GET` | `/health` | Unchanged |

---

## API Contract

### `GET /api/stats?range=24h|7d|30d`

**Response shape:**

```ts
interface StatsResponse {
  range: '24h' | '7d' | '30d';
  totals: {
    tokens: number;
    costUsd: number;
    llmCalls: number;
    pendingHitl: number;
  };
  burnRate: {
    bucket: string;   // ISO timestamp of bucket start
    tokens: number;
  }[];
  topTools: {
    toolName: string;
    count: number;
  }[];               // top 10, ordered desc
  laneSplit: {
    lane: 1 | 2 | 3;
    label: 'API' | 'SSH Read' | 'SSH Write';
    count: number;
  }[];
  recentSessions: {
    sessionId: string;      // format: "platform:user_id"
    platform: 'slack' | 'telegram';
    tokensTotal: number;
    costUsd: number;
    toolCount: number;
    topLane: 1 | 2 | 3;    // lane with highest call count for this session
    createdAt: string;
  }[];               // last 10 sessions by most recent activity
}
```

**Fallback:** If `DATABASE_URL` is not configured, return a `503` with `{ error: 'db_not_configured' }`. The frontend renders an empty state message.

---

## Queries (`src/dashboard/queries.ts`)

| Query | Source | Notes |
|-------|--------|-------|
| Totals | `usage_log` | SUM tokens, cost; COUNT calls within range |
| Pending HITL | `approval_queue` | COUNT where `status = 'pending'` |
| Burn rate | `usage_log` | GROUP BY hour (24h) or day (7d/30d) |
| Top tools | `usage_log` | GROUP BY tool_name, COUNT(*), top 10 |
| Lane split | `usage_log` | tool_name mapped to lane via CASE WHEN |
| Recent sessions | `sessions` JOIN `usage_log` | Last 10 by created_at |

Lane classification is done in SQL via a `CASE WHEN tool_name IN (...)` block mirroring `LANE_MAP` in `ssh_escalation_analyzer.ts`.

---

## UI Components

### Sidebar
- Cloud-Claw logo + "CC" avatar icon (orange/pink gradient)
- Nav groups: **Main Menu** (Dashboard, Analytics, Sessions, Tools, Servers) and **General** (Settings, Help)
- Active item: orange gradient pill highlight
- Bottom card: Sentinel status (pending HITL count or "All Systems Clear")

### StatCard (×4)
- Label, large bold number, coloured emoji icon, trend badge (↑/↓/→), "vs yesterday" label
- Cards: Total Tokens, Cost USD, LLM Calls, Pending HITL

### BurnRateChart
- Chart.js vertical bar chart
- X-axis: hourly (24h) or daily (7d/30d)
- Colour: violet bars, lighter shade for off-peak hours
- Time range pills (24h / 7d / 30d) control the `range` query param

### TopToolsChart
- Chart.js horizontal bar chart
- Top 10 tools by call count
- Orange→pink gradient on #1, violet on rest

### LaneSplitChart
- Chart.js doughnut chart
- 3 segments: API (violet), SSH Read (blue), SSH Write (red/pink)
- Centre label: dominant lane %

### SessionsTable
- Columns: Session ID (truncated), Platform, Tools Used, Tokens, Cost, Lane badge
- Lane badge colours: violet (API), blue (SSH Read), red (SSH Write)
- Last 10 rows by most recent activity, no pagination in v1
- Note: server label is not stored in usage_log — omitted from table

---

## Dev Workflow

```bash
# Frontend dev (hot reload, proxies /api → :9000)
cd dashboard && npm run dev

# Build for production
cd dashboard && npm run build   # → ../dist/public/

# Backend dev (serves built dashboard at /dashboard)
npm run dev
```

Vite `vite.config.ts` proxy:
```ts
server: {
  proxy: {
    '/api': 'http://localhost:9000'
  }
}
```

---

## Out of Scope (v1)

- Authentication / access control
- Per-pilot breakdown
- Pagination on sessions table
- Real-time WebSocket updates (polling every 30s is sufficient)
- Mobile layout
- Dark mode
