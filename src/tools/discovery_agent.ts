/**
 * Tool: discovery_agent
 *
 * SSH into a target server and walk the WordPress hosting stack:
 *   Nginx → PHP-FPM pool → MySQL database
 *
 * Populates the causality_map table with the discovered topology.
 */

import { env } from '../config/env.js';
import { upsertCausalityRecord } from '../database/db.js';
import { sshExec, sanitizeDomain } from '../utils/ssh.js';
import type { Tool, ToolResult } from './types.js';

// ─── Discovery logic ──────────────────────────────────────────────────────────

interface DiscoveryResult {
    domain: string;
    vhost_path: string | null;
    php_pool: string | null;
    db_name: string | null;
    mysql_host: string | null;
    nginx_version: string | null;
    php_version: string | null;
    extra_meta: Record<string, unknown>;
}

async function discoverStack(
    host: string,
    domain: string
): Promise<DiscoveryResult> {
    domain = sanitizeDomain(domain);

    const result: DiscoveryResult = {
        domain,
        vhost_path: null,
        php_pool: null,
        db_name: null,
        mysql_host: null,
        nginx_version: null,
        php_version: null,
        extra_meta: {},
    };

    // Parallelize the independent SSH calls
    const [nginxResult, vhostResult, phpResult] = await Promise.allSettled([
        sshExec(host, 'nginx-cs -v 2>&1 | head -1'),
        sshExec(host, `grep -rl "server_name.*${domain}" /etc/nginx-cs/vhosts.d/ /etc/nginx-cs/vhosts.d/*.d/ 2>/dev/null | head -1`),
        sshExec(host, 'php -r "echo phpversion();" 2>/dev/null || php --version 2>/dev/null | head -1')
    ]);

    // 1. Map Nginx version
    if (nginxResult.status === 'fulfilled') {
        result.nginx_version = nginxResult.value.replace('nginx version: ', '').trim();
    } else {
        result.extra_meta['nginx_error'] = 'Could not determine nginx version';
    }

    // 2. Map Vhost config
    if (vhostResult.status === 'fulfilled' && vhostResult.value) {
        result.vhost_path = vhostResult.value;

        // 3. Find PHP-FPM socket/pool referenced in vhost
        try {
            const phpFpmLine = await sshExec(
                host,
                `grep -i "fastcgi_pass\\|php-fpm\\|php.*sock" "${result.vhost_path}" 2>/dev/null | head -1`
            );

            // Extract pool name from socket path: /run/php/php8.x-fpm-<pool>.sock
            const poolMatch = phpFpmLine.match(/php[\d.]*-fpm[.-]?([^./\s"']+)\.sock/i);
            if (poolMatch) {
                result.php_pool = poolMatch[1];
            } else {
                result.php_pool = phpFpmLine.trim() || null;
            }
        } catch (_) {
            result.extra_meta['vhost_pool_error'] = 'Could not extract PHP-FPM pool from vhost';
        }
    } else {
        result.extra_meta['vhost_error'] = 'Could not locate vhost config';
    }

    // 4. Map PHP version
    if (phpResult.status === 'fulfilled') {
        result.php_version = phpResult.value.split(' ')[1]?.trim() ?? phpResult.value.split('\n')[0];
    } else {
        result.extra_meta['php_error'] = 'Could not determine PHP version';
    }

    // 5. WordPress wp-config.php — extract DB credentials
    try {
        const wpConfigPath = await sshExec(
            host,
            `find /var/www -name "wp-config.php" 2>/dev/null | grep -i "${domain.split('.')[0]}" | head -1`
        );

        if (wpConfigPath) {
            result.extra_meta['wp_config'] = wpConfigPath;

            const dbName = await sshExec(
                host,
                `grep "DB_NAME" "${wpConfigPath}" | awk -F"'" '{print $4}' 2>/dev/null`
            );
            const dbHost = await sshExec(
                host,
                `grep "DB_HOST" "${wpConfigPath}" | awk -F"'" '{print $4}' 2>/dev/null`
            );

            result.db_name = dbName || null;
            result.mysql_host = dbHost || 'localhost';
        }
    } catch (_) {
        result.extra_meta['wp_error'] = 'Could not read wp-config.php';
    }

    return result;
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const discoveryAgentTool: Tool = {
    name: 'discovery_agent',
    description:
        'SSH into a target server and map the WordPress hosting stack for a given domain. ' +
        'Discovers: Nginx config, PHP-FPM pool, MySQL database name, and PHP version. ' +
        'Persists the topology as a Causality Map record in the database. ' +
        'CRITICAL: If the user does not provide the host IP, domain, or client_id in their prompt, you MUST NOT guess or invent them. You must ask the user for the missing values instead of calling this tool.',
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: 'IP address or hostname of the target server. Do NOT guess this if missing.',
            },
            domain: {
                type: 'string',
                description: 'The domain to investigate (e.g. example.com). Do NOT guess this if missing.',
            },
            client_id: {
                type: 'string',
                description: 'Unique identifier for the client (e.g. customer name or ID). Do NOT guess this if missing.',
            },
        },
        required: ['host', 'domain', 'client_id'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const host = String(args.host);
        const domain = String(args.domain);
        const client_id = String(args.client_id);

        if (!host || !domain || !client_id) {
            return {
                success: false,
                output: 'Error: host, domain, and client_id are all required.',
            };
        }

        try {
            console.log(`[discovery_agent] Starting discovery: ${domain} on ${host}`);
            const discovered = await discoverStack(host, domain);

            // Persist to causality_map
            const record = await upsertCausalityRecord({
                client_id,
                domain: discovered.domain,
                vhost_path: discovered.vhost_path,
                php_pool: discovered.php_pool,
                db_name: discovered.db_name,
                mysql_host: discovered.mysql_host,
                nginx_version: discovered.nginx_version,
                php_version: discovered.php_version,
                extra_meta: discovered.extra_meta,
            });

            const summary = [
                `✅ Discovery complete for ${domain} (${host})`,
                ``,
                `📊 Causality Map (ID: ${record.id}):`,
                `  • Nginx:      ${discovered.nginx_version ?? 'unknown'}`,
                `  • Vhost:      ${discovered.vhost_path ?? 'not found'}`,
                `  • PHP:        ${discovered.php_version ?? 'unknown'}`,
                `  • PHP-FPM:    ${discovered.php_pool ?? 'not found'}`,
                `  • DB Name:    ${discovered.db_name ?? 'not found'}`,
                `  • MySQL Host: ${discovered.mysql_host ?? 'unknown'}`,
            ].join('\n');

            return { success: true, output: summary, data: record };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[discovery_agent] Error:`, message);
            return {
                success: false,
                output: `❌ Discovery failed for ${domain} on ${host}: ${message}`,
            };
        }
    },
};
