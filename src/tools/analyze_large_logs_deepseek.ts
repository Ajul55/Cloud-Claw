/**
 * analyze_large_logs_deepseek — Supervisor-Worker Log Analysis Tool
 *
 * MiniMax M2.7 (the supervisor) calls this tool when it needs to read and
 * parse large log output during troubleshooting.  The tool:
 *   1. Runs the SSH command to fetch the raw logs.
 *   2. Sends the output to DeepSeek V3 (cheap, fast) for summarisation.
 *   3. Returns a concise root-cause summary back to MiniMax.
 *
 * If DeepSeek is unavailable or fails, the tool automatically retries with
 * MiniMax so there is never a context gap or lost work.
 */

import OpenAI from 'openai';
import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import { getDeepSeekClient, getLLMClient, recordDeepSeekSuccess, recordDeepSeekFailure } from '../llm/provider.js';
import { trackUsage } from '../telemetry/usage_tracker.js';
import type { Tool, ToolResult } from './types.js';

// ─── Analysis Prompt ─────────────────────────────────────────────────────────
// Hard-coded to enforce short, actionable output from the cheap model.
const ANALYSIS_SYSTEM_PROMPT = `You are a senior Linux SRE log analyst.
You will receive raw server log output and a specific question about it.

Rules:
- Return ONLY the analysis. No greetings, no markdown headers.
- Be concise: maximum 5 sentences.
- Always include the exact log line(s) that are most relevant.
- If you find a root cause, state it clearly in the first sentence.
- If the logs show no errors or issues, say "No issues found in the provided logs."
- Never fabricate log lines. Only reference what you see in the input.`;

// Maximum characters of log output to send to the analysis model.
// DeepSeek V3 handles ~128k context but we cap to keep cost low.
const MAX_LOG_CHARS = 30_000;

export const analyzeLargeLogsDeepseekTool: Tool = {
    name: 'analyze_large_logs_deepseek',
    description:
        'Fetch server logs via SSH and get an AI-powered analysis of the output. ' +
        'Use this tool when you need to read and understand large log files (nginx, PHP-FPM, MySQL, journalctl, syslog, etc.) ' +
        'to find errors or root causes. The analysis is performed by a fast, specialised model. ' +
        'Returns a concise summary of findings — never the raw logs themselves.',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label or ID from Cloudstick API.',
            },
            host: {
                type: 'string',
                description: 'Legacy host/IP override. Prefer server_label.',
            },
            command: {
                type: 'string',
                description:
                    'Bash command to fetch the logs, e.g. "tail -n 200 /var/log/nginx-cs/error.log" ' +
                    'or "journalctl -u php81cs-fpm --since \'1 hour ago\' --no-pager".',
            },
            query: {
                type: 'string',
                description:
                    'What to look for in the logs, e.g. "Find the cause of 502 errors" ' +
                    'or "Are there any OOM kills in the last hour?".',
            },
        },
        required: ['command', 'query'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const command = String(args.command ?? '').trim();
        const query = String(args.query ?? '').trim();

        if (!command) {
            return { success: false, output: 'Error: command is required.' };
        }
        if (!query) {
            return { success: false, output: 'Error: query is required.' };
        }

        // ── Step 1: Fetch logs via SSH ──────────────────────────────────────
        let rawLogs: string;
        try {
            const server = await resolveServerArg(args);
            console.log(`[analyze_large_logs] Fetching logs from ${formatServerTarget(server)}: ${command}`);
            rawLogs = await sshExec(server.ip, command, {
                user: server.sshUser,
                port: server.sshPort,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[analyze_large_logs] SSH failed:', msg);
            return { success: false, output: `❌ SSH command failed: ${msg}` };
        }

        if (!rawLogs || !rawLogs.trim()) {
            return {
                success: true,
                output: 'The command returned no output. The log file may be empty or the path may be incorrect.',
            };
        }

        // Cap the log output to control token costs
        const truncated = rawLogs.length > MAX_LOG_CHARS;
        const logSnippet = truncated
            ? rawLogs.slice(-MAX_LOG_CHARS) // keep the most recent (tail) portion
            : rawLogs;

        const userPrompt = `Question: ${query}\n\n--- RAW LOG OUTPUT (${truncated ? 'truncated to last ~30k chars' : 'full'}) ---\n${logSnippet}`;

        // ── Step 2: Analyse with DeepSeek (or fallback to primary) ─────────
        const analysisResult = await callAnalysisModel(userPrompt, query);

        return {
            success: true,
            output: analysisResult,
        };
    },
};

// ─── Analysis Model Call with Automatic Fallback ─────────────────────────────
async function callAnalysisModel(userPrompt: string, query: string): Promise<string> {
    const dsConfig = getDeepSeekClient();
    const usingDeepSeek = dsConfig !== null;

    // First attempt: DeepSeek if available, otherwise primary
    const config = dsConfig ?? getLLMClient();
    const label = usingDeepSeek ? 'DeepSeek V3' : config.provider;

    try {
        console.log(`[analyze_large_logs] Sending logs to ${label} for analysis...`);
        const start = Date.now();
        const response = await config.client.chat.completions.create({
            model: config.model,
            messages: [
                { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 512, // strict cap — we want concise output
        }) as OpenAI.ChatCompletion;

        const latency = Date.now() - start;
        const content = response.choices?.[0]?.message?.content ?? '';

        if (usingDeepSeek) recordDeepSeekSuccess();

        // Track usage for cost visibility
        const usage = response.usage;
        if (usage) {
            void trackUsage({
                sessionId: 'internal:log_analysis',
                model: config.model,
                tokensIn: usage.prompt_tokens,
                tokensOut: usage.completion_tokens,
                latencyMs: latency,
                toolName: 'analyze_large_logs_deepseek',
                routingDecision: usingDeepSeek ? 'deepseek' : 'primary',
            });
        }

        console.log(`[analyze_large_logs] ${label} analysis complete (${latency}ms, ${usage?.total_tokens ?? '?'} tokens)`);
        return content || 'Analysis model returned empty response.';
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // If DeepSeek failed, retry with primary (MiniMax)
        if (usingDeepSeek) {
            recordDeepSeekFailure();
            console.warn(`[analyze_large_logs] DeepSeek failed (${msg}) — falling back to primary provider`);
            return callWithPrimary(userPrompt);
        }

        // Primary also failed — return the error
        console.error('[analyze_large_logs] Analysis model failed:', msg);
        return `⚠️ Log analysis failed: ${msg}. Raw logs were fetched but could not be analysed. Consider re-reading the log file manually.`;
    }
}

async function callWithPrimary(userPrompt: string): Promise<string> {
    const primary = getLLMClient();
    try {
        console.log(`[analyze_large_logs] Retrying analysis with primary provider (${primary.provider})...`);
        const start = Date.now();
        const response = await primary.client.chat.completions.create({
            model: primary.model,
            messages: [
                { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 512,
        }) as OpenAI.ChatCompletion;

        const latency = Date.now() - start;
        const content = response.choices?.[0]?.message?.content ?? '';
        const usage = response.usage;

        if (usage) {
            void trackUsage({
                sessionId: 'internal:log_analysis',
                model: primary.model,
                tokensIn: usage.prompt_tokens,
                tokensOut: usage.completion_tokens,
                latencyMs: latency,
                toolName: 'analyze_large_logs_deepseek',
                routingDecision: 'deepseek_fallback',
            });
        }

        console.log(`[analyze_large_logs] Primary fallback analysis complete (${latency}ms)`);
        return content || 'Analysis model returned empty response.';
    } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error('[analyze_large_logs] Primary fallback also failed:', msg);
        return `⚠️ Log analysis failed on both providers: ${msg}. The logs were fetched but could not be analysed.`;
    }
}
