// ─── SSH Write Path Guard ──────────────────────────────────────────────────────
const SSH_SENSITIVE_PATHS = ['.ssh/', 'authorized_keys', 'known_hosts', 'id_rsa', 'id_ed25519'];

/**
 * Pre-execution guard for execute_ssh_write.
 * Blocks writes to SSH-sensitive paths (key files, authorized_keys, etc.).
 * Returns null if safe, or a block reason string if unsafe.
 */
export function checkWriteTarget(toolArgs: Record<string, unknown>): string | null {
    const targetPath = String(toolArgs.path ?? toolArgs.file_path ?? '');
    if (SSH_SENSITIVE_PATHS.some(p => targetPath.includes(p))) {
        return `Writing to SSH key path "${targetPath}" is blocked. Manage SSH keys directly on the server.`;
    }
    return null;
}

// ─── Tool Output Sanitization ──────────────────────────────────────────────────

export function sanitizeToolOutput(output: string): { output: string; masked: boolean; injections: string[] } {
    let sanitized = output ?? '';
    let masked = false;
    const injections: string[] = [];

    const injectionPatterns: RegExp[] = [
        /ignore previous instructions/i,
        /<minimax:tool_call>/i,
        /functions\.execute_ssh_command/i,
        /you are now a different ai/i,
        /\bcurl\b.*\|\s*(bash|sh)\b/i,
        /\bwget\b.*-[qO].*\|\s*(bash|sh)\b/i,
        /\bbase64\s+-d\s*\|\s*(bash|sh)/i,
    ];

    for (const pattern of injectionPatterns) {
        if (pattern.test(sanitized)) {
            sanitized = sanitized.replace(pattern, '[INJECTION BLOCKED]');
            injections.push(pattern.source);
        }
    }

    // Mask secrets
    sanitized = sanitized.replace(/define\(\s*'DB_(PASSWORD|USER)'\s*,\s*'[^']*'\s*\)/gi, (match, key) => {
        masked = true;
        return `define('DB_${String(key).toUpperCase()}', '[REDACTED]')`;
    });

    sanitized = sanitized.replace(
        /define\s*\(\s*'([A-Z_]+(?:KEY|SALT|SECRET|PASSWORD|AUTH)[A-Z_]*)'\s*,\s*'([^']*)'\s*\)/gi,
        (_m, key) => {
            masked = true;
            return `define('${String(key)}', '[REDACTED]')`;
        }
    );

    sanitized = sanitized.replace(
        /^([A-Z0-9_]*(PASSWORD|SECRET|TOKEN|KEY)[A-Z0-9_]*\s*=\s*)(.+)$/gmi,
        (_m, prefix) => {
            masked = true;
            return `${prefix}[REDACTED]`;
        }
    );

    sanitized = sanitized.replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        () => {
            masked = true;
            return '[PRIVATE KEY REDACTED]';
        }
    );

    sanitized = sanitized.replace(/\b(mysql|postgres|postgresql|mongodb):\/\/[^@\s]+@/gi, (m) => {
        masked = true;
        return m.replace(/:\/\/[^@]+@/, '://[REDACTED]@');
    });

    return { output: sanitized, masked, injections };
}
