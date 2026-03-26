import { getPool, isDBConfigured } from '../database/db.js';
import { resumeApprovedSession } from '../hitl/resume.js';
import { setGlobalLLMOverride, getCurrentLLMConfig } from '../llm/provider.js';
import { setCloudstickUser } from '../api/cloudstick_context.js';
import { setUserCloudstickCredentials, setUserSshKey, getUserByPlatformId } from '../services/user_service.js';
import { decodeCloudstickJwtUserId } from '../utils/crypto.js';
import type { ReplyFn } from '../tools/types.js';
import { formatServerTarget, getAllServers } from '../utils/server_registry.js';

export async function handleSlashCommand(
    command: string,
    platform: 'slack' | 'telegram',
    userId: string,
    replyFn: ReplyFn
): Promise<boolean> {
    if (!command.startsWith('/')) {
        return false;
    }

    const args = command.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();

    try {
        switch (cmd) {
            case '/setup':
                await handleSetup(platform, userId, args, replyFn);
                return true;
            case '/status':
                await handleStatus(replyFn);
                return true;
            case '/sessions':
                await handleSessions(replyFn);
                return true;
            case '/nodes':
                await handleNodes(platform, userId, replyFn);
                return true;
            case '/usage':
                await handleUsage(replyFn);
                return true;
            case '/approve':
                if (args[1]) {
                    const approvalId = parseInt(args[1], 10);
                    if (isNaN(approvalId)) {
                        await replyFn('❌ Usage: `/approve <id>`');
                        return true;
                    }
                    await resumeApprovedSession(approvalId, true, userId, replyFn, async () => { });
                } else {
                    await replyFn('❌ Usage: `/approve <id>`');
                }
                return true;
            case '/reject':
                if (args[1]) {
                    const approvalId = parseInt(args[1], 10);
                    if (isNaN(approvalId)) {
                        await replyFn('❌ Usage: `/reject <id>`');
                        return true;
                    }
                    await resumeApprovedSession(approvalId, false, userId, replyFn, async () => { });
                } else {
                    await replyFn('❌ Usage: `/reject <id>`');
                }
                return true;
            case '/help':
                await replyFn(
                    '🛠 *Cloud-Claw Pilot Commands*\n\n' +
                    '/setup <api_key> <api_secret> <user_id> — Configure your Cloudstick API credentials\n' +
                    '/status — Show agent & approval queue status\n' +
                    '/sessions — List recent sessions\n' +
                    '/nodes — List managed server nodes\n' +
                    '/usage — Show LLM token usage and cost\n' +
                    '/approve <id> — Approve a pending HITL request\n' +
                    '/reject <id> — Reject a pending HITL request\n' +
                    '/setkey <private_key> <public_key> — Store SSH key for this user\n' +
                    '/model [<provider> <model>] — View or switch LLM backend',
                    { parse_mode: 'Markdown' }
                );
                return true;
            case '/model':
                if (args.length >= 3) {
                    setGlobalLLMOverride(args[1], args[2]);
                    await replyFn(`✅ Switched to LLM Provider: *${args[1]}*\nModel: *${args[2]}*`, { parse_mode: 'Markdown' });
                } else {
                    const cfg = getCurrentLLMConfig();
                    await replyFn(
                        `🤖 *Current LLM Backend*\nProvider: \`${cfg.provider}\`\nModel: \`${cfg.model}\`\n\n_Usage: /model <provider> <model>_`,
                        { parse_mode: 'Markdown' }
                    );
                }
                return true;
            case '/setkey':
                await handleSetKey(platform, userId, args, replyFn);
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

async function handleSetup(
    platform: 'slack' | 'telegram',
    userId: string,
    args: string[],
    replyFn: ReplyFn
) {
    if (!isDBConfigured()) {
        await replyFn(
            '❌ Database not connected. Setup requires PostgreSQL.\n' +
            'Connect via DATABASE_URL environment variable.'
        );
        return;
    }

    if (args.length < 3) {
        await replyFn(
            '📋 *Cloud-Claw Setup*\n\n' +
            'To configure your Cloudstick API credentials, run:\n' +
            '`/setup <api_key> <api_secret>`\n\n' +
            'Example:\n' +
            '`/setup cs_live_abc123 eyJhbGciOiJFUzI1NiJ9...`\n\n' +
            'Your user ID is extracted automatically from the API secret JWT.\n' +
            'Credentials are stored encrypted in the database and never logged.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const [, apiKey, apiSecret] = args;

    // Extract user_id from the JWT payload in the API secret
    let cloudstickUserId: string;
    try {
        cloudstickUserId = decodeCloudstickJwtUserId(apiSecret);
    } catch (err) {
        await replyFn(`❌ Invalid API secret: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }

    try {
        await setUserCloudstickCredentials(platform, userId, apiKey, apiSecret, cloudstickUserId);
        await replyFn(
            '✅ *Cloudstick credentials configured!*\n\n' +
            `Platform: \`${platform}\`\n` +
            `User ID: \`${cloudstickUserId}\`\n\n` +
            'Run `/nodes` to verify Cloudstick connectivity and see your servers.',
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('[SlashHandler] /setup error:', err);
        await replyFn(`❌ Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function handleSetKey(
    platform: 'slack' | 'telegram',
    userId: string,
    args: string[],
    replyFn: ReplyFn
) {
    if (!isDBConfigured()) {
        await replyFn(
            '❌ Database not connected. SSH key storage requires PostgreSQL.\n' +
            'Connect via DATABASE_URL environment variable.'
        );
        return;
    }

    // Reconstruct the full input (args were split on whitespace)
    const fullInput = args.slice(1).join(' ');

    // Extract private key block: -----BEGIN ... PRIVATE KEY----- ... -----END ... PRIVATE KEY-----
    const privKeyMatch = fullInput.match(/(-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----)/);
    if (!privKeyMatch) {
        await replyFn(
            '🔐 *SSH Key Setup*\n\n' +
            'To store your SSH private key, paste your keys in this format:\n' +
            '`/setkey <private_key> <public_key>`\n\n' +
            'Example:\n' +
            '`/setkey -----BEGIN OPENSSH PRIVATE KEY-----\\n... -----END OPENSSH PRIVATE KEY----- ssh-rsa AAAA...`\n\n' +
            'Your private key is encrypted with AES-256-GCM and stored in the database.\n' +
            'It is never logged or exposed.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const privateKey = privKeyMatch[1].trim();

    // Everything after the private key block is the public key
    const afterPrivateKey = fullInput.substring(fullInput.indexOf(privKeyMatch[0]) + privKeyMatch[0].length).trim();
    const publicKey = afterPrivateKey || '';

    if (!publicKey) {
        await replyFn('❌ Public key not found after private key block.\nUsage: `/setkey <private_key> <public_key>`');
        return;
    }

    try {
        // Normalize the private key: ensure proper line breaks in the base64 body
        const normalizedPrivateKey = normalizeOpenSshKey(privateKey);
        await setUserSshKey(platform, userId, normalizedPrivateKey, publicKey.trim());
        await replyFn(
            '✅ *SSH key configured!*\n\n' +
            `Platform: \`${platform}\`\n\n` +
            'Your SSH key is stored encrypted and will be used for server access.\n' +
            'Run `/nodes` to verify connectivity.',
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error('[SlashHandler] /setkey error:', err);
        await replyFn(`❌ Failed to store SSH key: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Normalize an OpenSSH private key pasted from Slack.
 * Slack collapses newlines into spaces, so we need to reconstruct
 * proper PEM-style line breaks (70-char base64 lines).
 */
function normalizeOpenSshKey(raw: string): string {
    // Match header and footer
    const headerMatch = raw.match(/^(-----BEGIN[A-Z\s]+PRIVATE KEY-----)/);
    const footerMatch = raw.match(/(-----END[A-Z\s]+PRIVATE KEY-----)$/);
    if (!headerMatch || !footerMatch) return raw;

    const header = headerMatch[1];
    const footer = footerMatch[1];

    // Extract the base64 body between header and footer
    let body = raw
        .replace(header, '')
        .replace(footer, '')
        .replace(/\s+/g, ''); // Remove all whitespace from the base64 body

    // Split into 70-char lines (standard PEM format)
    const lines: string[] = [];
    while (body.length > 0) {
        lines.push(body.substring(0, 70));
        body = body.substring(70);
    }

    return `${header}\n${lines.join('\n')}\n${footer}\n`;
}

async function handleStatus(replyFn: ReplyFn) {
    if (!isDBConfigured()) {
        const cfg = getCurrentLLMConfig();
        const msg =
            '📊 *Cloud-Claw Status (In-Memory Mode)*\n\n' +
            `*LLM:* \`${cfg.provider}\` / \`${cfg.model}\`\n` +
            '*Database:* Not connected — running in-memory\n' +
            '*Approvals:* Use the approval cards or `/approve <id>` to manage\n\n' +
            '_Connect PostgreSQL via DATABASE_URL for full status tracking._';
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

    const msg =
        '📊 *Cloud-Claw Status*\n\n' +
        '*Sessions (Last 24h):*\n' +
        `Active: ${active}\nTimed Out: ${timedOut}\nResolved: ${resolved}\n\n` +
        '*Approvals:*\n' +
        `Pending HITL requests: ${pending}`;
    await replyFn(msg, { parse_mode: 'Markdown' });
}

async function handleSessions(replyFn: ReplyFn) {
    if (!isDBConfigured()) {
        await replyFn(
            '📋 *Sessions (In-Memory Mode)*\n\n' +
            'Session history is not persisted without PostgreSQL.\n' +
            'Active sessions exist only in memory for this run.\n\n' +
            '_Connect PostgreSQL via DATABASE_URL for session history._'
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

    let msg = '📋 *Recent Sessions (Top 10)*\n\n';
    for (const row of rows) {
        const idTrunc = row.id.split(':').pop()?.substring(0, 8) ?? row.id.substring(0, 8);
        const dateStr = new Date(row.created_at).toISOString().replace('T', ' ').substring(0, 16);
        const pClass = row.problem_class ? ` [${row.problem_class}]` : '';
        msg += `\`${idTrunc}\` (${row.status})${pClass} — ${dateStr}\n`;
    }
    await replyFn(msg, { parse_mode: 'Markdown' });
}

async function handleNodes(
    platform: 'slack' | 'telegram',
    userId: string,
    replyFn: ReplyFn
) {
    if (!isDBConfigured()) {
        await replyFn(
            '🖥 *Nodes*\n\nNo database connected. Connect PostgreSQL via DATABASE_URL to manage nodes.'
        );
        return;
    }

    // Set per-user Cloudstick context so getAllServers() uses the right credentials
    const user = await getUserByPlatformId(platform, userId);
    setCloudstickUser(user);

    try {
        const rows = await getAllServers();

        if (rows.length === 0) {
            await replyFn('No nodes found in Cloudstick. Add servers to your Cloudstick account first, then run `/nodes`.');
            return;
        }

        const activeCount = rows.filter(r => r.active).length;
        let msg = `🖥 *Active Nodes: ${activeCount}/${rows.length}*\n\n`;

        for (const row of rows) {
            const state = row.active ? '✅' : '❌';
            msg += `${state} *${row.label}* (${row.ip})\n`;
        }

        await replyFn(msg, { parse_mode: 'Markdown' });
    } finally {
        setCloudstickUser(null); // Clear context after use
    }
}

async function handleUsage(replyFn: ReplyFn) {
    if (!isDBConfigured()) {
        await replyFn(
            '💰 *Usage (In-Memory Mode)*\n\n' +
            'Token usage is not tracked without PostgreSQL.\n\n' +
            '_Connect PostgreSQL via DATABASE_URL for cost tracking._'
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

    const msg =
        '💰 *Usage & Telemetry (Last 24h)*\n\n' +
        `Total LLM calls: ${calls}\n` +
        `Total Tokens (In+Out): ${tokens}\n` +
        `Estimated Cost: $${cost}`;
    await replyFn(msg, { parse_mode: 'Markdown' });
}
