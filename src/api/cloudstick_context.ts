/**
 * Cloudstick Context — per-request user credential context.
 *
 * Set at the start of runAgentLoop() for the current Slack/Telegram user.
 * CloudstickApiClient.request() checks this first to use per-user credentials.
 * Falls back to env-level credentials when no user context is set.
 */

import type { CloudclawUser } from '../services/user_service.js';

let _currentUser: CloudclawUser | null = null;

export function setCloudstickUser(user: CloudclawUser | null): void {
    _currentUser = user;
}

export function getCloudstickUser(): CloudclawUser | null {
    return _currentUser;
}
