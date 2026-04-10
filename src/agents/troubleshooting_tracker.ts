/**
 * Troubleshooting Tracker — Adaptive Strategy Engine
 *
 * Prevents blind retries by tracking what was tried, what failed,
 * and suggesting the next strategy from an ordered ladder.
 *
 * Integration points:
 *   loop.ts → recordAttempt() after each tool execution
 *   loop.ts → getStrategyContext() before each LLM call
 *   loop.ts → shouldEscalate() to decide when to stop and summarize
 *   loop.ts → clearSession() on new user intent
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttemptRecord {
    toolName: string;
    argsSummary: string;
    category: TroubleshootingCategory;
    strategyLabel: string;
    success: boolean;
    outputSnippet: string;
    timestamp: number;
}

export type TroubleshootingCategory =
    | 'ssl'
    | 'nginx'
    | 'database'
    | 'dns'
    | 'service'
    | 'disk'
    | 'generic';

interface StrategyStep {
    label: string;
    tools: string[];
    /** If set, only matches when args contain one of these patterns */
    argsHint?: RegExp;
    description: string;
}

// ─── Strategy Ladders ─────────────────────────────────────────────────────────
// Ordered from least invasive to most invasive. The tracker walks down the
// ladder, suggesting the next untried step after each failure.

const STRATEGY_LADDERS: Record<TroubleshootingCategory, StrategyStep[]> = {
    ssl: [
        { label: 'api_check', tools: ['check_ssl_api', 'get_ssl_configuration'], description: 'Check SSL status via Cloudstick API' },
        { label: 'dns_check', tools: ['diagnose_domain'], description: 'Verify DNS resolution and domain routing' },
        { label: 'cert_files', tools: ['execute_ssh_command'], argsHint: /ssl|cert|\.pem|\.crt|\.key|\/home\/.*\/ssl/i, description: 'Inspect certificate files on disk' },
        { label: 'nginx_ssl_config', tools: ['execute_ssh_command', 'get_nginx_config_file', 'list_nginx_config_files'], argsHint: /ssl\.conf|443|listen.*ssl/i, description: 'Check nginx SSL/TLS configuration' },
        { label: 'renewal', tools: ['renew_ssl_api', 'issue_ssl'], description: 'Attempt SSL renewal or reissue via API' },
        { label: 'firewall', tools: ['execute_ssh_command'], argsHint: /iptables|ufw|firewall|ss\s|netstat|:443|:80/i, description: 'Check firewall rules and port accessibility (80/443)' },
        { label: 'connectivity', tools: ['execute_ssh_command'], argsHint: /curl|wget|openssl\s+s_client/i, description: 'Test TLS connectivity from server (curl/openssl s_client)' },
    ],
    nginx: [
        { label: 'diagnose', tools: ['diagnose_nginx'], description: 'Run nginx diagnostics (status + config test)' },
        { label: 'config_check', tools: ['execute_ssh_command', 'get_nginx_config_file'], argsHint: /nginx|vhost|conf/i, description: 'Inspect nginx config files directly' },
        { label: 'log_check', tools: ['execute_ssh_command'], argsHint: /log|error\.log|access\.log/i, description: 'Read nginx error/access logs for clues' },
        { label: 'service_status', tools: ['diagnose_services', 'execute_ssh_command'], argsHint: /systemctl|status|php.*fpm/i, description: 'Check related services (PHP-FPM, upstream)' },
        { label: 'fix', tools: ['fix_nginx_config'], description: 'Apply config fix (requires approval)' },
        { label: 'restart', tools: ['manage_service', 'execute_ssh_write'], argsHint: /restart|reload|nginx/i, description: 'Restart nginx service (requires approval)' },
    ],
    database: [
        { label: 'status_check', tools: ['execute_ssh_command', 'diagnose_services'], argsHint: /mariadb|mysql|postgres|systemctl/i, description: 'Check database service status' },
        { label: 'log_check', tools: ['execute_ssh_command'], argsHint: /log|error|journal/i, description: 'Read database error logs' },
        { label: 'repair_diagnose', tools: ['repair_mysql'], description: 'Run MySQL diagnostic check' },
        { label: 'config_check', tools: ['execute_ssh_command'], argsHint: /my\.cnf|mariadb\.conf|innodb|buffer/i, description: 'Inspect database configuration' },
        { label: 'repair', tools: ['repair_mysql'], description: 'Run MySQL auto-repair (requires approval)' },
    ],
    dns: [
        { label: 'domain_map', tools: ['diagnose_domain'], description: 'Map DNS → nginx → backend for the domain' },
        { label: 'dns_resolve', tools: ['execute_ssh_command'], argsHint: /dig|nslookup|host\s/i, description: 'Direct DNS resolution check (dig/nslookup)' },
        { label: 'cache_check', tools: ['execute_ssh_command'], argsHint: /curl.*-I|curl.*-H|cloudflare|cf-ray/i, description: 'Check for CDN/Cloudflare cache issues' },
        { label: 'cache_purge', tools: ['cloudflare_cache_purge'], description: 'Purge Cloudflare cache (requires approval)' },
    ],
    service: [
        { label: 'status', tools: ['diagnose_services', 'execute_ssh_command'], description: 'Check service status' },
        { label: 'logs', tools: ['execute_ssh_command'], argsHint: /journal|log|systemctl.*status/i, description: 'Read service logs/journal' },
        { label: 'config', tools: ['execute_ssh_command'], argsHint: /conf|config|\.ini|\.cfg/i, description: 'Inspect service configuration' },
        { label: 'restart', tools: ['manage_service', 'execute_ssh_write'], description: 'Restart the service (requires approval)' },
    ],
    disk: [
        { label: 'overview', tools: ['execute_ssh_command', 'cleanup_disk'], argsHint: /df|free|disk|analyze/i, description: 'Disk and memory usage overview' },
        { label: 'large_files', tools: ['execute_ssh_command'], argsHint: /find.*size|du\s|sort.*-rh/i, description: 'Find large files consuming space' },
        { label: 'log_rotation', tools: ['execute_ssh_command'], argsHint: /logrotate|truncate|\/var\/log/i, description: 'Check log rotation and stale logs' },
        { label: 'cleanup', tools: ['cleanup_disk'], description: 'Clean up disk space (requires approval)' },
    ],
    generic: [
        { label: 'status', tools: ['execute_ssh_command', 'diagnose_services'], description: 'General status check' },
        { label: 'logs', tools: ['execute_ssh_command'], argsHint: /log|journal|error/i, description: 'Read relevant logs' },
        { label: 'config', tools: ['execute_ssh_command'], argsHint: /conf|config|cat\s|grep/i, description: 'Inspect configuration' },
        { label: 'targeted_fix', tools: ['execute_ssh_write'], description: 'Apply targeted fix (requires approval)' },
    ],
};

// ─── Category Detection ───────────────────────────────────────────────────────

const TOOL_CATEGORY_MAP: Record<string, TroubleshootingCategory> = {
    check_ssl_api: 'ssl',
    get_ssl_configuration: 'ssl',
    issue_ssl: 'ssl',
    renew_ssl_api: 'ssl',
    delete_ssl: 'ssl',
    update_ssl_settings: 'ssl',
    set_tls_protocol_version: 'ssl',
    set_cipher_suite: 'ssl',
    set_access_method: 'ssl',

    diagnose_nginx: 'nginx',
    fix_nginx_config: 'nginx',
    create_nginx_vhost: 'nginx',
    list_nginx_config_files: 'nginx',
    get_nginx_config_file: 'nginx',
    update_nginx_config_file: 'nginx',

    repair_mysql: 'database',
    create_database: 'database',
    delete_database: 'database',
    create_database_user: 'database',
    delete_database_user: 'database',

    diagnose_domain: 'dns',
    cloudflare_cache_purge: 'dns',

    diagnose_services: 'service',
    manage_service: 'service',

    cleanup_disk: 'disk',
};

/** Keywords in the tool args that hint at a category for generic tools like execute_ssh_command */
const ARGS_CATEGORY_HINTS: Array<{ pattern: RegExp; category: TroubleshootingCategory }> = [
    { pattern: /ssl|cert|tls|https|443|openssl|\.pem|\.crt|\.key/i, category: 'ssl' },
    { pattern: /nginx|vhost|proxy_pass|upstream/i, category: 'nginx' },
    { pattern: /mysql|mariadb|postgres|innodb|my\.cnf/i, category: 'database' },
    { pattern: /dns|dig\s|nslookup|cloudflare|domain/i, category: 'dns' },
    { pattern: /df\s|disk|du\s|\/tmp|logrotate|truncate/i, category: 'disk' },
    { pattern: /systemctl|service\s|fpm|redis|apache/i, category: 'service' },
];

export function detectCategory(
    toolName: string,
    argsStr: string,
): TroubleshootingCategory {
    // Direct tool → category mapping
    const direct = TOOL_CATEGORY_MAP[toolName];
    if (direct) return direct;

    // For generic tools (execute_ssh_command, execute_ssh_write), infer from args
    for (const { pattern, category } of ARGS_CATEGORY_HINTS) {
        if (pattern.test(argsStr)) return category;
    }

    return 'generic';
}

// ─── Strategy Matching ────────────────────────────────────────────────────────

function matchStrategy(
    category: TroubleshootingCategory,
    toolName: string,
    argsStr: string,
): string {
    const ladder = STRATEGY_LADDERS[category];
    for (const step of ladder) {
        if (!step.tools.includes(toolName)) continue;
        if (step.argsHint && !step.argsHint.test(argsStr)) continue;
        return step.label;
    }
    return 'unknown';
}

// ─── Session Store ────────────────────────────────────────────────────────────

const sessionAttempts = new Map<string, AttemptRecord[]>();

const MAX_ATTEMPTS_PER_SESSION = 30;
const ESCALATION_THRESHOLD = 5; // consecutive failures before escalation

// ─── Public API ───────────────────────────────────────────────────────────────

export function recordAttempt(
    sessionId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    success: boolean,
    output: string,
): void {
    const argsStr = JSON.stringify(toolArgs);
    const category = detectCategory(toolName, argsStr);
    const strategyLabel = matchStrategy(category, toolName, argsStr);

    const record: AttemptRecord = {
        toolName,
        argsSummary: argsStr.length > 200 ? argsStr.slice(0, 200) + '...' : argsStr,
        category,
        strategyLabel,
        success,
        outputSnippet: output.slice(0, 300).replace(/\s+/g, ' ').trim(),
        timestamp: Date.now(),
    };

    let attempts = sessionAttempts.get(sessionId);
    if (!attempts) {
        attempts = [];
        sessionAttempts.set(sessionId, attempts);
    }

    // Cap stored attempts to prevent memory leak
    if (attempts.length >= MAX_ATTEMPTS_PER_SESSION) {
        attempts.shift();
    }

    attempts.push(record);
    console.log(
        `[tracker] Recorded: ${toolName} [${category}/${strategyLabel}] success=${success}`
    );
}

/**
 * Check if any attempt (regardless of its detected category) matches a
 * strategy step. This handles cross-category tools like diagnose_domain
 * which is categorised as 'dns' but appears in the SSL ladder's dns_check step.
 */
function isStepCoveredByAttempts(step: StrategyStep, allAttempts: AttemptRecord[]): boolean {
    return allAttempts.some(a => {
        if (!step.tools.includes(a.toolName)) return false;
        if (step.argsHint && !step.argsHint.test(a.argsSummary)) return false;
        return true;
    });
}

export function getStrategyContext(sessionId: string): string | undefined {
    const attempts = sessionAttempts.get(sessionId);
    if (!attempts || attempts.length === 0) return undefined;

    const failedAttempts = attempts.filter(a => !a.success);
    if (failedAttempts.length === 0) return undefined;

    // Group failures by category
    const failuresByCategory = new Map<TroubleshootingCategory, AttemptRecord[]>();
    for (const attempt of failedAttempts) {
        const list = failuresByCategory.get(attempt.category) ?? [];
        list.push(attempt);
        failuresByCategory.set(attempt.category, list);
    }

    const lines: string[] = [];
    lines.push('TROUBLESHOOTING HISTORY — DO NOT REPEAT FAILED APPROACHES');
    lines.push('');

    for (const [category, failures] of failuresByCategory) {
        lines.push(`[${category.toUpperCase()}] — ${failures.length} failed attempt(s):`);

        // Show what was tried and what happened
        for (const f of failures.slice(-5)) { // last 5 failures in this category
            lines.push(`  ✗ ${f.toolName} (${f.strategyLabel}): ${f.outputSnippet.slice(0, 120)}`);
        }

        // Suggest next untried strategy — cross-category aware
        const ladder = STRATEGY_LADDERS[category];
        const nextStep = ladder.find(step => !isStepCoveredByAttempts(step, attempts));

        if (nextStep) {
            lines.push(`  → NEXT: Try "${nextStep.description}" using ${nextStep.tools.join(' or ')}`);
        } else {
            lines.push(`  → ALL STRATEGIES EXHAUSTED. Escalate to Pilot with a summary.`);
        }
        lines.push('');
    }

    lines.push('RULES:');
    lines.push('- Do NOT re-run a tool with the same arguments that already failed.');
    lines.push('- If the suggested next strategy requires different tool arguments, adapt them.');
    lines.push('- If all strategies are exhausted, summarize findings and ask the Pilot for guidance.');

    return lines.join('\n');
}

export function shouldEscalate(sessionId: string): boolean {
    const attempts = sessionAttempts.get(sessionId);
    if (!attempts || attempts.length === 0) return false;

    // Check consecutive failures (across all categories)
    let consecutiveFailures = 0;
    for (let i = attempts.length - 1; i >= 0; i--) {
        if (!attempts[i].success) {
            consecutiveFailures++;
        } else {
            break;
        }
    }
    if (consecutiveFailures >= ESCALATION_THRESHOLD) return true;

    // Check if any active category has exhausted all strategies (cross-category aware)
    const categoriesWithFailures = new Set(
        attempts.filter(a => !a.success).map(a => a.category)
    );

    for (const category of categoriesWithFailures) {
        const ladder = STRATEGY_LADDERS[category];
        const hasUntried = ladder.some(step => !isStepCoveredByAttempts(step, attempts));
        if (!hasUntried) return true;
    }

    return false;
}

export function getEscalationSummary(sessionId: string): string {
    const attempts = sessionAttempts.get(sessionId);
    if (!attempts || attempts.length === 0) {
        return 'No troubleshooting attempts recorded.';
    }

    const failedAttempts = attempts.filter(a => !a.success);

    const lines: string[] = [];
    lines.push(`⚠️ *Troubleshooting Summary* — tried ${attempts.length} approach(es), ${failedAttempts.length} failed\n`);

    // Group by category for clear presentation
    const categories = new Set(attempts.map(a => a.category));

    for (const category of categories) {
        const catAttempts = attempts.filter(a => a.category === category);
        lines.push(`*${category.toUpperCase()}:*`);

        for (let i = 0; i < catAttempts.length; i++) {
            const a = catAttempts[i];
            const icon = a.success ? '✅' : '❌';
            lines.push(`${i + 1}. ${icon} \`${a.toolName}\` (${a.strategyLabel}) — ${a.outputSnippet.slice(0, 150)}`);
        }
        lines.push('');
    }

    // Root cause hypothesis based on failure patterns
    const hypothesis = deriveHypothesis(attempts);
    if (hypothesis) {
        lines.push(`*Root cause hypothesis:* ${hypothesis}\n`);
    }

    lines.push('Please provide more specific instructions or investigate manually.');
    return lines.join('\n');
}

export function clearSession(sessionId: string): void {
    sessionAttempts.delete(sessionId);
    console.log(`[tracker] Cleared troubleshooting history for session: ${sessionId}`);
}

export function getAttempts(sessionId: string): AttemptRecord[] {
    return sessionAttempts.get(sessionId) ?? [];
}

export function getFailedCountInCategory(
    sessionId: string,
    category: TroubleshootingCategory,
): number {
    const attempts = sessionAttempts.get(sessionId);
    if (!attempts) return 0;
    return attempts.filter(a => a.category === category && !a.success).length;
}

// ─── Root Cause Hypothesis ────────────────────────────────────────────────────

function deriveHypothesis(attempts: AttemptRecord[]): string | null {
    const failedCategories = new Set(
        attempts.filter(a => !a.success).map(a => a.category)
    );
    const allOutputs = attempts.map(a => a.outputSnippet.toLowerCase()).join(' ');

    // SSL-specific patterns
    if (failedCategories.has('ssl')) {
        if (allOutputs.includes('timeout') || allOutputs.includes('timed out')) {
            return 'SSL operations are timing out — possible firewall blocking port 443, or DNS not pointing to this server.';
        }
        if (allOutputs.includes('invalid token') || allOutputs.includes('401') || allOutputs.includes('unauthorized')) {
            return 'API authentication is failing — check Cloudstick API credentials.';
        }
        if (allOutputs.includes('rate limit') || allOutputs.includes('too many')) {
            return 'SSL rate limit hit (Let\'s Encrypt allows ~5 certs per domain per week).';
        }
        if (allOutputs.includes('dns') || allOutputs.includes('not resolv') || allOutputs.includes('nxdomain')) {
            return 'DNS is not resolving to this server — SSL issuance requires DNS to point to the server first.';
        }
        if (allOutputs.includes('not found') && allOutputs.includes('cert')) {
            return 'Certificate files are missing on disk — may need reissue rather than renewal.';
        }
    }

    // Nginx patterns
    if (failedCategories.has('nginx')) {
        if (allOutputs.includes('permission denied')) {
            return 'Permission issue on nginx config files or log directory.';
        }
        if (allOutputs.includes('conflict') || allOutputs.includes('duplicate')) {
            return 'Conflicting nginx server blocks — multiple configs may be competing for the same domain.';
        }
    }

    // Database patterns
    if (failedCategories.has('database')) {
        if (allOutputs.includes('disk') || allOutputs.includes('no space')) {
            return 'Database failure may be caused by disk space exhaustion.';
        }
        if (allOutputs.includes('corrupt') || allOutputs.includes('crash')) {
            return 'Database tables may be corrupted — mysqlcheck --auto-repair may help.';
        }
    }

    // Connection patterns (cross-category)
    if (allOutputs.includes('connection refused') || allOutputs.includes('ssh')) {
        return 'Server is unreachable via SSH — check if the server is running and SSH port is accessible.';
    }

    if (allOutputs.includes('not found') || allOutputs.includes('command not found')) {
        return 'Required binary or tool is not installed on the server.';
    }

    // Generic: too many failures
    const failedCount = attempts.filter(a => !a.success).length;
    if (failedCount >= 5) {
        return 'Multiple approaches have failed — this may require manual investigation on the server.';
    }

    return null;
}
