/**
 * Cloudstick JWT Token Manager
 *
 * Exchanges APIKey/APISecret for a short-lived JWT, caches it in memory
 * per user, and refreshes it automatically before expiry.
 *
 * Assumptions about the v2 login API:
 *   POST /api/v2/users/login/
 *     body: { api_key: string, api_secret: string }
 *     response: { token: string, refresh_token: string, expires_in: number }  (expires_in = seconds)
 *
 *   POST /api/v2/users/refresh-token/
 *     body: { refresh_token: string }
 *     response: { token: string, refresh_token: string, expires_in: number }
 */

import axios from 'axios';

interface LoginResponse {
    token: string;
    refresh_token: string;
    expires_in: number;
}

interface TokenEntry {
    token: string;
    refreshToken: string;
    expiresAt: number;
}

// Refresh 60 seconds before actual expiry to avoid clock-skew races
const REFRESH_BUFFER_MS = 60_000;

export class CloudstickTokenManager {
    private readonly cache = new Map<string, TokenEntry>();
    private readonly baseURL: string;

    constructor(baseURL: string) {
        this.baseURL = baseURL;
    }

    /**
     * Returns a valid JWT for the given user, logging in or refreshing as needed.
     * Cache key is `${apiKey}` — one token per API key identity.
     */
    async getToken(apiKey: string, apiSecret: string): Promise<string> {
        const cacheKey = apiKey;
        const existing = this.cache.get(cacheKey);
        const now = Date.now();

        if (existing && existing.expiresAt - now > REFRESH_BUFFER_MS) {
            return existing.token;
        }

        if (existing && existing.expiresAt > now) {
            return this.refresh(cacheKey, existing.refreshToken);
        }

        return this.login(cacheKey, apiKey, apiSecret);
    }

    private async login(cacheKey: string, apiKey: string, apiSecret: string): Promise<string> {
        const resp = await axios.post<LoginResponse>(
            `${this.baseURL}/api/v2/users/login/`,
            { api_key: apiKey, api_secret: apiSecret },
            { headers: { 'Content-Type': 'application/json' } }
        );
        return this.store(cacheKey, resp.data);
    }

    private async refresh(cacheKey: string, refreshToken: string): Promise<string> {
        try {
            const resp = await axios.post<LoginResponse>(
                `${this.baseURL}/api/v2/users/refresh-token/`,
                { refresh_token: refreshToken },
                { headers: { 'Content-Type': 'application/json' } }
            );
            return this.store(cacheKey, resp.data);
        } catch {
            // Refresh token is expired — clear cache and fall back to full login
            this.cache.delete(cacheKey);
            throw new Error('Cloudstick token refresh failed — re-login required');
        }
    }

    private store(cacheKey: string, data: LoginResponse): string {
        this.cache.set(cacheKey, {
            token: data.token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
        });
        return data.token;
    }

    /** Evict a specific token (e.g. after a 401 response) */
    evict(apiKey: string): void {
        this.cache.delete(apiKey);
    }
}
