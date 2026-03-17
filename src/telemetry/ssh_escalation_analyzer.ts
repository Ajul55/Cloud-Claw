/**
 * SSH Escalation Analyzer — Phase 4
 *
 * Tracks tool usage patterns to identify how often tasks fall through to SSH
 * vs. being handled by the Cloudstick API (Lane 1). Provides a summary
 * report to drive the metric: reduce SSH-only tasks from 30% to < 15%.
 *
 * Usage: Import and call `recordToolUsage()` after every tool execution in loop.ts.
 *        Call `getEscalationReport()` to generate the summary.
 */

export interface ToolUsageEntry {
    toolName: string;
    lane: 1 | 2 | 3;
    timestamp: number;
    sessionId: string;
    success: boolean;
}

// Lane classification by tool name
const LANE_MAP: Record<string, 1 | 2 | 3> = {
    // Lane 1: Cloudstick API
    create_system_user: 1, delete_system_user: 1, change_system_user_password: 1,
    create_database_user: 1, delete_database_user: 1, change_database_user_password: 1,
    create_database: 1, delete_database: 1,
    issue_ssl: 1, renew_ssl_api: 1, delete_ssl: 1, update_ssl_settings: 1,
    switch_php_api: 1,
    // Lane 2: Read-Only SSH
    execute_ssh_command: 2, diagnose_nginx: 2, diagnose_services: 2,
    diagnose_domain: 2, check_ssl: 2, sre_search: 2, discovery_agent: 2,
    // Lane 3: Write SSH (Emergency / HITL)
    execute_ssh_write: 3, fix_nginx_config: 3, fix_wordpress: 3,
    renew_ssl: 3, manage_php: 3, repair_mysql: 3, cleanup_disk: 3,
    create_nginx_vhost: 3, cloudflare_cache_purge: 3, emergency_service_restart: 3,
};

// In-memory log (capped at last 1000 entries to avoid memory bloat)
const usageLog: ToolUsageEntry[] = [];
const MAX_LOG_SIZE = 1000;

export function recordToolUsage(
    toolName: string,
    sessionId: string,
    success: boolean,
): void {
    const lane = LANE_MAP[toolName] ?? 2; // default to Lane 2 if unknown
    usageLog.push({ toolName, lane, timestamp: Date.now(), sessionId, success });
    if (usageLog.length > MAX_LOG_SIZE) {
        usageLog.splice(0, usageLog.length - MAX_LOG_SIZE);
    }
}

export interface EscalationReport {
    totalToolCalls: number;
    lane1Count: number;
    lane2Count: number;
    lane3Count: number;
    lane1Pct: string;
    sshPct: string;
    apiOnlyPct: string;
    topSshTools: Array<{ tool: string; count: number }>;
    recommendation: string;
}

export function getEscalationReport(windowMs: number = 7 * 24 * 60 * 60 * 1000): EscalationReport {
    const cutoff = Date.now() - windowMs;
    const recent = usageLog.filter(e => e.timestamp >= cutoff);

    const total = recent.length || 1; // avoid div by 0
    const lane1 = recent.filter(e => e.lane === 1).length;
    const lane2 = recent.filter(e => e.lane === 2).length;
    const lane3 = recent.filter(e => e.lane === 3).length;

    // Count SSH tools (lane 2 + 3) that could potentially be replaced by API
    const sshToolCounts = new Map<string, number>();
    for (const entry of recent.filter(e => e.lane >= 2)) {
        sshToolCounts.set(entry.toolName, (sshToolCounts.get(entry.toolName) ?? 0) + 1);
    }
    const topSshTools = [...sshToolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tool, count]) => ({ tool, count }));

    const sshPct = ((lane2 + lane3) / total * 100).toFixed(1);
    const apiPct = (lane1 / total * 100).toFixed(1);

    let recommendation = '';
    const sshPctNum = parseFloat(sshPct);
    if (sshPctNum > 30) {
        recommendation = `⚠️ SSH usage is ${sshPct}% (target: < 15%). Top SSH tools: ${topSshTools.map(t => t.tool).join(', ')}. Consider adding API equivalents.`;
    } else if (sshPctNum > 15) {
        recommendation = `🟡 SSH usage is ${sshPct}%. Getting closer to the 15% target. Focus on replacing: ${topSshTools[0]?.tool ?? 'N/A'}.`;
    } else {
        recommendation = `✅ SSH usage is ${sshPct}% — below the 15% target. API coverage is strong.`;
    }

    return {
        totalToolCalls: recent.length,
        lane1Count: lane1,
        lane2Count: lane2,
        lane3Count: lane3,
        lane1Pct: `${apiPct}%`,
        sshPct: `${sshPct}%`,
        apiOnlyPct: `${apiPct}%`,
        topSshTools,
        recommendation,
    };
}

/** Reset logged data (useful for testing) */
export function resetUsageLog(): void {
    usageLog.length = 0;
}
