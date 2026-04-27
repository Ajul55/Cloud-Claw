import { getAllTools } from '../tools/tool_registry.js';
import { type ToolReceipt, serializeReceipts } from './session_manager.js';

// ─── SSH tool sets ───────────────────────────────────────────────────────────

export const SSH_TOOLS = new Set([
    'execute_ssh_command', 'execute_ssh_write', 'diagnose_nginx',
    'diagnose_services', 'diagnose_domain', 'fix_nginx_config',
    'renew_ssl', 'manage_php', 'repair_mysql', 'cleanup_disk',
    'fix_wordpress', 'create_nginx_vhost'
]);

export const SSH_CALL_LIMITS: Record<string, number> = {
    starter: 10,
    pro: 30,
    business: 50,
};

export const MEMORY_TOOLS = new Set([
    'fix_nginx_config', 'fix_wordpress', 'renew_ssl', 'manage_php',
    'repair_mysql', 'cleanup_disk', 'execute_ssh_write', 'cloudflare_cache_purge',
]);

export const SENSITIVE_PATTERNS = [
    /private.*key/i, /ssh.*key/i, /password/i,
    /secret/i, /token/i, /\.env/i,
];

// ─── Write-tools (lazy — avoids module init crash) ───────────────────────────

let WRITE_TOOLS: Set<string> | null = null;
export function getWriteTools(): Set<string> {
    if (!WRITE_TOOLS) {
        WRITE_TOOLS = new Set(getAllTools().filter(t => t.approvalTier === 3).map(t => t.name));
    }
    return WRITE_TOOLS;
}

// ─── Suppressed-tools: persisted in session receipts JSONB ───────────────────
// Stored under the __suppressedTools key so loadReceiptsFromSession() ignores it
// (the entry fails the `typeof .toolName === 'string'` guard).

export const SUPPRESSED_TOOLS_KEY = '__suppressedTools';

export function loadSuppressedTools(raw: unknown): Set<string> {
    if (raw && typeof raw === 'object') {
        const entry = (raw as Record<string, unknown>)[SUPPRESSED_TOOLS_KEY];
        if (Array.isArray(entry)) {
            return new Set(entry.filter((v): v is string => typeof v === 'string'));
        }
    }
    return new Set<string>();
}

export function serializeWithSuppressedTools(
    receipts: Map<string, ToolReceipt>,
    suppressedTools: Set<string>
): Record<string, unknown> {
    const base: Record<string, unknown> = serializeReceipts(receipts);
    if (suppressedTools.size > 0) {
        base[SUPPRESSED_TOOLS_KEY] = [...suppressedTools];
    }
    return base;
}
