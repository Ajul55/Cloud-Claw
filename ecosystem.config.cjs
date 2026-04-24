/**
 * PM2 Configuration — Cloud-Claw
 *
 * Runs 1 Node.js process via PM2.
 *
 * WHY instances: 1 (not 2):
 *   The HTTP gateway uses an in-memory SSE event bus (sessionBus Map in
 *   src/interfaces/http_gateway.ts) and an in-memory session limiter
 *   (src/services/session_limiter.ts). With 2 workers, a POST /api/chat
 *   request may land on Worker 1 (creating the emitter there) while the
 *   SSE GET /api/chat/:id/stream request lands on Worker 2 (where the
 *   emitter doesn't exist), causing the stream to hang silently forever.
 *   Keep at 1 until the event bus is moved to Redis pub/sub (Phase 5).
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload ecosystem.config.cjs   # zero-downtime restart
 *   pm2 logs cloudclaw
 */

module.exports = {
    apps: [{
        name: 'cloudclaw',
        script: 'dist/src/index.js',
        instances: 1,              // 1 process — see comment above re: in-memory SSE bus
        exec_mode: 'fork',         // fork mode; cluster with 1 instance adds no benefit
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 3000,
        max_memory_restart: '1024M', // restart if memory leaks
        watch: false,
        env: {
            NODE_ENV: 'development',
        },
        env_production: {
            NODE_ENV: 'production',
        },
    }],
};
