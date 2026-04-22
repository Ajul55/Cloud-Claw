/**
 * Multi-Tenant Cloudstick API Client
 *
 * Creates per-user CloudstickApiClient instances using each user's own
 * credentials (looked up from the users table), rather than env-level
 * shared credentials.
 */

import { CloudstickApiClient } from './cloudstick_client.js';
import type { CloudclawUser } from '../services/user_service.js';
import { hasCloudstickCredentials, getDecryptedCloudstickCredentials } from '../services/user_service.js';

export class MultiCloudstickApiClient {
    private clients = new Map<string, CloudstickApiClient>();

    /**
     * Get (or create) a CloudstickApiClient for a specific user.
     * Throws if the user has not configured their Cloudstick credentials.
     */
    getClient(user: CloudclawUser): CloudstickApiClient {
        if (!hasCloudstickCredentials(user)) {
            throw new Error(
                `Cloudstick credentials not configured for ${user.platform}:${user.platform_id}. ` +
                `Run /setup first to add your Cloudstick API key, secret, and user ID.`
            );
        }

        if (!this.clients.has(user.platform_id)) {
            const { apiKey, apiSecret } = getDecryptedCloudstickCredentials(user);
            const client = new CloudstickApiClient({
                apiKey: apiKey!,
                apiSecret: apiSecret!,
            });
            this.clients.set(user.platform_id, client);
        }

        return this.clients.get(user.platform_id)!;
    }

    /**
     * Invalidate the cached client for a user (e.g. after credential update).
     */
    invalidate(userPlatformId: string): void {
        this.clients.delete(userPlatformId);
    }

    /**
     * Check if a user has valid credentials configured.
     */
    isConfigured(user: CloudclawUser): boolean {
        return hasCloudstickCredentials(user);
    }
}

// Singleton instance
let _instance: MultiCloudstickApiClient | null = null;

export function getMultiCloudstickClient(): MultiCloudstickApiClient {
    if (!_instance) {
        _instance = new MultiCloudstickApiClient();
    }
    return _instance;
}
