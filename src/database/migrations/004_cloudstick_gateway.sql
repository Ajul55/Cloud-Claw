-- src/database/migrations/004_cloudstick_gateway.sql
-- Cloudstick gateway integration: per-account identity + plan tier

ALTER TABLE users ADD COLUMN IF NOT EXISTS cloudstick_account_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_user_id          TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_workspace_id     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier              TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at        TIMESTAMPTZ;
