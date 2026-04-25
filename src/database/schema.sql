-- Cloud-Claw Schema
-- Run this once: psql -U cloudclaw -d cloudclaw -f src/database/schema.sql

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
  reply_target TEXT,
  messages    JSONB       NOT NULL DEFAULT '[]'::JSONB,
  receipts    JSONB       NOT NULL DEFAULT '{}'::JSONB,
  iteration   INTEGER     NOT NULL DEFAULT 0,
  status      TEXT        NOT NULL DEFAULT 'open', -- open | in_progress | resolved | escalated
  problem_class TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reply_target TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS receipts JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE sessions ALTER COLUMN status SET DEFAULT 'active';
UPDATE sessions
SET status = 'active'
WHERE status IN ('open', 'in_progress')
   OR status IS NULL;

-- Optimistic concurrency version counter
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- ─── HITL Approval Queue ──────────────────────────────────────────────────────
-- Stores pending Tier-3 actions waiting for human approval.
CREATE TABLE IF NOT EXISTS approval_queue (
  id          SERIAL      PRIMARY KEY,
  session_id  TEXT        NOT NULL REFERENCES sessions(id),
  command     TEXT        NOT NULL,
  target_host TEXT        NOT NULL,
  rationale   TEXT,
  tool_call_id TEXT,       -- LLM tool_call_id for clean resume
  status      TEXT        NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS approval_queue_status_idx ON approval_queue (status);
CREATE INDEX IF NOT EXISTS approval_queue_session_idx ON approval_queue (session_id);

-- ─── Registered Servers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servers (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  ip TEXT NOT NULL,
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_port INTEGER NOT NULL DEFAULT 22,
  active BOOLEAN NOT NULL DEFAULT true,
  added_at TIMESTAMPTZ DEFAULT NOW()
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
  account_id  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_log_account_period
    ON usage_log (account_id, created_at DESC);

-- ─── Fix Memory (Semantic Vector Level 2) ───────────────────────────────────
-- Stores past problems and solutions to bootstrap LLM debugging.
-- Uses Voyage AI embeddings + pgvector for semantic similarity search.
CREATE TABLE IF NOT EXISTS fix_memory (
  id            SERIAL      PRIMARY KEY,
  issue_text    TEXT        NOT NULL,
  fix_command   TEXT        NOT NULL,
  problem_class TEXT        NOT NULL,
  embedding     vector(768),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fix_memory_embedding_idx
  ON fix_memory USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_fix_memory_problem_class
  ON fix_memory(problem_class);

CREATE INDEX IF NOT EXISTS idx_fix_memory_created_at
  ON fix_memory(created_at DESC);

-- ─── Multi-Tenant Users ────────────────────────────────────────────────────────
-- Each user authenticating via Slack/Telegram has their own Cloudstick credentials.
CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL PRIMARY KEY,
  platform              TEXT NOT NULL,         -- 'slack' or 'telegram'
  platform_id           TEXT NOT NULL UNIQUE, -- Slack user ID (U...) or Telegram numeric ID
  cloudstick_api_key    TEXT,
  cloudstick_api_secret TEXT,
  cloudstick_user_id    TEXT,
  ssh_private_key       TEXT,                  -- AES-256-GCM encrypted
  ssh_public_key        TEXT,
  setup_at              TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  -- Gateway fields
  cloudstick_account_id TEXT UNIQUE,
  slack_user_id         TEXT UNIQUE,
  slack_workspace_id    TEXT,
  plan_tier             TEXT NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter', 'pro', 'business')),
  plan_updated_at       TIMESTAMPTZ,
  UNIQUE (platform, platform_id)
);

CREATE INDEX IF NOT EXISTS users_platform_idx ON users (platform);
CREATE INDEX IF NOT EXISTS users_platform_id_idx ON users (platform_id);

-- ─── Dynamic Tool Registry ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tools (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT,
  schema      JSONB,
  tier        INTEGER     DEFAULT 1,
  enabled     BOOLEAN     DEFAULT true,
  tenant_id   UUID        REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tools_tenant ON tools (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tools_enabled ON tools (enabled);
