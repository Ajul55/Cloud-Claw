/**
 * Command Safety Filter
 *
 * Implements a hardcoded block-list for dangerous operations.
 * Any command matching a pattern here will be rejected immediately —
 * no LLM involvement, no overrides.
 */

interface FilterResult {
    safe: boolean;
    reason?: string;
}

// ─── Block patterns ────────────────────────────────────────────────────────────
// Each entry: [regex, human-readable reason]
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
    // Destructive file operations
    [/\brm\b(?=.*\s-[^\s]*r)(?=.*\s-[^\s]*f|\s+-[^\s]*r[^\s]*f)/i, 'Recursive force delete is not allowed'],
    [/rm\s+--no-preserve-root/i, 'rm --no-preserve-root is not allowed'],
    [/:\(\)\{.*:\|:&\};:/i, 'Fork bomb detected'],

    // Disk formatting / wiping
    [/\bmkfs\b/i, 'mkfs (filesystem format) is not allowed'],
    [/\bdd\b.*\bif=\/dev\/(zero|urandom|random)\b/i, 'dd disk wipe is not allowed'],
    [/\bshred\b/i, 'shred (secure delete) is not allowed'],
    [/\bwipefs\b/i, 'wipefs is not allowed'],

    // Privilege escalation / unsafe sudo
    [/sudo\s+-S\b/i, 'sudo -S (read password from stdin) is not allowed'],
    [/sudo\s+--reset-timestamp/i, 'sudo --reset-timestamp is not allowed'],
    [/sudo\s+su\b/i, 'sudo su is not allowed'],
    [/sudo\s+bash\b/i, 'sudo bash is not allowed. Use specific commands like "sudo ls" or "sudo cat" instead.'],
    [/sudo\s+sh\b/i, 'sudo sh is not allowed. Use specific commands like "sudo ls" or "sudo cat" instead.'],

    // Kernel / system tampering
    [/\bsysctl\b.*kernel\./i, 'Kernel parameter modification is not allowed'],
    [/\binsmod\b|\brmmod\b|\bmodprobe\b.*-r/i, 'Kernel module manipulation is not allowed'],

    // Network firewall nukes
    [/iptables\s+-F\b/i, 'iptables -F (flush all rules) is not allowed'],
    [/nft\s+flush\s+ruleset/i, 'nft flush ruleset is not allowed'],

    // Chained dangerous redirects
    [/>\s*\/dev\/[sh]d[a-z]/i, 'Direct writes to block devices are not allowed'],
    [/>\s*\/etc\/(passwd|shadow|sudoers|hosts)/i, 'Overwriting critical system files is not allowed'],

    // Injected payload execution blocks
    [/\bbase64\b.*\|\s*(bash|sh)\b/i, 'Encoded payload pipe to shell is not allowed'],
    [/\beval\b.*\$\(/i, 'eval with command substitution is not allowed'],
    [/\bcurl\b.*\|\s*(bash|sh)\b/i, 'curl pipe to shell is not allowed'],
    [/\bwget\b.*-[qO].*\|\s*(bash|sh)\b/i, 'wget pipe to shell is not allowed'],
    [/\bpython[23]?\b.*os\.system\b/i, 'Python os.system call is not allowed'],
];

// ─── Tier classifier ──────────────────────────────────────────────────────────
// Tier-1: read-only (safe to auto-run)
// Tier-2: soft writes (restart services, change configs — auto-run allowed for now)
// Tier-3: destructive / irreversible — REQUIRES human approval
const TIER3_PATTERNS: Array<[RegExp, string]> = [
    [/\bsystemctl\s+(start|stop|restart|reload|disable|mask)\b/i, 'Service state changes require approval'],
    [/\bapt(-get)?\s+install\b/i, 'Package installation requires approval'],
    [/\bapt(-get)?\s+(remove|purge|autoremove)\b/i, 'Package removal requires approval'],
    [/\byum\s+install\b/i, 'Package installation requires approval'],
    [/\byum\s+remove\b/i, 'Package removal requires approval'],
    [/\bdnf\s+install\b/i, 'Package installation requires approval'],
    [/\bdnf\s+remove\b/i, 'Package removal requires approval'],
    [/\bpacman\s+-S\b/i, 'Package installation requires approval'],
    [/\breboot\b|\bshutdown\b|\bpoweroff\b|\bhalt\b/i, 'System reboot/shutdown requires approval'],
    [/\bkill\b.*-9\b/i, 'SIGKILL (kill -9) requires approval'],
    [/\btruncate\b/i, 'File truncation requires approval'],
    [/\bchmod\b.*777\b/i, 'chmod 777 requires approval'],
    [/\bchown\b.*root/i, 'Changing ownership to root requires approval'],
    [/\bufw\s+(disable|reset)\b/i, 'Firewall disable/reset requires approval'],
    [/\bdropdb\b|\bDROP\s+DATABASE\b/i, 'Database drop requires approval'],
    [/\bDROP\s+TABLE\b/i, 'DROP TABLE requires approval'],
];

/**
 * Check whether a command is safe to run without approval.
 */
export function checkCommand(command: string): FilterResult {
    const trimmed = command.trim();

    // Hard block first
    for (const [pattern, reason] of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { safe: false, reason: `🚫 BLOCKED: ${reason}` };
        }
    }

    return { safe: true };
}

/**
 * Determine if a command requires Tier-3 human approval before execution.
 * Returns the reason string if approval is needed, null otherwise.
 */
export function requiresApproval(command: string): string | null {
    const trimmed = command.trim();
    for (const [pattern, reason] of TIER3_PATTERNS) {
        if (pattern.test(trimmed)) {
            return reason;
        }
    }
    return null;
}
