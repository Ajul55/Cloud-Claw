/**
 * Cloudstick Context — per-request user credential context.
 *
 * Uses AsyncLocalStorage to scope user credentials to the current async
 * call chain. This is safe for concurrent requests — Request A's context
 * never leaks into Request B, even under PM2 cluster mode.
 *
 * Usage:
 *   // At request boundary (loop.ts, slash_handler.ts):
 *   await runWithCloudstickContext(user, async () => {
 *       // All code in this callback can call getCloudstickUser()
 *       // and get the correct user, no matter how deep the call stack.
 *   });
 *
 *   // Anywhere in tools, shared.ts, ssh.ts, etc.:
 *   const user = getCloudstickUser();
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { CloudclawUser } from '../services/user_service.js';

interface CloudstickContext {
    user: CloudclawUser | null;
}

// Module-level instance (created once, never mutated)
const storage = new AsyncLocalStorage<CloudstickContext>();

/**
 * Run a function with the given Cloudstick user scoped to its async context.
 * All calls to getCloudstickUser() within fn (and its call tree) will return
 * the provided user — no prop drilling required.
 */
export function runWithCloudstickContext<T>(
    user: CloudclawUser | null,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    return storage.run({ user }, fn);
}

/**
 * Get the Cloudstick user for the current async context.
 * Returns null if called outside of runWithCloudstickContext().
 */
export function getCloudstickUser(): CloudclawUser | null {
    return storage.getStore()?.user ?? null;
}

/**
 * @deprecated Use runWithCloudstickContext() instead.
 * Kept temporarily for backward compatibility during migration.
 * This is a no-op when AsyncLocalStorage is active.
 */
export function setCloudstickUser(_user: CloudclawUser | null): void {
    // No-op — context is now managed via AsyncLocalStorage.
    // Calls to this function are safe to leave in place during migration,
    // but new code should use runWithCloudstickContext().
}
