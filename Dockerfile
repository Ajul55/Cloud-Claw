# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy backend dependency manifests first (layer cache optimization)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy dashboard dependency manifests and install
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN cd dashboard && npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY ecosystem.config.cjs ./
COPY dashboard/ ./dashboard/

# Compile TypeScript → dist/ and build React dashboard → dist/public/
RUN npm run build && npm run build:dashboard


# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:24-alpine AS production

# Install system dependencies needed at runtime:
#   openssh-client  → ssh-keygen (for SSH CA cert signing) + ssh (for ssh2 key handling)
#   tini            → proper PID 1 signal handling in containers
RUN apk add --no-cache openssh-client tini

# Install PM2 globally for cluster mode
RUN npm install -g pm2

# The node user (UID 1000) already exists in node:alpine.
# We will use this user to match typical host UID for volume permissions.

WORKDIR /app

# Copy dependency manifests and install production-only deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist/ ./dist/

# Copy PM2 ecosystem config
COPY ecosystem.config.cjs ./

# Copy database schema for initialization
COPY src/database/schema.sql ./src/database/schema.sql

# Create directories for SSH keys and temp certs
RUN mkdir -p /app/keys /tmp/cloudclaw-certs \
    && chown -R node:node /app /tmp/cloudclaw-certs

# Switch to non-root user
USER node

# Health check — uses the /health endpoint from src/health.ts
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:9000/health || exit 1

# Expose health check port
EXPOSE 9000

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start PM2 in runtime mode (foreground, Docker-aware)
CMD ["pm2-runtime", "start", "ecosystem.config.cjs", "--env", "production"]
