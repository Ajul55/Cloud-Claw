-- Cloud-Claw PostgreSQL Schema
-- Run with: psql $DATABASE_URL -f src/database/schema.sql

-- Enable pgvector extension for future embedding support
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Causality Map ────────────────────────────────────────────────────────────
-- Stores the discovered WordPress hosting stack topology per client/domain.
CREATE TABLE IF NOT EXISTS causality_map (
  id            SERIAL PRIMARY KEY,
  client_id     TEXT        NOT NULL,
  domain        TEXT        NOT NULL,
  vhost_path    TEXT,
  php_pool      TEXT,
  db_name       TEXT,
  mysql_host    TEXT,
  nginx_version TEXT,
  php_version   TEXT,
  extra_meta    JSONB       DEFAULT '{}'::JSONB,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, domain)
);

CREATE INDEX IF NOT EXISTS causality_map_client_idx ON causality_map (client_id);
CREATE INDEX IF NOT EXISTS causality_map_domain_idx ON causality_map (domain);

-- ─── Agent Sessions ───────────────────────────────────────────────────────────
-- Tracks conversation sessions per channel/user so the loop has persistent context.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT        PRIMARY KEY,  -- e.g. "telegram:123456789"
  channel     TEXT        NOT NULL,     -- "telegram" | "slack"
  user_id     TEXT        NOT NULL,
  messages    JSONB       NOT NULL DEFAULT '[]'::JSONB,
  iteration   INTEGER     NOT NULL DEFAULT 0,
  status      TEXT        NOT NULL DEFAULT 'open', -- open | in_progress | resolved | escalated
  problem_class TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── HITL Approval Queue ──────────────────────────────────────────────────────
-- Stores pending Tier-3 actions waiting for human approval.
CREATE TABLE IF NOT EXISTS approval_queue (
  id          SERIAL      PRIMARY KEY,
  session_id  TEXT        NOT NULL REFERENCES sessions(id),
  command     TEXT        NOT NULL,
  target_host TEXT        NOT NULL,
  rationale   TEXT,
  status      TEXT        NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS approval_queue_status_idx ON approval_queue (status);
CREATE INDEX IF NOT EXISTS approval_queue_session_idx ON approval_queue (session_id);

-- ─── Active Server Nodes ────────────────────────────────────────────────────────
-- Stores known hosts for Sentinel sweeps and status checks
CREATE TABLE IF NOT EXISTS server_nodes (
  id                SERIAL      PRIMARY KEY,
  hostname          TEXT        NOT NULL,
  ip_address        TEXT,
  is_active         BOOLEAN     DEFAULT TRUE,
  last_health_check TIMESTAMPTZ
);

-- ─── LLM Usage Telemetry ──────────────────────────────────────────────────────
-- Tracks token usage and cost
CREATE TABLE IF NOT EXISTS usage_log (
  id          SERIAL      PRIMARY KEY,
  session_id  TEXT,
  model       TEXT        NOT NULL,
  tokens_in   INTEGER     DEFAULT 0,
  tokens_out  INTEGER     DEFAULT 0,
  cost_usd    NUMERIC(10,6) DEFAULT 0,
  latency_ms  INTEGER,
  tool_name   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Fix Memory (pgvector Level 2) ──────────────────────────────────────────
-- Stores past problems and solutions to bootstrap LLM debugging.
CREATE TABLE IF NOT EXISTS fix_memory (
  id            SERIAL      PRIMARY KEY,
  issue_text    TEXT        NOT NULL,
  fix_command   TEXT        NOT NULL,
  embedding     vector(1536), -- text-embedding-3-small dimensionality
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
