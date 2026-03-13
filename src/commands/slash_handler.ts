import { getPool, isDBConfigured, getApprovalById } from '../database/db.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { setGlobalLLMOverride, getCurrentLLMConfig } from '../llm/provider.js';
import type { ReplyFn } from '../tools/types.js';
import { FALLBACK_SERVERS, formatServerTarget, getAllServers } from '../utils/server_registry.js';

// ─── In-memory store access ─────────────────────────────────────────────────
// These are imported for in-memory fallback when PostgreSQL is not connected.
// They read the same Maps that db.ts uses internally.
import {
    getSession as getSessionFromDB,
    getLatestPendingApproval,
} from '../database/db.js';

export async function handleSlashCommand(command: string, userId: string, replyFn: ReplyFn): Promise<boolean> {
    if (!command.startsWith('/')) {
        return false; // Not a slash command
    }

    const args = command.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();

    try {
        switch (cmd) {
            case '/status':
                await handleStatus(replyFn);
                return true;
            case '/sessions':
                await handleSessions(replyFn);
                return true;
            case '/nodes':
                await handleNodes(replyFn);
                return true;
            case '/usage':
                await handleUsage(replyFn);
                return true;
            case '/approve':
                if (args[1]) {
                    const approvalId = parseInt(args[1], 10);
                    if (isNaN(approvalId)) {
                        await replyFn('❌ Usage: `/approve <id>`', { parse_mode: 'Markdown' });
                        return true;
                    }
                    await resumeApprovedSession(approvalId, true, userId, replyFn, async () => { });
                } else {
                    await replyFn('❌ Usage: `/approve <id>`', { parse_mode: 'Markdown' });
                }
                return true;
            case '/reject':
                if (args[1]) {
                    const approvalId = parseInt(args[1], 10);
                    if (isNaN(approvalId)) {
                        await replyFn('❌ Usage: `/reject <id>`', { parse_mode: 'Markdown' });
                        return true;
                    }
                    await resumeApprovedSession(approvalId, false, userId, replyFn, async () => { });
                } else {
                    await replyFn('❌ Usage: `/reject <id>`', { parse_mode: 'Markdown' });
                }
                return true;
            case '/help':
                await replyFn(
                    `🛠 *Cloud-Claw Pilot Commands*\n\n` +
                    `/status — Show agent & approval queue status\n` +
                    `/sessions — List recent sessions\n` +
                    `/nodes — List managed server nodes\n` +
                    `/usage — Show LLM token usage and cost\n` +
                    `/approve <id> — Approve a pending HITL request\n` +
                    `/reject <id> — Reject a pending HITL request\n` +
                    `/model [<provider> <model>] — View or switch LLM backend`,
                    { parse_mode: 'Markdown' }
                );
                return true;
            case '/model':
                if (args.length >= 3) {
                    setGlobalLLMOverride(args[1], args[2]);
                    await replyFn(`✅ Switched to LLM Provider: *${args[1]}*\nModel: *${args[2]}*`, { parse_mode: 'Markdown' });
                } else {
                    const cfg = getCurrentLLMConfig();
                    await replyFn(`🤖 *Current LLM Backend*\nProvider: \`${cfg.provider}\`\nModel: \`${cfg.model}\`\n\n_Usage: /model <provider> <model>_`, { parse_mode: 'Markdown' });
                }
                return true;
            default:
                await replyFn(`❌ Unknown command: ${cmd}\nType /help for a list of commands.`);
                return true;
        }
    } catch (err) {
        console.error(`[SlashHandler] Error executing ${cmd}:`, err);
        await replyFn(`❌ Error executing command: ${err}`);
        return true;
    }
}

// ─── Handler implementations ───────────────────────────────────────────────────

async function handleStatus(replyFn: ReplyFn) {
    if (!isDBConfigured()) {
        const cfg = getCurrentLLMConfig();
        const msg = `📊 *Cloud-Claw Status (In-Memory Mode)*\n\n` +
            `*LLM:* \`${cfg.provider}\` / \`${cfg.model}\`\n` +
            `*Database:* Not connected — running in-memory\n` +
            `*Approvals:* Use the approval cards or \`/approve <id>\` to manage\n\n` +
            `_Connect PostgreSQL via DATABASE_URL for full status tracking._`;
        await replyFn(msg, { parse_mode: 'Markdown' });
        return;
    }
    const pool = getPool();
    const sessionsRes = await pool.query(`
        SELECT status, COUNT(*) as count 
        FROM sessions 
        WHERE updated_at >= NOW() - INTERVAL '24 hours' 
        GROUP BY status
    `);

    let active = 0, timedOut = 0, resolved = 0;
    for (const row of sessionsRes.rows) {
        if (row.status === 'active') active = parseInt(row.count, 10);
        else if (row.status === 'timed_out') timedOut = parseInt(row.count, 10);
        else if (row.status === 'resolved') resolved = parseInt(row.count, 10);
    }

    const approvalsRes = await pool.query(`SELECT COUNT(*) as pending FROM approval_queue WHERE status = 'pending'`);
    const pending = parseInt(approvalsRes.rows[0].pending, 10);

    const msg = `📊 *Cloud-Claw Status*\n\n` +
        `*Sessions (Last 24h):*\n` +
        `Active: ${active}\nTimed Out: ${timedOut}\nResolved: ${resolved}\n\n` +
        `*Approvals:*\n` +
        `Pending HITL requests: ${pending}`;
    await replyFn(msg, { parse_mode: 'Markdown' });
}

async function handleSessions(replyFn: ReplyFn) {
    if (!isDBConfigured()) {
        await replyFn(
            '📋 *Sessions (In-Memory Mode)*\n\n' +
            'Session history is not persisted without PostgreSQL.\n' +
            'Active sessions exist only in memory for this run.\n\n' +
            '_Connect PostgreSQL via DATABASE_URL for session history._',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    const pool = getPool();
    const { rows } = await pool.query(`
        SELECT id, status, problem_class, created_at 
        FROM sessions 
        ORDER BY created_at DESC 
        LIMIT 10
    `);

    if (rows.length === 0) {
        await replyFn('No sessions found.');
        return;
    }

    let msg = `📋 *Recent Sessions (Top 10)*\n\n`;
    for (const row of rows) {
        const idTrunc = row.id.split(':').pop()?.substring(0, 8) ?? row.id.substring(0, 8);
        const dateStr = new Date(row.created_at).toISOString().replace('T', ' ').substring(0, 16);
        const pClass = row.problem_class ? ` [${row.problem_class}]` : '';
        msg += `\`${idTrunc}\` (${row.status})${pClass} — ${dateStr}\n`;
    }
    await replyFn(msg, { parse_mode: 'Markdown' });
}

async function handleNodes(replyFn: ReplyFn) {
    if (!isDBConfigured()) {
        const msg = `🖥 *Nodes (In-Memory Mode)*\n\n` +
            FALLBACK_SERVERS.map((server) => `• ${formatServerTarget(server)}`).join('\n');
        await replyFn(msg, { parse_mode: 'Markdown' });
        return;
    }
    const rows = await getAllServers();

    if (rows.length === 0) {
        await replyFn('No nodes registered in the database.');
        return;
    }

    const activeCount = rows.filter(r => r.active).length;
    let msg = `🖥 *Active Nodes: ${activeCount}/${rows.length}*\n\n`;

    for (const row of rows) {
        const state = row.active ? '✅' : '❌';
        msg += `${state} *${row.label}* (${row.ip})\n`;
    }

    await replyFn(msg, { parse_mode: 'Markdown' });
}

async function handleUsage(replyFn: ReplyFn) {
    if (!isDBConfigured()) {
        await replyFn(
            '💰 *Usage (In-Memory Mode)*\n\n' +
            'Token usage is not tracked without PostgreSQL.\n\n' +
            '_Connect PostgreSQL via DATABASE_URL for cost tracking._',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    const pool = getPool();
    const { rows } = await pool.query(`
        SELECT 
            COUNT(*) as calls,
            SUM(tokens_in) as total_in,
            SUM(tokens_out) as total_out,
            SUM(cost_usd) as total_cost
        FROM usage_log
        WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    const stats = rows[0];
    const calls = parseInt(stats.calls || '0', 10);
    const cost = parseFloat(stats.total_cost || '0').toFixed(6);
    const tokens = parseInt(stats.total_in || '0', 10) + parseInt(stats.total_out || '0', 10);

    const msg = `💰 *Usage & Telemetry (Last 24h)*\n\n` +
        `Total LLM calls: ${calls}\n` +
        `Total Tokens (In+Out): ${tokens}\n` +
        `Estimated Cost: $${cost}`;
    await replyFn(msg, { parse_mode: 'Markdown' });
}
