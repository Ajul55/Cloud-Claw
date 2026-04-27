import { getToolByName } from '../tools/tool_registry.js';
import type { ServerNode } from '../utils/server_registry.js';
import type { Intent } from './intent_classifier.js';

// ─── Tool-server routing helpers ─────────────────────────────────────────────

export function toolSupportsServerRouting(
    tool: { parameters: { properties: Record<string, unknown> } }
): boolean {
    return Object.prototype.hasOwnProperty.call(tool.parameters.properties, 'server_label')
        || Object.prototype.hasOwnProperty.call(tool.parameters.properties, 'host');
}

export function hydrateServerToolArgs(
    toolArgs: Record<string, unknown>,
    server: Pick<ServerNode, 'id' | 'label' | 'ip'>
): void {
    toolArgs.server_label = server.label;
    toolArgs.host = server.ip;
    if (server.id) {
        toolArgs.server_id = String(server.id);
    }
}

export function intentRequiresServerTarget(
    intent: Pick<Intent, 'requiresTool' | 'toolHint'>
): boolean {
    if (!intent.requiresTool) {
        return false;
    }

    const hintedTool = intent.toolHint !== 'none'
        ? getToolByName(intent.toolHint)
        : null;

    if (!hintedTool) {
        return true;
    }

    return toolSupportsServerRouting(hintedTool);
}

// ─── New-website creation guard ───────────────────────────────────────────────
// Tools that attach a domain/subdomain to an EXISTING site — must not be used
// when the user actually wants to CREATE a new website.

export const EXISTING_WEBSITE_ATTACH_TOOLS = new Set(['add_subdomain', 'add_domain_to_website']);

export function isNewWebsiteCreationRequest(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const asksToCreateSite = (
        /\b(create|new|launch|spin\s*up|set\s*up|setup|build)\b/.test(normalized)
        && /\b(website|site)\b/.test(normalized)
    )
        || /\bcreate_(wordpress|custom_php)_site\b/.test(normalized);

    if (!asksToCreateSite) {
        return false;
    }

    const explicitExistingSiteAttach = /\b(add|attach|alias|point|connect)\b/.test(normalized)
        && /\b(subdomain|domain)\b/.test(normalized)
        && /\b(existing|current)\b/.test(normalized);

    const explicitAddSubdomainRequest = /\badd\s+(a\s+)?subdomain\b/.test(normalized)
        || /\badd\s+domain\b/.test(normalized)
        || /\battach\s+domain\b/.test(normalized);

    return !explicitExistingSiteAttach && !explicitAddSubdomainRequest;
}
