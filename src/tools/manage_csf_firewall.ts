/**
 * CSF (ConfigServer Security & Firewall) Management Tool
 *
 * SSH-based CSF operations. Cloudstick servers use CSF/LFD, not UFW.
 *
 * Read-only actions (Tier 1):  check_ip, check_config
 * Write actions   (Tier 3):    whitelist_ip, block_ip, remove_temp_block, reload, open_port
 */

import { sshExec } from '../utils/ssh.js';
import { resolveServerArg, formatServerTarget } from '../utils/server_registry.js';
import type { Tool, ToolResult } from './types.js';
import { encodeToolApprovalCommand } from '../hitl/tool_approval.js';

const WRITE_ACTIONS = new Set(['whitelist_ip', 'block_ip', 'remove_temp_block', 'reload', 'open_port']);

export const manageCsfFirewallTool: Tool = {
    name: 'manage_csf_firewall',
    description:
        'Manage the CSF (ConfigServer Security & Firewall) on a Cloudstick server via SSH. ' +
        'Read-only actions: check_ip (csf -g), check_config (grep TCP_IN/TCP_OUT from csf.conf). ' +
        'Write actions (HITL): whitelist_ip (csf -a), block_ip (csf -d), remove_temp_block (csf -tr), reload (csf -r), open_port (adds port to TCP_IN + reload). ' +
        'For MariaDB remote access: use open_port with port="3306".',
    parameters: {
        type: 'object',
        properties: {
            server_label: {
                type: 'string',
                description: 'Target server label (preferred over host)',
            },
            host: {
                type: 'string',
                description: 'Legacy: IP or hostname. Prefer server_label.',
            },
            action: {
                type: 'string',
                enum: ['check_ip', 'whitelist_ip', 'block_ip', 'remove_temp_block', 'reload', 'check_config', 'open_port'],
                description:
                    'check_ip: show all CSF rules matching an IP (csf -g). ' +
                    'whitelist_ip: permanently allow (csf -a). ' +
                    'block_ip: permanently deny (csf -d). ' +
                    'remove_temp_block: remove LFD temporary block (csf -tr). ' +
                    'reload: reload CSF rules (csf -r). ' +
                    'check_config: show TCP_IN/TCP_OUT open port lists from csf.conf. ' +
                    'open_port: add port to TCP_IN in csf.conf and reload CSF.',
            },
            ip: {
                type: 'string',
                description: 'IP address for check_ip, whitelist_ip, block_ip, or remove_temp_block actions.',
            },
            port: {
                type: 'string',
                description: 'Port number for open_port action (e.g. "3306", "8080").',
            },
            comment: {
                type: 'string',
                description: 'Comment to attach to the rule (optional, for whitelist/block).',
            },
        },
        required: ['action'],
    },
    approvalTier: 3,

    getApprovalRequest(args) {
        const action = String(args.action ?? '');
        if (!WRITE_ACTIONS.has(action)) return null; // read-only — skip approval

        const target = String(args.server_label ?? args.host ?? 'unknown');

        switch (action) {
            case 'whitelist_ip':
                return {
                    command: encodeToolApprovalCommand('manage_csf_firewall', {
                        action,
                        ip: String(args.ip ?? ''),
                        comment: String(args.comment ?? ''),
                        server_label: target,
                    }),
                    targetHost: target,
                    rationale: `Permanently whitelist IP ${args.ip} in CSF (csf -a).`,
                };
            case 'block_ip':
                return {
                    command: encodeToolApprovalCommand('manage_csf_firewall', {
                        action,
                        ip: String(args.ip ?? ''),
                        comment: String(args.comment ?? ''),
                        server_label: target,
                    }),
                    targetHost: target,
                    rationale: `Permanently block IP ${args.ip} in CSF (csf -d).`,
                };
            case 'remove_temp_block':
                return {
                    command: encodeToolApprovalCommand('manage_csf_firewall', {
                        action,
                        ip: String(args.ip ?? ''),
                        server_label: target,
                    }),
                    targetHost: target,
                    rationale: `Remove LFD temporary block for IP ${args.ip} (csf -tr).`,
                };
            case 'reload':
                return {
                    command: encodeToolApprovalCommand('manage_csf_firewall', {
                        action,
                        server_label: target,
                    }),
                    targetHost: target,
                    rationale: `Reload CSF firewall rules (csf -r). May briefly drop and restore established connections.`,
                };
            case 'open_port':
                return {
                    command: encodeToolApprovalCommand('manage_csf_firewall', {
                        action,
                        port: String(args.port ?? ''),
                        server_label: target,
                    }),
                    targetHost: target,
                    rationale: `Open port ${args.port} in CSF TCP_IN (/etc/csf/csf.conf) and reload CSF.`,
                };
            default:
                return null;
        }
    },

    getRationale(args) {
        const action = String(args.action ?? '');
        const target = String(args.server_label ?? args.host ?? 'this server');
        switch (action) {
            case 'whitelist_ip': return `Permanently whitelist ${args.ip} in CSF on ${target}.`;
            case 'block_ip': return `Permanently block ${args.ip} in CSF on ${target}.`;
            case 'remove_temp_block': return `Remove LFD temporary block for ${args.ip} on ${target}.`;
            case 'reload': return `Reload all CSF rules on ${target}.`;
            case 'open_port': return `Open port ${args.port} in CSF TCP_IN on ${target} and reload.`;
            default: return '';
        }
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const action = String(args.action ?? '').trim();
        const ip = String(args.ip ?? '').trim();
        const port = String(args.port ?? '').trim();
        const comment = String(args.comment ?? '').trim();

        // Basic validation
        if (!action) {
            return { success: false, output: 'Error: action is required.' };
        }

        const ipRequired = ['check_ip', 'whitelist_ip', 'block_ip', 'remove_temp_block'];
        if (ipRequired.includes(action) && !ip) {
            return { success: false, output: `Error: ip is required for action "${action}".` };
        }
        if (action === 'open_port' && !port) {
            return { success: false, output: 'Error: port is required for open_port action.' };
        }

        // IP format sanity check
        if (ip && !/^[\d.:/a-fA-F]+$/.test(ip)) {
            return { success: false, output: `Error: ip "${ip}" contains invalid characters.` };
        }
        if (port && !/^\d{1,5}$/.test(port)) {
            return { success: false, output: `Error: port "${port}" must be a numeric value.` };
        }

        try {
            const server = await resolveServerArg(args);
            const sshOptions = { user: server.sshUser, port: server.sshPort };
            const targetStr = formatServerTarget(server);

            switch (action) {
                // ── Read-only ──────────────────────────────────────────────────

                case 'check_ip': {
                    const out = await sshExec(server.ip, `csf -g ${ip} 2>&1`, sshOptions);
                    return {
                        success: true,
                        output: [
                            `CSF rules for IP ${ip} on ${targetStr}:`,
                            '```',
                            out || '(no rules found)',
                            '```',
                        ].join('\n'),
                    };
                }

                case 'check_config': {
                    const out = await sshExec(
                        server.ip,
                        `grep -E "^(TCP_IN|TCP_OUT|UDP_IN|UDP_OUT)" /etc/csf/csf.conf 2>&1`,
                        sshOptions,
                    );
                    const tempBlocks = await sshExec(
                        server.ip,
                        `csf -l 2>&1 | head -30`,
                        sshOptions,
                    ).catch(() => '(csf -l failed or empty)');
                    return {
                        success: true,
                        output: [
                            `CSF open port configuration on ${targetStr}:`,
                            '```',
                            out || '(could not read csf.conf)',
                            '```',
                            '',
                            'Active temp blocks (first 30):',
                            '```',
                            tempBlocks,
                            '```',
                        ].join('\n'),
                    };
                }

                // ── Write (Tier 3) ─────────────────────────────────────────────

                case 'whitelist_ip': {
                    const cmd = comment
                        ? `csf -a ${ip} ${comment.replace(/[^a-zA-Z0-9 _-]/g, '')} 2>&1`
                        : `csf -a ${ip} 2>&1`;
                    const out = await sshExec(server.ip, cmd, sshOptions);
                    return {
                        success: true,
                        output: `CSF whitelist — IP ${ip} allowed on ${targetStr}:\n${out}`,
                    };
                }

                case 'block_ip': {
                    const cmd = comment
                        ? `csf -d ${ip} ${comment.replace(/[^a-zA-Z0-9 _-]/g, '')} 2>&1`
                        : `csf -d ${ip} 2>&1`;
                    const out = await sshExec(server.ip, cmd, sshOptions);
                    return {
                        success: true,
                        output: `CSF block — IP ${ip} denied on ${targetStr}:\n${out}`,
                    };
                }

                case 'remove_temp_block': {
                    const out = await sshExec(server.ip, `csf -tr ${ip} 2>&1`, sshOptions);
                    return {
                        success: true,
                        output: `CSF temp block removed for ${ip} on ${targetStr}:\n${out}`,
                    };
                }

                case 'reload': {
                    const out = await sshExec(server.ip, `csf -r 2>&1`, sshOptions);
                    return {
                        success: true,
                        output: `CSF reloaded on ${targetStr}:\n${out}`,
                    };
                }

                case 'open_port': {
                    const portNum = parseInt(port, 10);
                    if (portNum < 1 || portNum > 65535) {
                        return { success: false, output: `Error: port ${port} is out of valid range (1–65535).` };
                    }

                    // 1. Read current TCP_IN
                    const currentTcpIn = await sshExec(
                        server.ip,
                        `grep -oP '^TCP_IN\\s*=\\s*"\\K[^"]+' /etc/csf/csf.conf 2>&1`,
                        sshOptions,
                    );

                    // 2. Check if port already present
                    const existingPorts = currentTcpIn.trim().split(',').map(p => p.trim());
                    if (existingPorts.includes(port)) {
                        return {
                            success: true,
                            output: `Port ${port} is already in CSF TCP_IN on ${targetStr}. No change needed.\nCurrent TCP_IN: ${currentTcpIn.trim()}`,
                        };
                    }

                    // 3. Surgically add port to TCP_IN using sed
                    const sedCmd = `sed -i 's/^\\(TCP_IN = "[^"]*\\)"/\\1,${port}"/' /etc/csf/csf.conf && echo "updated"`;
                    const sedOut = await sshExec(server.ip, sedCmd, sshOptions);

                    if (!sedOut.includes('updated')) {
                        return {
                            success: false,
                            output: `Failed to update TCP_IN in /etc/csf/csf.conf. Output: ${sedOut}`,
                        };
                    }

                    // 4. Verify
                    const newTcpIn = await sshExec(
                        server.ip,
                        `grep -oP '^TCP_IN\\s*=\\s*"\\K[^"]+' /etc/csf/csf.conf 2>&1`,
                        sshOptions,
                    );

                    // 5. Reload CSF
                    const reloadOut = await sshExec(server.ip, `csf -r 2>&1`, sshOptions);

                    return {
                        success: true,
                        output: [
                            `Port ${port} added to CSF TCP_IN on ${targetStr} and CSF reloaded.`,
                            `Previous TCP_IN: ${currentTcpIn.trim()}`,
                            `New TCP_IN:      ${newTcpIn.trim()}`,
                            '',
                            'CSF reload output:',
                            reloadOut,
                        ].join('\n'),
                    };
                }

                default:
                    return { success: false, output: `Unknown action: "${action}".` };
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `manage_csf_firewall failed: ${msg}` };
        }
    },
};
