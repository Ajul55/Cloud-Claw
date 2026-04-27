# ─── Stage 1: Backend dependency install ─────────────────────────────────────
# Separate stage so backend deps only re-install when package*.json changes
FROM node:22-alpine AS backend-deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


# ─── Stage 2: Dashboard dependency install ───────────────────────────────────
# Runs IN PARALLEL with Stage 1 (BuildKit builds independent stages concurrently)
FROM node:22-alpine AS dashboard-deps

WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci


# ─── Stage 3: Build backend (TypeScript → JS) ────────────────────────────────
FROM backend-deps AS backend-build

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc


# ─── Stage 4: Build dashboard (Vite → static assets) ────────────────────────
# Runs IN PARALLEL with Stage 3
FROM node:22-alpine AS dashboard-build

WORKDIR /app
# Need backend node_modules for shared types/config if dashboard imports from parent
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=dashboard-deps /app/dashboard/node_modules ./dashboard/node_modules
COPY package.json ./
COPY dashboard/ ./dashboard/
RUN cd dashboard && npm run build


# ─── Stage 5: Production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS production

# System deps: openssh for SSH CA, tini for PID 1
RUN apk add --no-cache openssh-client tini

# PM2 for process management
RUN npm install -g pm2

WORKDIR /app

# Production-only node_modules (no devDependencies)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled backend from Stage 3
COPY --from=backend-build /app/dist/ ./dist/

# Copy built dashboard from Stage 4 (Vite outputs to ../dist/public → /app/dist/public/)
COPY --from=dashboard-build /app/dist/public/ ./dist/public/

# Copy PM2 config and database schema
COPY ecosystem.config.cjs ./
COPY src/database/schema.sql ./src/database/schema.sql

# Create directories for SSH keys and temp certs
RUN mkdir -p /app/keys /tmp/cloudclaw-certs \
    && chown -R node:node /app /tmp/cloudclaw-certs

# Non-root user
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:9000/health || exit 1

EXPOSE 9000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pm2-runtime", "start", "ecosystem.config.cjs", "--env", "production"]
