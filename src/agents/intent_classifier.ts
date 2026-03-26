import { getLLMClient } from '../llm/provider.js';

export interface Intent {
    requiresTool: boolean;
    toolHint: 'diagnose_nginx' | 'diagnose_domain' | 'cloudflare_cache_purge' | 'diagnose_services' | 'execute_ssh_command' | 'check_cloudstick_connection' | 'check_ssl_api' | 'get_cloudstick_websites' | 'get_server_details' | 'get_wordpress_details' | 'none';
    isAudit: boolean;
    targetServer: string;
    domains: string[];
    isApprovalResponse: boolean;
    needsClarification: boolean;
    requiresServerClarification: boolean;
    confidence: number;
}

const AUDIT_OVERRIDE_PATTERNS = [
    /\b(audit|health\s*check|full\s*check|scan|inspect|review)\b/i,
    /\b(what'?s\s*going\s*on|check\s*everything|any\s*issues|full\s*report)\b/i,
];

const INTENT_CLASSIFIER_PROMPT = `You are the Intent Classifier for an AIOps system. 
Analyze the user's message and return a strictly typed JSON object matching this schema:

{
  "requiresTool": boolean, // Does this request need server read/write action to fulfill? (True for fixes, diagnostics. False for general concepts)
  "toolHint": "diagnose_nginx" | "diagnose_domain" | "cloudflare_cache_purge" | "diagnose_services" | "execute_ssh_command" | "check_cloudstick_connection" | "check_ssl_api" | "get_cloudstick_websites" | "get_server_details" | "get_wordpress_details" | "none", // Best tool to start with
  "isAudit": boolean, // Is the user just asking for a status check/audit without making changes?
  "targetServer": string, // Did they specify a server? Return the exact server IP, hostname, or label. Return "unknown" if not specified.
  "domains": string[], // List of real hostnames mentioned (e.g. "example.com"). NO IP addresses, NO version strings (e.g. "v2.0"), NO file extensions masquerading as domains (e.g. ".ts", ".js", ".conf").
  "isApprovalResponse": boolean, // Is this an approval response like "yes", "proceed", "no", "reject"?
  "needsClarification": boolean, // Is the request too vague to act upon safely?
  "confidence": number // 0 to 1 confidence scale
}

Examples:
User: "my website example.com is down, check it"
Output: {"requiresTool":true,"toolHint":"diagnose_domain","isAudit":false,"targetServer":"unknown","domains":["example.com"],"isApprovalResponse":false,"needsClarification":false,"confidence":0.9}

User: "is cloudstick connected?"
Output: {"requiresTool":true,"toolHint":"check_cloudstick_connection","isAudit":true,"targetServer":"unknown","domains":[],"isApprovalResponse":false,"needsClarification":false,"confidence":1.0}

User: "check SSL status" or "is SSL installed?"
Output: {"requiresTool":true,"toolHint":"check_ssl_api","isAudit":true,"targetServer":"unknown","domains":[],"isApprovalResponse":false,"needsClarification":false,"confidence":1.0}

User: "list websites" or "what websites are on the server?"
Output: {"requiresTool":true,"toolHint":"get_cloudstick_websites","isAudit":true,"targetServer":"unknown","domains":[],"isApprovalResponse":false,"needsClarification":false,"confidence":1.0}

User: "server details" or "what PHP version is running?"
Output: {"requiresTool":true,"toolHint":"get_server_details","isAudit":true,"targetServer":"unknown","domains":[],"isApprovalResponse":false,"needsClarification":false,"confidence":1.0}

User: "wordpress details" or "what WP version?" or "list plugins"
Output: {"requiresTool":true,"toolHint":"get_wordpress_details","isAudit":true,"targetServer":"unknown","domains":[],"isApprovalResponse":false,"needsClarification":false,"confidence":1.0}

User: "fix nginx on test"
Output: {"requiresTool":true,"toolHint":"diagnose_nginx","isAudit":false,"targetServer":"test","domains":[],"isApprovalResponse":false,"needsClarification":false,"confidence":1.0}

User: "do it"
Output: {"requiresTool":false,"toolHint":"none","isAudit":false,"targetServer":"unknown","domains":[],"isApprovalResponse":true,"needsClarification":false,"confidence":1.0}

Return ONLY standard JSON without markdown wrapping or comments.`;

export async function classifyIntent(messageText: string): Promise<Intent> {
    const defaultIntent: Intent = {
        requiresTool: false,
        toolHint: 'none',
        isAudit: false,
        targetServer: 'unknown',
        domains: [],
        isApprovalResponse: false,
        needsClarification: false,
        requiresServerClarification: false,
        confidence: 0
    };

    if (!messageText || !messageText.trim()) {
        return defaultIntent;
    }

    try {
        const { client: openai, model: activeModel } = getLLMClient();
        const response = await openai.chat.completions.create({
            model: activeModel,
            messages: [
                { role: 'system', content: INTENT_CLASSIFIER_PROMPT },
                { role: 'user', content: messageText }
            ],
            temperature: 0,
            response_format: { type: 'json_object' }
        });

        const rawContent = response.choices[0]?.message?.content?.trim();
        if (rawContent) {
            // Robustly extract JSON object by finding the first { and last }
            let content = rawContent;
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                content = match[0];
            }

            const parsed = JSON.parse(content) as Intent;

            // Hardcoded Audit Override
            if (AUDIT_OVERRIDE_PATTERNS.some(p => p.test(messageText))) {
                parsed.isAudit = true;
            }

            // Ensure domains is an array
            if (!Array.isArray(parsed.domains)) {
                parsed.domains = [];
            }

            return { ...defaultIntent, ...parsed };
        }
    } catch (err) {
        console.error('[IntentClassifier] Failed to classify intent, falling back to false-positive defaults:', err);
    }

    // Fallback: If LLM fails, apply a naive regex override for minimal safety
    const isAuditOverride = AUDIT_OVERRIDE_PATTERNS.some(p => p.test(messageText));
    const isApproval = /^(yes|yep|correct|that'?s correct|this is correct|continue|keep going|proceed|go ahead|apply|fix|do it)$/i.test(messageText.trim());

    return {
        ...defaultIntent,
        isAudit: isAuditOverride,
        isApprovalResponse: isApproval,
        requiresTool: true, // Fail-safe to allow tools to run if classifier breaks
        toolHint: 'execute_ssh_command' // Most generic fallback
    };
}
