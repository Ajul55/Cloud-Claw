/**
 * Interactive Message Builders
 *
 * Slack Block Kit payloads for interactive UI elements.
 * Used by the agent loop to replace plain-text prompts with buttons
 * for server selection and clarification pauses.
 *
 * Platform note: these are Slack-only. The loop falls back to plain text for Telegram.
 *
 * IMPORTANT: Slack requires every interactive element within an `actions` block
 * to have a UNIQUE action_id. Duplicate IDs cause `invalid_blocks` errors.
 *
 * Conventions:
 *   Server selection  → action_id: `select_server__<label>`  (one per server)
 *   Clarification yes → action_id: `clarification_proceed`
 *   Clarification no  → action_id: `clarification_cancel`
 */

import type { ServerNode } from '../utils/server_registry.js';

/** Sanitize a server label into a valid Slack action_id segment (a-z, 0-9, _, -) */
function toActionSegment(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 60);
}

/**
 * Builds a Block Kit message for server selection.
 * Each button gets a unique action_id: `select_server__<label>`.
 * The action handler in slack.ts uses a regex `/^select_server__/` to catch all.
 */
export function buildServerSelectionBlocks(servers: ServerNode[]): any[] {
    const buttons = servers.map(server => ({
        type: 'button',
        text: { type: 'plain_text', text: server.label, emoji: false },
        value: server.label,
        action_id: `select_server__${toActionSegment(server.label)}`,
    }));

    return [
        {
            type: 'header',
            text: { type: 'plain_text', text: 'Multiple Servers Found', emoji: false },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: 'Which server should I run this on?',
            },
        },
        {
            type: 'actions',
            elements: buttons,
        },
    ];
}

/**
 * Builds a Block Kit message for the clarification pause.
 * Uses distinct action_ids: `clarification_proceed` and `clarification_cancel`.
 */
export function buildClarificationBlocks(summary: string): any[] {
    // Slack section text max is 3000 chars
    const safeText = summary.slice(0, 2800);

    return [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Multiple tool attempts failed — review before continuing*\n\n${safeText}`,
            },
        },
        {
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: { type: 'plain_text', text: 'Proceed', emoji: false },
                    style: 'primary',
                    value: 'proceed',
                    action_id: 'clarification_proceed',
                },
                {
                    type: 'button',
                    text: { type: 'plain_text', text: 'Stop',  emoji: false },
                    style: 'danger',
                    value: 'cancel',
                    action_id: 'clarification_cancel',
                },
            ],
        },
    ];
}
