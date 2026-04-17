/**
 * PM2 Cluster Configuration — Cloud-Claw
 *
 * Runs 2 Node.js processes behind PM2's built-in load balancer.
 * Session state lives in PostgreSQL so any process can handle any request.
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
        instances: 2,              // 2 processes, not CPU count
        exec_mode: 'cluster',      // share one port, load balance
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 3000,
        max_memory_restart: '512M', // restart if memory leaks
        watch: false,
        env: {
            NODE_ENV: 'development',
        },
        env_production: {
            NODE_ENV: 'production',
        },
    }],
};
