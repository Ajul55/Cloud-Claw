# Cloudstick API v2 — Migration & Integration Tracker

---

## Phase 1 — Fix Breaking Changes
> Nothing works correctly until these are done. Zero new features before this phase is complete.

| # | Task | Status |
|---|------|--------|
| 1.1 | **Auth: switch from APIKey/APISecret to JWT Bearer token** — implement login flow (`POST /users/login/`), token storage, and auto-refresh (`POST /users/refresh-token/`) | ✅ Done |
| 1.2 | **Base URL: remove hardcoded `https://api.cloudstick.io` default** — make `CLOUDSTICK_API_BASE` required (no silent fallback) in `env.ts` and `cloudstick_client.ts` | ✅ Done |
| 1.3 | **Fix reversed "details" URL patterns** (6 methods) — `getLaravelDetails`, `getProxyAppDetails`, `getWooCommerceDetails`, `getPrestashopDetails`, `getPhpMyAdminDetails`, `getMediaWikiDetails` | ✅ Done |
| 1.4 | **Fix FTP scope** — `/ftp/servers/:sid/` → `/ftp/websites/:wid/servers/:sid/` | ✅ Done |
| 1.5 | **Fix website cron prefix** — `/cronjobs/websites/` → `/cron/websites/` | ✅ Done |
| 1.6 | **Fix PHP CLI path** — `/php/cli-version/servers/` → `/phpcli/servers/` | ✅ Done |
| 1.7 | **Fix auto-update path + method** — `POST /autoupdate/` → `PATCH /update/packages/servers/` | ✅ Done |
| 1.8 | **Fix cleanup method** — `POST /cleanup/` → `PATCH /cleanup/` | ✅ Done |
| 1.9 | **Fix permissions paths** — `/permissions` → `/permissions/users/:uid`, `/permissions/roles` → `/permissions/roles/users/:uid` | ✅ Done |

---

## Phase 2 — High-Value New Endpoints
> Core operations that Cloud Claw users will hit daily.

| # | Task | Status |
|---|------|--------|
| 2.1 | **Website: suspend / unsuspend** — `PATCH /suspend/websites/` + `PATCH /unsuspend/websites/` | ✅ Done |
| 2.2 | **Website: change stack** — `PATCH /changestack/websites/` (nginx ↔ apache) | ✅ Done |
| 2.3 | **Website: change public path** — `PATCH /changepublicpath/websites/` | ✅ Done |
| 2.4 | **Website: change PHP config** — `PATCH /changephpconfig/websites/` | ✅ Done |
| 2.5 | **Website: rebuild** — `PATCH /rebuild/websites/` | ✅ Done |
| 2.6 | **Website: nginx + apache logs** — `GET /nginx-logs/websites/` + `GET /apache-logs/websites/` | ✅ Done |
| 2.7 | **Website: list all websites (all servers)** — `GET /list/allwebsites/users/:uid` | ✅ Done |
| 2.8 | **Service management** — `GET/PATCH /service/servers/:sid/users/:uid` (start/stop nginx, mysql, etc.) | ✅ Done |
| 2.9 | **Server: filtered activity log** — `GET /list-activity/filter/servers/:sid/users/:uid` | ✅ Done |
| 2.10 | **Server: list all servers (admin)** — `GET /listallservers/users/:uid` | ✅ Done |

---

## Phase 3 — SSH, Security & Infrastructure
> Operational tooling for managing server access and hardening.

| # | Task | Status |
|---|------|--------|
| 3.1 | **SSH vault** — `GET/POST /sshvault/users/:uid` + `DELETE /sshvault/:key/users/:uid` | ⬜ Todo |
| 3.2 | **SSH keys on server** — `GET/POST /servers/:sid/users/:uid/sshkey` + `DELETE /sshkey/:key` | ⬜ Todo |
| 3.3 | **SSH config** — `GET/POST /sshconfig/servers/:sid/users/:uid` | ⬜ Todo |
| 3.4 | **Hostname SSL** — full cert management on server hostname (free + custom, renew, remove) | ✅ Done |
| 3.5 | **PHP version management (global)** — list/add/remove PHP versions per user + install on server | ✅ Done |
| 3.6 | **PHP extensions (global)** — `GET/POST/DELETE /php-extension/users/:uid` + status toggle | ✅ Done |
| 3.7 | **CSF: country block lists** — `GET/POST /csf/countries/servers/:sid/users/:uid` | ✅ Done |
| 3.8 | **CSF: IP lists** — whitelist, blacklist, ignorelist, deny IPs, temp allow/deny/drop | ✅ Done |
| 3.9 | **CSF: input/output ports** — manage allowed ports | ✅ Done |
| 3.10 | **Agent version** — `GET/POST /users/:uid/agent_version` + `PATCH /servers/:sid/users/:uid/update_agent_version` | ✅ Done |

---

## Phase 4 — Git Integration
> Enable deploy-from-repo workflows.

| # | Task | Status |
|---|------|--------|
| 4.1 | **List projects** — GitLab, GitHub, Bitbucket (`GET /users/:uid/projects/list/{provider}`) | ✅ Done |
| 4.2 | **List branches** — per project per provider | ✅ Done |
| 4.3 | **Git SSH key per server** — `GET /users/:uid/servers/:sid/git/sshkey` | ✅ Done |
| 4.4 | **OAuth token exchange** — `GET /exchange/token` | ✅ Done |

---

## Phase 5 — Backup (Extended)
> Fill in the gaps from the v1 backup API.

| # | Task | Status |
|---|------|--------|
| 5.1 | **Backup plans CRUD** — `GET/POST /backup-plans/users/:uid` + update/delete | ✅ Done |
| 5.2 | **Backup settings** — periods, manual retention, enable/disable, storage size | ✅ Done |
| 5.3 | **Backup plan purchase** — plan buy, cancel, upgrade, verify payment | ✅ Done |
| 5.4 | **Backup archive + activity log** — `GET /backup/archive/` + `GET /backup/activity/` | ✅ Done |
| 5.5 | **Website-level backup files** — `GET /backup/files/websites/:wid/users/:uid` | ✅ Done |
| 5.6 | **Database-level backup files** — `GET /backup/files/databases/:dbid/users/:uid` | ✅ Done |

---

## Phase 6 — Server Provisioning & Datacenter
> Buy and provision servers from inside Cloud Claw.

| # | Task | Status |
|---|------|--------|
| 6.1 | **Server transfer** — `POST /transfer/servers/:sid/users/:uid` + confirm + reject | ⬜ Todo |
| 6.2 | **Add server by IP** — `POST /serverbyip/users/:uid` + Linode variant | ⬜ Todo |
| 6.3 | **Server purchase flow** — `POST /users/:uid/servers/purchase` + verify | ⬜ Todo |
| 6.4 | **Datacenter management** — list regions, CRUD datacenters (admin + client) | ⬜ Todo |
| 6.5 | **Vultr integration** — list regions + server options | ⬜ Todo |
| 6.6 | **Installation logs WS** — `/ws/api/v2/users/:uid/servers/installationlogs` | ⬜ Todo |

---

## Phase 7 — Support Ticket System
> Full in-app support workflow.

| # | Task | Status |
|---|------|--------|
| 7.1 | **Customer: create + list tickets** — `GET/POST /customer/:uid/support_ticket` | ⬜ Todo |
| 7.2 | **Customer: ticket details + messages** — view ticket, add message, set priority | ⬜ Todo |
| 7.3 | **Customer: overview** — `GET /customer/:uid/support_ticket/Overview` | ⬜ Todo |
| 7.4 | **Staff: ticket management** — status, priority, assignee, notes, impersonation | ⬜ Todo |
| 7.5 | **WebSocket live updates** — per-ticket WS for customer + staff | ⬜ Todo |

---

## Phase 8 — WordPress Templates & Advanced App Features
> Marketplace and extended app-type management.

| # | Task | Status |
|---|------|--------|
| 8.1 | **WP templates** — list themes/plugins, create/list/update/delete templates | ⬜ Todo |
| 8.2 | **WP subdomain management** — `POST /wordpress/subdomain/websites/` + delete | ⬜ Todo |
| 8.3 | **CustomPHP: clone + subdomain** — `POST /customphp/clone/` + subdomain CRUD | ⬜ Todo |
| 8.4 | **ProxyApp subdomain** — `POST/DELETE /proxyapp/subdomain/websites/` | ⬜ Todo |
| 8.5 | **WhiteLabel app** — full CRUD `GET/POST /whitelabel/servers/` + details + delete | ⬜ Todo |
| 8.6 | **phpMyAdmin DB login** — `POST /phpmyadmin/database/login/` + app-level login | ⬜ Todo |

---

## Phase 9 — Business, Billing & Search
> Admin/white-label operational features.

| # | Task | Status |
|---|------|--------|
| 9.1 | **Business setup** — company info CRUD + primary/secondary logo upload | ⬜ Todo |
| 9.2 | **Invoices** — `GET /invoice/users/:uid` + invoice details | ⬜ Todo |
| 9.3 | **Search** — `GET /search/users/:uid` + sync + rebuild index | ⬜ Todo |
| 9.4 | **Microsoft OAuth** — `/auth/microsoft/start` + callback | ⬜ Todo |

---

## Status Legend
| Symbol | Meaning |
|--------|---------|
| ⬜ | Todo |
| 🔄 | In Progress |
| ✅ | Done |
| ❌ | Blocked |
| ⏭️ | Skipped / Not needed |
