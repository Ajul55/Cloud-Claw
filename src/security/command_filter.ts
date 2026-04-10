/**
 * Command Safety Filter
 *
 * Implements a hybrid binary-classification and block-list approach.
 * Replaces the fragile regex whitelists for common read tools, while
 * keeping strict regexes for dual-purpose tools (systemctl, apt, etc).
 */

interface FilterResult {
    safe: boolean;
    reason?: string;
}

// ─── Block patterns ────────────────────────────────────────────────────────────
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
    // Destructive / System Level
    [/\brm\b.*(\s-[a-zA-Z]*[rf][a-zA-Z]*|\s--recursive|\s--force)/i, 'Recursive or force delete is not allowed'],
    [/rm\s+--no-preserve-root/i, 'rm --no-preserve-root is not allowed'],
    [/:\(\)\{.*:\|:&\};:/i, 'Fork bomb detected'],
    [/\bmkfs\b/i, 'mkfs (filesystem format) is not allowed'],
    [/\bdd\b.*\bif=\/dev\/(zero|urandom|random)\b/i, 'dd disk wipe is not allowed'],
    [/\bshred\b/i, 'shred (secure delete) is not allowed'],
    [/\bwipefs\b/i, 'wipefs is not allowed'],

    // Package installation
    [/\bapt(-get)?\s+(install|remove|purge)\b/i, 'Apt state modification is not allowed'],
    [/\byum\s+(install|remove)\b/i, 'Yum state modification is not allowed'],
    [/\bdnf\s+(install|remove)\b/i, 'DNF state modification is not allowed'],
    [/\bdpkg\s+(-i|--install|--remove|--purge)\b/i, 'Dpkg state modification is not allowed'],

    // Privilege / Sudo abuse
    [/sudo\s+-S\b/i, 'sudo -S is not allowed'],
    [/sudo\s+--reset-timestamp/i, 'sudo --reset-timestamp is not allowed'],
    [/sudo\s+su\b/i, 'sudo su is not allowed'],
    [/sudo\s+bash\b/i, 'sudo bash is not allowed.'],
    [/sudo\s+sh\b/i, 'sudo sh is not allowed.'],

    // Tampering
    [/\bsysctl\b.*kernel\./i, 'Kernel parameter modification is not allowed'],
    [/\binsmod\b|\brmmod\b|\bmodprobe\b.*-r/i, 'Kernel module manipulation is not allowed'],
    [/iptables\s+-F\b/i, 'iptables -F is not allowed'],
    [/nft\s+flush\s+ruleset/i, 'nft flush ruleset is not allowed'],

    // Arbitrary injections & redirects to scary places
    [/>\s*\/dev\/[sh]d[a-z]/i, 'Direct writes to block devices are not allowed'],
    [/>>?\s*\/etc\/(passwd|shadow|sudoers|hosts)/i, 'Overwriting critical system files is not allowed'],
    [/\bbase64\b.*\|\s*(bash|sh)\b/i, 'Encoded payload pipe to shell is not allowed'],
    [/\beval\b.*\$\(/i, 'eval with command substitution is not allowed'],
    [/\bcurl\b.*\|\s*(bash|sh)\b/i, 'curl pipe to shell is not allowed'],
    [/\bwget\b.*-[qO].*\|\s*(bash|sh)\b/i, 'wget pipe to shell is not allowed'],
    [/\bpython[23]?\b.*os\.system\b/i, 'Python os.system call is not allowed'],
    
    // Explicit write utilities that aren't inherently caught by binary list
    [/\bsed\s+-i\b/i, 'sed -i (in-place write) is not allowed'],
    [/\bmv\s+.*\/etc\//i, 'mv into /etc/ is not allowed'],
    [/\btee\s+\//i, 'tee to root filesystem is not allowed'],
    [/\bcrontab\s+-[er]/i, 'crontab edit/remove is not allowed'],
];

const SSH_KEY_INJECTION_PATTERNS: Array<[RegExp, string]> = [
    [/echo\s+.*(ssh-(rsa|ed25519|ecdsa|dss)|ecdsa-sha2)/i, 'SSH key addition is not permitted'],
    [/>>?\s*~?\/?.*(authorized_keys|known_hosts|\.ssh\/)/i, 'SSH key addition is not permitted'],
    [/cat\s+.*>+\s*.*authorized_keys/i, 'SSH key addition is not permitted'],
    [/tee\s+.*authorized_keys/i, 'SSH key addition is not permitted'],
    [/ssh-copy-id/i, 'SSH key addition is not permitted'],
];

const SENSITIVE_PATHS: Array<[RegExp, string]> = [
    [/\/etc\/(shadow|gshadow|sudoers)/i, 'Reading highly sensitive system files is blocked'],
    [/\.ssh\/(id_rsa|id_ed25519|id_dsa)/i, 'Reading private SSH keys is blocked'],
];

// ─── Whitelists ──────────────────────────────────────────────────────────────

// Safe read-only / diagnostic utilities. Can be piped and used with any flag EXCEPT what is blocked above.
const READ_SAFE_BINARIES = new Set([
    'tail', 'cat', 'head', 'grep', 'zcat', 'zgrep', 'less', 'more', 'awk', 'sed', 'sort', 'uniq', 'wc', 'nl',
    'ls', 'find', 'stat', 'file', 'du', 'df', 'tree',
    'free', 'vmstat', 'uptime', 'top', 'ps', 'pgrep', 'lsof', 'last',
    'netstat', 'ss', 'dig', 'curl', 'wget', 'ping', 'traceroute', 'nmap', 'nc', 'ncat', 'telnet',
    'whoami', 'id', 'date', 'timedatectl', 'hostname', 'uname',
    'which', 'command', 'type', 'php', // php is read safe if not executing scripts
    'sleep',
    'echo', 'printf', 'test', 'true', 'false',             // shell builtins — harmless output/logic
    'basename', 'dirname', 'readlink', 'realpath',          // path utilities — read-only
    'env', 'printenv',                                       // environment inspection
    'cut', 'tr', 'tac', 'rev', 'column', 'xargs',          // text processing — read-only
]);

// For tools that have BOTH read and write subcommands (like systemctl or apt),
// we fall back to strict regexes to ensure only read modes are accessed.
const DUAL_PURPOSE_READ_REGEXES: Array<[RegExp, string]> = [
    [/^(sudo\s+)?systemctl\s+(status|is-active|is-enabled|list-units|list-unit-files)\b.*$/i, 'systemctl safe read'],
    [/^(sudo\s+)?journalctl\b.*$/i, 'journalctl read'],
    [/^(sudo\s+)?journalctl\s+-u\s+php\d*cs-fpm\b.*$/i, 'journalctl php-fpm pool crash log'],
    [/^(sudo\s+)?nginx(?:-cs)?\s+-(t|T|v|V)\b.*$/i, 'nginx read/test'],
    [/^(sudo\s+)?\/CloudStick\/Packages\/apache2-cs\/bin\/(httpd|apachectl)\s+-t\b.*/i, 'apache-cs syntax check'],
    [/^(sudo\s+)?\/CloudStick\/Packages\/php\d+cs\/sbin\/php-fpm\b.*--test.*/i, 'php-fpm syntax check'],
    [/^(sudo\s+)?dpkg\s+(-l|-s|--get-selections)\b.*$/i, 'dpkg read'],
    [/^(sudo\s+)?apt\s+list\b.*$/i, 'apt list'],
    [/^(sudo\s+)?apt-cache\s+(show|search|policy)\b.*$/i, 'apt-cache read'],
    [/^(sudo\s+)?rpm\s+-q\b.*$/i, 'rpm read'],
    [/^(sudo\s+)?mysql\s+.*-e\s+"(SHOW|SELECT|DESCRIBE)\b[^"]*".*$/i, 'mysql safe read'],
    [/^(sudo\s+)?docker\s+(ps|images)\b.*$/i, 'docker safe read'],
    [/^(sudo\s+)?docker\s+(inspect|logs|port|stats\s+--no-stream|container\s+ls)\b.*$/i, 'docker safe read'],
    [/^(sudo\s+)?docker\s+exec\s+[^\s]+\s+(nginx\s+-T|nginx\s+-t|cat\b|head\b|tail\b|grep\b|ls\b|find\b|stat\b|php\s+-v\b|wp\s+(core\s+version|plugin\s+list|theme\s+list|option\s+get|user\s+list|db\s+check|config\s+get)\b).*/i, 'docker exec safe read'],
    [/^(sudo\s+)?docker\s+compose\s+ps\b.*$/i, 'docker compose safe read'],
    [/^(sudo\s+)?[\w.-]+\s+(--version|-v|-V)\b.*$/i, 'version generic command'],
    [/^(sudo\s+)?openssl\s+(s_client|x509)\b.*$/i, 'openssl safe read'],
    [/^(sudo\s+)?certbot\s+certificates\b.*$/i, 'certbot read'],
    [/^(sudo\s+)?ufw\s+(status|status\s+verbose|status\s+numbered)\s*$/i, 'ufw status read'],
    [/^(sudo\s+)?csf\s+-g\s+[\d.:a-fA-F/]+\s*$/i, 'csf -g: check rules for IP'],
    [/^(sudo\s+)?csf\s+-l\b.*$/i, 'csf -l: list temp blocks'],
    [/^(sudo\s+)?wp\s+(core\s+version|plugin\s+list|theme\s+list|option\s+get|user\s+list|db\s+check|config\s+get)\b.*$/i, 'wp-cli safe read'],
    [/^(sudo\s+)?crontab\s+(-u\s+[a-z0-9_-]+\s+)?-l\b.*$/i, 'crontab read'],
];

// Lane 3: Emergency SSH Write Commands (require approval)
const LANE3_WHITELIST: Array<[RegExp, string]> = [
    [/^(sudo\s+)?crontab\s+(-u\s+[a-z0-9_-]+\s+)?-r\b.*$/i, 'crontab deletion'],
    [/^(sudo\s+)?systemctl\s+(restart|reload)\s+[\w@.-]+$/i, 'Emergency service restart/reload'],
    [/^(sudo\s+)?docker\s+(restart|start|stop)\s+[\w][\w.-]*$/i, 'Docker container state change'],
    [/^(sudo\s+)?docker\s+compose\s+(restart|start|stop)\b.*$/i, 'Docker Compose service state change'],
    [/^(sudo\s+)?killall\s+-9\s+php/i, 'Emergency force-kill of hung PHP-FPM processes'],
    [/^(sudo\s+)?chmod\s+(\+x|[0-7]{3,4})\s+\S+$/i, 'chmod on a script file to make it executable'],
    [/^(sudo\s+)?mkdir\s+-p\s+\S+/i, 'Creating a directory path'],
    // UFW fallback rules (for non-Cloudstick hosts)
    [/^(sudo\s+)?ufw\s+(allow|deny)\s+[\d]+(\/(tcp|udp))?\s*$/i, 'Firewall: open/close port'],
    [/^(sudo\s+)?ufw\s+(allow|deny)\s+[\w-]+(\/(tcp|udp))?\s*$/i, 'Firewall: open/close named service port'],
    [/^(sudo\s+)?ufw\s+(allow|deny)\s+from\s+[\d./]+.*$/i, 'Firewall: IP-based rule'],
    [/^(sudo\s+)?ufw\s+(enable|disable|reload)\s*$/i, 'Firewall enable/disable'],
    [/^(sudo\s+)?ufw\s+delete\s+\d+\s*$/i, 'Firewall rule deletion by number'],
    // CSF rules (Cloudstick servers use CSF/LFD, not UFW)
    [/^(sudo\s+)?csf\s+-a\s+[\d.:a-fA-F/]+(\s+.{0,100})?\s*$/i, 'CSF: whitelist IP'],
    [/^(sudo\s+)?csf\s+-d\s+[\d.:a-fA-F/]+(\s+.{0,100})?\s*$/i, 'CSF: block IP'],
    [/^(sudo\s+)?csf\s+-tr\s+[\d.:a-fA-F/]+\s*$/i, 'CSF: remove temp block'],
    [/^(sudo\s+)?csf\s+-r\s*$/i, 'CSF: reload firewall'],
    // Certbot certificate operations — require HITL approval
    [/^(sudo\s+)?certbot\s+(certonly|--nginx|--apache|renew)\b.*$/i, 'Certbot certificate operation'],
];

// ─── Core Filter Logic ────────────────────────────────────────────────────────

export function checkCommand(command: string, isWriteTool: boolean = false): FilterResult {
    const trimmed = command.trim();

    // 1. Hard Block & Injection checks
    for (const [pattern, reason] of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) return { safe: false, reason: `🚫 BLOCKED: ${reason}` };
    }
    for (const [pattern, reason] of SSH_KEY_INJECTION_PATTERNS) {
        if (pattern.test(trimmed)) return { safe: false, reason: `🚫 BLOCKED: ${reason}` };
    }
    for (const [pattern, reason] of SENSITIVE_PATHS) {
        if (pattern.test(trimmed)) return { safe: false, reason: `🚫 BLOCKED: ${reason}` };
    }

    // Special case limitation for 'tail' length to prevent OOM
    if (trimmed.includes('tail ') && trimmed.includes('-n ')) {
        const match = trimmed.match(/tail\s+.*-n\s*(\d+)/i);
        if (match && parseInt(match[1], 10) > 200) {
            return { safe: false, reason: '🚫 BLOCKED: tail command exceeds maximum 200 lines limit' };
        }
    }

    // If this is a designated write tool (like execute_ssh_write), it will require
    // explicit HITL approval anyway. We just need to ensure the hard blocks pass.
    if (isWriteTool) {
        return { safe: true };
    }

    // 2. Split chained/piped commands to validate each segment (respecting quotes)
    const subCommands: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];
        const next = trimmed[i + 1] || '';
        
        if (char === "'" && !inDouble) inSingle = !inSingle;
        if (char === '"' && !inSingle) inDouble = !inDouble;
        
        if (!inSingle && !inDouble) {
            if (char === ';') { subCommands.push(current.trim()); current = ''; continue; }
            if (char === '|' && next === '|') { subCommands.push(current.trim()); current = ''; i++; continue; }
            if (char === '&' && next === '&') { subCommands.push(current.trim()); current = ''; i++; continue; }
            if (char === '|' && next !== '|') { subCommands.push(current.trim()); current = ''; continue; }
        }
        current += char;
    }
    if (current.trim()) subCommands.push(current.trim());

    const validSubCommands = subCommands.filter(s => s.length > 0);

    for (const sub of validSubCommands) {
        let subWhitelisted = false;

        // Extract base binary (e.g. 'sudo tail -n 50' -> 'tail')
        const tokens = sub.split(/\s+/);
        let binary = tokens[0].toLowerCase();
        if (binary === 'sudo' && tokens.length > 1) {
            binary = tokens[1].toLowerCase();
        }

        // Layer A: Is it a universally safe read-only binary?
        if (READ_SAFE_BINARIES.has(binary)) {
            subWhitelisted = true;
        } 
        // Layer B: Is it a safe sub-command of a dual-purpose tool?
        else {
            for (const [pattern] of DUAL_PURPOSE_READ_REGEXES) {
                if (pattern.test(sub)) {
                    subWhitelisted = true;
                    break;
                }
            }
        }

        // Layer C: Is it a Lane 3 emergency write operation?
        if (!subWhitelisted) {
            for (const [pattern] of LANE3_WHITELIST) {
                if (pattern.test(sub)) {
                    subWhitelisted = true;
                    break;
                }
            }
        }

        if (!subWhitelisted) {
            return { safe: false, reason: `🚫 BLOCKED: Binary '${binary}' is not recognized as a safe diagnostic tool or whitelist pattern.` };
        }
    }

    return { safe: true };
}

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
    /docker\s+(restart|stop|start|rm|run|exec)\b/i,
    /docker\s+compose\s+(restart|stop|start|up|down|exec)\b/i,
    /sed\s+-i/i,
    /\brm\s+/i,
    /\bmv\s+.*\/etc\//i,
    /tee\s+\//i,
    /crontab\s+-[er]/i,
    /apt(-get)?\s+(install|remove|purge)/i,
    /dpkg\s+(-i|--install|--remove)/i,
    /ufw\s+(allow|deny|delete|enable|disable|reload)/i,
    /csf\s+(-a|-d|-tr|-r)\b/i,
];

export function isWriteCommand(command: string): boolean {
    return AUDIT_BLOCKED_PATTERNS.some(p => p.test(command));
}
