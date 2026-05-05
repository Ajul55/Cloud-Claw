# Cloud-Claw — Docker Deploy to Cloudstick Production Server

**Source VPS (already has the code):** `155.138.223.219`
**Target:** `<cs-prod-ip>` (Cloudstick production server — get the IP from the panel)

All `scp` commands run **from the source VPS**, not your local machine.

---

## Step 0 — Export existing DB data (from source VPS)

The current deployment on `155.138.223.219` has live data. Dump it before moving.

```bash
# On 155.138.223.219 — dump the running Postgres container
docker exec cloudclaw-db pg_dump -U cloudclaw cloudclaw > /opt/cloudclaw/cloudclaw-backup.sql
```

Keep this file — you'll restore it in Step 10.

---

## Step 1 — SSH into the target server

```bash
# From 155.138.223.219
ssh root@<cs-prod-ip>
```

Check Docker is installed:

```bash
docker --version
docker compose version
```

If missing:

```bash
curl -fsSL https://get.docker.com | sh
```

---

## Step 2 — Check for conflicts on the target

```bash
docker ps
ss -tlnp | grep -E '9000|3001'
docker ps | grep redis
```

If Redis is already running, note its container name — you can skip running our own in Step 8.

---

## Step 3 — Create the app directory

```bash
mkdir -p /opt/cloudclaw/keys
```

---

## Step 4 — Copy files from the source VPS

**On `155.138.223.219`**, copy the compose files and env template to the target:

```bash
scp /opt/cloudclaw/docker-compose.yml root@<cs-prod-ip>:/opt/cloudclaw/
scp /opt/cloudclaw/docker-compose.prod.yml root@<cs-prod-ip>:/opt/cloudclaw/
scp /opt/cloudclaw/.env.docker.example root@<cs-prod-ip>:/opt/cloudclaw/
```

---

## Step 5 — Create the .env file on the target

```bash
# On the target server
cd /opt/cloudclaw
cp .env.docker.example .env
nano .env
```

Minimum values to fill in:

```env
# Database — hostname must stay "postgres" (internal Docker name)
DATABASE_URL=postgresql://cloudclaw:CHANGE_ME@postgres:5432/cloudclaw
POSTGRES_PASSWORD=CHANGE_ME          # must match above

REDIS_URL=redis://redis:6379         # change if reusing existing Redis (see Step 2)

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_USER_ID=U...

# LLM
LLM_PROVIDER=minimax
LLM_MODEL=MiniMax-M2.7
LLM_API_BASE=https://api.minimaxi.chat/v1
LLM_API_KEY=your_key

# Cloudstick
CLOUDSTICK_API_BASE=https://api.cloudstick.io
CLOUDSTICK_API_KEY=cs_live_...
CLOUDSTICK_API_SECRET=
CLOUDSTICK_USER_ID=

# Security keys — generate on the target server:
#   openssl rand -hex 32   (run twice)
ENCRYPTION_KEY=
CLOUDSTICK_GATEWAY_KEY=
```

---

## Step 6 — Copy SSH keys

**On `155.138.223.219`**, copy the keys to the target:

```bash
scp /opt/cloudclaw/keys/id_rsa root@<cs-prod-ip>:/opt/cloudclaw/keys/id_rsa
scp /opt/cloudclaw/keys/id_rsa.pub root@<cs-prod-ip>:/opt/cloudclaw/keys/id_rsa.pub
```

Lock down permissions on the target:

```bash
chmod 600 /opt/cloudclaw/keys/id_rsa
```

---

## Step 7 — Login to GitHub Container Registry

The image is private. Create a GitHub Personal Access Token (classic) with `read:packages` scope at https://github.com/settings/tokens, then:

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u ajul55 --password-stdin
```

---

## Step 8 — (Optional) Remove Redis if one already exists

If Step 2 found a running Redis, edit `/opt/cloudclaw/docker-compose.yml` on the target:

- Delete the `redis:` service block
- Delete `redis-data:` from the `volumes:` section
- Delete `redis` from `cloudclaw depends_on`
- Set `REDIS_URL=redis://EXISTING_CONTAINER_NAME:6379` in `.env`

---

## Step 9 — Pull and start

```bash
cd /opt/cloudclaw

CLOUDCLAW_IMAGE=ghcr.io/ajul55/cloud-claw:latest \
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
up -d --pull always
```

This starts 3 containers: `cloudclaw-db` (Postgres), `cloudclaw-redis`, `cloudclaw-app`.

Watch startup logs:

```bash
docker compose logs -f cloudclaw
```

---

## Step 10 — Restore DB data

The schema is auto-applied on first boot. Wait for containers to be healthy, then restore the dump:

```bash
# Copy the dump from source VPS to target first
# On 155.138.223.219:
scp /opt/cloudclaw/cloudclaw-backup.sql root@<cs-prod-ip>:/opt/cloudclaw/

# On the target server — restore
docker exec -i cloudclaw-db psql -U cloudclaw cloudclaw < /opt/cloudclaw/cloudclaw-backup.sql
```

> If the schema was already applied and restore conflicts, run this first to wipe and retry:
> `docker compose down -v && docker compose ... up -d`
> Then restore the dump before the app connects.

---

## Step 11 — Verify

```bash
# All 3 containers should show healthy
docker ps

# Health endpoint
curl http://localhost:9000/health

# Dashboard
curl http://localhost:3001

# Spot-check DB data came across
docker exec cloudclaw-db psql -U cloudclaw -d cloudclaw -c "SELECT count(*) FROM sessions;"
```

---

## Step 12 — Update auto-deploy secrets (optional)

If CI/CD is set up, update the deploy target in **repo → Settings → Secrets → Actions**:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | `<cs-prod-ip>` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | private key with SSH access to the new server |

---

## Known issue

The Cloudstick API (`cs_live_...` Bearer token) returns "Invalid token" on staging. This is a **backend team issue** — JWT algorithm mismatch. Nothing to fix here.
