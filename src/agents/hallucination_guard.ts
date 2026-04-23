import { hasReceipt, type ToolReceipt } from './loop.js';

// Tools that can CHANGE server state (writes, restarts, config edits)
const WRITE_RECEIPTS = [
    'fix_nginx_config', 'execute_ssh_write', 'manage_php', 'repair_mysql',
    'renew_ssl', 'cleanup_disk', 'fix_wordpress', 'create_nginx_vhost',
    'cloudflare_cache_purge',
    // Phase 2.5: User management
    'create_system_user', 'delete_system_user', 'change_system_user_password',
    'create_database_user', 'delete_database_user', 'change_database_user_password',
    // Phase 3: Full API surface
    'issue_ssl', 'renew_ssl_api', 'delete_ssl', 'update_ssl_settings',
    'create_database', 'delete_database',
    'switch_php_api',
    'emergency_service_restart',
    // Phase 4: Cron
    'create_cron_job', 'delete_cron_job',
    // Phase 5: Website/DNS management
    'manage_website_settings', 'manage_cloudflare_dns',
    // Phase 6: Insomnia-confirmed tools
    'update_mysql_root_password', 'toggle_mysql_remote_access',
    'delete_email_account', 'update_email_password', 'update_email_quota',
    'create_email_forward',
    'grant_database_privilege', 'revoke_database_privilege', 'remove_user_from_database',
    'update_sudo_permission',
    'apply_security_headers',
];

// Tools that only READ server state (diagnostics, status checks)
const READ_RECEIPTS = [
    'diagnose_nginx', 'diagnose_services', 'diagnose_domain',
    'execute_ssh_command', 'check_ssl', 'check_ssl_api',
    'list_cron_jobs',
    'get_cloudstick_servers', 'get_cloudstick_websites',
    'get_server_details', 'get_wordpress_details',
    // Phase 6: Insomnia-confirmed read tools
    'get_mysql_status', 'list_email_accounts', 'list_email_forwards',
    'get_email_config', 'list_database_users_server',
    'get_server_activity', 'list_website_subdomains',
];

interface HallucinationPattern {
    pattern: RegExp;
    /** If true, only a WRITE receipt can justify this claim */
    requiresWriteReceipt?: boolean;
    /** If set, only receipts for these specific tools satisfy it (READ or WRITE) */
    requiresTool?: string;
}

export function checkForHallucination(
    text: string,
    executionReceipts: Map<string, ToolReceipt>,
    freshnessMs: number,
    currentHost?: string
): boolean {
    const hallucinationPatterns: HallucinationPattern[] = [
        // ─── Service state claims — require a WRITE receipt ──────────────
        { pattern: /(nginx|mariadb|mysql|apache|php|redis|postgres) is (now |currently )?(active|running|up|fixed|resolved)/i, requiresWriteReceipt: true },
        { pattern: /fix (was|has been) applied/i, requiresWriteReceipt: true },
        { pattern: /configuration (has been|was) (successfully |)repaired/i, requiresWriteReceipt: true },
        { pattern: /(service|nginx|mariadb|mysql) has been restarted/i, requiresWriteReceipt: true },
        { pattern: /issue (has been|is now|was) (resolved|fixed|solved)/i, requiresWriteReceipt: true },
        { pattern: /successfully (restarted|repaired|resolved|fixed|applied)/i, requiresWriteReceipt: true },
        { pattern: /i (have|'ve) (applied|fixed|repaired|restarted|resolved)/i, requiresWriteReceipt: true },

        // ─── Phase 3/4 claims — require specific WRITE receipts ─────────
        { pattern: /ssl (certificate|cert).*(issued|renewed|installed|provisioned)/i, requiresWriteReceipt: true },
        { pattern: /database.*(created|deleted|removed|dropped)/i, requiresWriteReceipt: true },
        { pattern: /php.*(switched|changed|upgraded|downgraded) to/i, requiresWriteReceipt: true },
        { pattern: /cron job.*(created|added|deleted|removed)/i, requiresWriteReceipt: true },
        { pattern: /system user.*(created|deleted|removed)/i, requiresWriteReceipt: true },
        { pattern: /database user.*(created|deleted|removed)/i, requiresWriteReceipt: true },

        // ─── SSH key claims — never valid (blocked by security) ──────────
        { pattern: /ssh.*key.*(added|appended|installed|written)/i },

        // ─── Planning language — always a hallucination signal ───────────
        { pattern: /steps taken:/i },
        { pattern: /outcome:/i },
        { pattern: /please (give me a moment|allow me a moment|wait while)/i },
        { pattern: /i('ll| will) now (apply|run|execute|perform|initiate)/i },
        { pattern: /let me (now |)(run|execute|apply|check|diagnose)/i },
        { pattern: /i('ll| will) (start|begin) by/i },

        // ─── Phase 4: Additional false-positive reduction ────────────────
        { pattern: /i('ve| have) already (configured|set up|deployed|provisioned)/i, requiresWriteReceipt: true },
        { pattern: /changes? (have been|has been) saved/i, requiresWriteReceipt: true },
    ];

    return hallucinationPatterns.some(({ pattern, requiresWriteReceipt, requiresTool: req }) => {
        if (!pattern.test(text)) return false;

        if (requiresWriteReceipt) {
            if (currentHost) {
                // Host-aware: only a write receipt for this specific host satisfies the claim
                const hasHostReceipt = [...executionReceipts.values()].some(
                    r => WRITE_RECEIPTS.includes(r.toolName) &&
                         r.host === currentHost &&
                         r.success &&
                         (Date.now() - r.timestamp) < freshnessMs
                );
                return !hasHostReceipt;
            }
            // No host context — host-agnostic fallback
            return !hasReceipt(executionReceipts, WRITE_RECEIPTS, true, freshnessMs);
        }

        if (req) {
            return !hasReceipt(executionReceipts, [req], true, freshnessMs);
        }

        return true; // planning language or SSH key claims — always flag
    });
}
