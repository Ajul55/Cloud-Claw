import { hasReceipt, type ToolReceipt } from './loop.js';

export function checkForHallucination(
    text: string,
    executionReceipts: Map<string, ToolReceipt>,
    freshnessMs: number
): boolean {
    const hallucinationPatterns: Array<{ pattern: RegExp; requiresTool?: string }> = [
        { pattern: /configuration (has been|was) (successfully |)repaired/i, requiresTool: 'fix_nginx_config' },
        { pattern: /(service|nginx|mariadb|mysql) has been restarted/i, requiresTool: 'fix_nginx_config' },
        { pattern: /fix (was|has been) applied/i, requiresTool: 'fix_nginx_config' },
        { pattern: /issue (has been|is now|was) (resolved|fixed|solved)/i, requiresTool: 'fix_nginx_config' },
        { pattern: /successfully (restarted|repaired|resolved|fixed|applied)/i, requiresTool: 'fix_nginx_config' },
        { pattern: /(nginx|mariadb|mysql|apache|php|redis|postgres) is (now |currently )?(active|running|up|fixed|resolved)/i, requiresTool: 'execute_ssh_command' },
        { pattern: /steps taken:/i },
        { pattern: /outcome:/i },
        { pattern: /please (give me a moment|allow me a moment|wait while)/i },
        { pattern: /i (have|'ve) (applied|fixed|repaired|restarted|resolved)/i },
        { pattern: /i('ll| will) now (apply|run|execute|perform|initiate)/i },
        { pattern: /let me (now |)(run|execute|apply|check|diagnose)/i },
        { pattern: /i('ll| will) (start|begin) by/i },
    ];

    return hallucinationPatterns.some(({ pattern, requiresTool: req }) => {
        if (!pattern.test(text)) return false;
        if (req) {
            const relatedTools: Record<string, string[]> = {
                'execute_ssh_command': ['execute_ssh_command', 'diagnose_nginx'],
                'fix_nginx_config': ['fix_nginx_config'],
            };
            const acceptable = relatedTools[req] ?? [req];
            return !hasReceipt(executionReceipts, acceptable, true, freshnessMs);
        }
        return true; // planning language
    });
}
