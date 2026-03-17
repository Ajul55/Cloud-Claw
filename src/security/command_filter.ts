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
    [/\brm\b.*(\s-[a-zA-Z]*[rf][a-zA-Z]*|\s--recursive|\s--force)/i, 'Recursive or force delete is not allowed'],
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

// ─── Whitelists (Lane 2 & Lane 3) ────────────────────────────────────────────────
// Lane 2: Read-Only Diagnostic Commands
// Patterns are anchored at start (^) and use flexible tails to handle natural LLM variations.
// Critical: must NOT allow pipes to shells, semicolons to chain, or redirects to files.
const LANE2_WHITELIST: Array<[RegExp, string]> = [
    // Disk
    [/^(sudo\s+)?df(\s+-[hTi]+)*(\s+\/\S*)*$/i, 'df (disk free)'],
    [/^(sudo\s+)?du\s+-s?h\s+\/\S+(\s+2>\/dev\/null)?$/i, 'du (disk usage)'],
    // Memory & CPU
    [/^(sudo\s+)?free(\s+-[mghb])?$/i, 'free (memory)'],
    [/^(sudo\s+)?vmstat(\s+\d+){0,2}$/i, 'vmstat (virtual memory stats)'],
    [/^(sudo\s+)?uptime$/i, 'uptime'],
    [/^(sudo\s+)?top\s+-bn\s*1(\s+\|\s*head\s+-\d+)?$/i, 'top (single snapshot)'],
    // Service status
    [/^(sudo\s+)?systemctl\s+status\s+[\w@.-]+(\s+--no-pager)?(\s+-l)?(\s+2>&1)?(\s+\|\s*sed\s+-n\s+'1,\d+p')?$/i, 'systemctl status [service]'],
    [/^(sudo\s+)?systemctl\s+is-active\s+[\w@.-]+$/i, 'systemctl is-active'],
    [/^(sudo\s+)?systemctl\s+list-units(\s+--type=\w+)?(\s+--state=\w+)?(\s+--no-pager)?$/i, 'systemctl list-units'],
    // Nginx
    [/^(sudo\s+)?nginx\s+-t(\s+2>&1)?$/i, 'nginx -t (config test)'],
    [/^(sudo\s+)?nginx\s+-T(\s+2>&1)?(\s+\|\s*head\s+-\d+)?$/i, 'nginx -T (dump config)'],
    // Logs (read-only)
    [/^(sudo\s+)?tail\s+-n\s*\d+\s+\/var\/log\/[\w./-]+$/i, 'tail log file'],
    [/^(sudo\s+)?cat\s+\/var\/log\/[\w./-]+(\s+\|\s*(head|tail)\s+-\d+)?$/i, 'cat log file'],
    [/^(sudo\s+)?cat\s+\/etc\/nginx\/[\w./-]+$/i, 'cat nginx config'],
    [/^(sudo\s+)?head\s+-n?\s*\d+\s+\/var\/log\/[\w./-]+$/i, 'head log file'],
    [/^(sudo\s+)?grep\s+(-[a-zA-Z]+\s+)*'[^']*'\s+\/var\/log\/[\w./-]+(\s+\|\s*(head|tail)\s+-\d+)?$/i, 'grep log file'],
    // Crontab listing
    [/^(sudo\s+)?crontab\s+-l(\s+-u\s+[\w-]+)?$/i, 'crontab -l (list)'],
    // Process inspection
    [/^(sudo\s+)?ps\s+(aux|ef)(\s+\|\s*grep\s+(-[a-zA-Z]+\s+)*[\w.-]+)?(\s+\|\s*grep\s+-v\s+grep)?$/i, 'ps (process list)'],
    // Network
    [/^(sudo\s+)?netstat\s+-[a-z]+(\s+2>\/dev\/null)?(\s+\|\s*head\s+-\d+)?$/i, 'netstat'],
    [/^(sudo\s+)?ss\s+-[a-z]+(\s+2>\/dev\/null)?(\s+\|\s*head\s+-\d+)?$/i, 'ss (socket stats)'],
    // PHP version
    [/^(sudo\s+)?php[\d.]*\s+(--version|-v)$/i, 'php version check'],
    // Config reads (safe)
    [/^(sudo\s+)?nl\s+-ba\s+[\w/.+-]+(\s+\|\s*sed\s+-n\s+'\d+,\d+p')?$/i, 'nl (numbered cat)'],
    [/^(sudo\s+)?ls\s+(-[a-zA-Z]+\s+)*\/[\w./-]+$/i, 'ls (directory listing)'],
    [/^(sudo\s+)?wc\s+-l\s+[\w/.+-]+$/i, 'wc -l (line count)'],
    // MySQL safe reads
    [/^(sudo\s+)?mysql\s+(-u\s*\w+\s+)?(--password=\S+\s+)?-e\s+"(SHOW|SELECT|DESCRIBE)\b[^"]*"(\s+\w+)?$/i, 'mysql read-only query'],
];

// Lane 3: Emergency SSH Write Commands (require approval)
const LANE3_WHITELIST: Array<[RegExp, string]> = [
    [/^(sudo\s+)?systemctl\s+(restart|reload)\s+[\w@.-]+$/i, 'Emergency service restart/reload'],
];

/**
 * Check whether a command is safe to run without approval.
 */
// SSH key injection patterns — blocks adding/appending SSH keys via any command
const SSH_KEY_INJECTION_PATTERNS: Array<[RegExp, string]> = [
    [/echo\s+.*(ssh-(rsa|ed25519|ecdsa|dss)|ecdsa-sha2)/i, 'SSH key addition is not permitted via this interface. Manage SSH access directly on the server.'],
    [/>>?\s*~?\/?.*(authorized_keys|known_hosts|\.ssh\/)/i, 'SSH key addition is not permitted via this interface. Manage SSH access directly on the server.'],
    [/cat\s+.*>+\s*.*authorized_keys/i, 'SSH key addition is not permitted via this interface. Manage SSH access directly on the server.'],
    [/tee\s+.*authorized_keys/i, 'SSH key addition is not permitted via this interface. Manage SSH access directly on the server.'],
    [/ssh-copy-id/i, 'SSH key addition is not permitted via this interface. Manage SSH access directly on the server.'],
];

export function checkCommand(command: string): FilterResult {
    const trimmed = command.trim();

    // 1. Hard block first (defense in depth)
    for (const [pattern, reason] of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { safe: false, reason: `🚫 BLOCKED: ${reason}` };
        }
    }

    // 2. SSH key injection block
    for (const [pattern, reason] of SSH_KEY_INJECTION_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { safe: false, reason };
        }
    }

    // 3. Check Lane 2 (Read-Only) and Lane 3 (Emergency Write) whitelists
    let isWhitelisted = false;

    for (const [pattern] of LANE2_WHITELIST) {
        // Enforce tail line limits for Lane 2
        if (pattern.test(trimmed)) {
            if (trimmed.startsWith('tail -n ')) {
                const lines = parseInt(trimmed.split(' ')[2] ?? '0', 10);
                if (lines > 200) {
                    return { safe: false, reason: '🚫 BLOCKED: tail command exceeds maximum 200 lines limit' };
                }
            }
            isWhitelisted = true;
            break;
        }
    }

    if (!isWhitelisted) {
        for (const [pattern] of LANE3_WHITELIST) {
            if (pattern.test(trimmed)) {
                isWhitelisted = true;
                break;
            }
        }
    }

    if (!isWhitelisted) {
        return { safe: false, reason: '🚫 BLOCKED: Command is not in the approved Lane 2 or Lane 3 whitelist. See Operating Manual.' };
    }

    return { safe: true };
}

/**
 * Determine if a command requires Tier-3 human approval before execution.
 * Returns the reason string if approval is needed, null otherwise.
 */
export function requiresApproval(command: string): string | null {
    const trimmed = command.trim();
    for (const [pattern, reason] of LANE3_WHITELIST) {
        if (pattern.test(trimmed)) {
            return reason;
        }
    }
    return null;
}

// ─── Audit Guard: write-command detection ──────────────────────────────────────
const AUDIT_BLOCKED_PATTERNS = [
    /systemctl\s+(disable|enable|mask|unmask|restart|stop|start)/i,
    /sed\s+-i/i,
    /\brm\s+/i,
    /\bmv\s+.*\/etc\//i,
    /tee\s+\//i,
    /crontab\s+-[er]/i,
    /apt(-get)?\s+(install|remove|purge)/i,
    /dpkg\s+(-i|--install|--remove)/i,
    /ufw\s+(allow|deny|delete|enable|disable)/i,
];

export function isWriteCommand(command: string): boolean {
    return AUDIT_BLOCKED_PATTERNS.some(p => p.test(command));
}
