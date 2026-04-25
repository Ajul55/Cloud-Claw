-- Local development seed data — do NOT run in production.
-- Replace IPs with your own servers before running.
-- Usage: psql -U cloudclaw -d cloudclaw -f src/database/seed.sql

INSERT INTO servers (label, ip, ssh_user, ssh_port) VALUES
  ('production', '139.84.130.63', 'root', 22),
  ('test',       '65.20.83.180',  'root', 22)
ON CONFLICT (label) DO NOTHING;
