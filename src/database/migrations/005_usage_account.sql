-- src/database/migrations/005_usage_account.sql
-- Phase 4: add account_id to usage_log for per-account aggregation

ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_usage_log_account_period
    ON usage_log (account_id, created_at DESC);
