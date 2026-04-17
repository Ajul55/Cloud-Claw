import { readFileSync } from 'fs';
import { Client as SSHClient } from 'ssh2';
import { env } from '../config/env.js';
import { getUserByPlatformId, getDecryptedSshKey } from '../services/user_service.js';
import { getCloudstickUser } from '../api/cloudstick_context.js';
import { isSSHCAConfigured, getSignedCert, readCertificate } from '../security/ssh_ca.js';

let cachedKey: Buffer | null = null;
try {
    if (env.SSH_PRIVATE_KEY_PATH) {
        cachedKey = readFileSync(env.SSH_PRIVATE_KEY_PATH);
    }
} catch (err) {
    console.error(`[ssh] Failed to read cached private key at ${env.SSH_PRIVATE_KEY_PATH}`, err);
    cachedKey = null;
}

export const SSH_PRIVATE_KEY: Buffer | null = cachedKey;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 2000;

// ─── SSH Connection Pool (Multiplexing) ───────────────────────────────────────
// Reuses persistent connections instead of creating new TCP+SSH auth each time.
// This prevents rate-limit / fail2ban triggers from repeated connection attempts.

interface PooledConnection {
    conn: SSHClient;
    inUse: boolean;
    lastUsed: number;
}

const MAX_IDLE_MS = 60_000; // Close idle connections after 60 seconds
const MAX_CONNECTIONS_PER_HOST = 2;

const connectionPool = new Map<string, PooledConnection[]>();

function poolKey(host: string, port: number, user: string): string {
    return `${user}@${host}:${port}`;
}

function releaseConnection(host: string, port: number, user: string, conn: SSHClient): void {
    const hostKey = poolKey(host, port, user);
    const pool = connectionPool.get(hostKey);
    if (!pool) return;
    const pooled = pool.find(p => p.conn === conn);
    if (pooled) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();
    }
}

function closePooledConn(pooled: PooledConnection): void {
    try { pooled.conn.end(); } catch {}
}

function cleanupPool(hostKey: string): void {
    const pool = connectionPool.get(hostKey);
    if (!pool) return;
    const now = Date.now();
    const active = pool.filter(p => {
        if (!p.inUse && (now - p.lastUsed) > MAX_IDLE_MS) {
            closePooledConn(p);
            return false;
        }
        return true;
    });
    if (active.length === 0) {
        connectionPool.delete(hostKey);
    } else {
        connectionPool.set(hostKey, active);
    }
}

async function getPooledConnection(
    host: string,
    port: number,
    user: string,
    key: Buffer,
    certificate?: Buffer | null
): Promise<SSHClient> {
    const hostKey = poolKey(host, port, user);

    // Clean up old connections first
    cleanupPool(hostKey);

    const pool = connectionPool.get(hostKey) ?? [];

    // Try to reuse an idle, healthy connection
    for (const pooled of pool) {
        if (!pooled.inUse) {
            pooled.inUse = true;
            pooled.lastUsed = Date.now();
            console.log(`[ssh] Reusing pooled connection for ${hostKey}`);
            return pooled.conn;
        }
    }

    // Need a new connection — respect per-host limit
    if (pool.length >= MAX_CONNECTIONS_PER_HOST) {
        // Wait for a connection to become available
        await new Promise(resolve => setTimeout(resolve, 500));
        return getPooledConnection(host, port, user, key, certificate);
    }

    console.log(`[ssh] Creating new SSH connection for ${hostKey}`);
    const conn = await connectSSH(host, port, user, key, certificate);
    const pooled: PooledConnection = { conn, inUse: true, lastUsed: Date.now() };
    pool.push(pooled);
    connectionPool.set(hostKey, pool);
    return conn;
}

function connectSSH(
    host: string,
    port: number,
    user: string,
    key: Buffer,
    certificate?: Buffer | null
): Promise<SSHClient> {
    return new Promise((resolve, reject) => {
        const conn = new SSHClient();
        const timer = setTimeout(() => {
            conn.end();
            reject(new Error(`SSH connect timed out for ${host}:${port}`));
        }, 15_000);

        conn.on('ready', () => {
            clearTimeout(timer);
            if (certificate) {
                console.log(`[ssh] Connected to ${host}:${port} using SSH certificate`);
            }
            resolve(conn);
        });
        conn.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        // W1: Pass certificate for CA-based auth when available
        const connectOpts: Record<string, unknown> = {
            host,
            port,
            username: user,
            privateKey: key,
            readyTimeout: 10_000,
        };
        if (certificate) {
            (connectOpts as any).certificate = certificate;
        }

        conn.connect(connectOpts as any);
    });
}

// Periodic pool cleanup — run every 30 seconds
setInterval(() => {
    for (const hostKey of connectionPool.keys()) {
        cleanupPool(hostKey);
    }
}, 30_000);

const RETRYABLE_ERRORS = [
    'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
    'Connection refused', 'Timed out', 'socket hang up',
    'read ECONNRESET', 'write ECONNRESET'
];

const NON_RETRYABLE_ERRORS = [
    'Authentication failed', 'All configured authentication',
    'Cannot parse privateKey', 'Encrypted private key detected'
];

const MAX_OUTPUT_BYTES = 50_000;

/**
 * Load and decrypt the SSH key pair for a specific user.
 * Returns null if the user has not configured an SSH key via /setkey.
 */
export async function loadUserSshKey(
    platform: 'slack' | 'telegram',
    platformId: string
): Promise<{ privateKey: Buffer; publicKey: string } | null> {
    const user = await getUserByPlatformId(platform, platformId);
    if (!user) return null;
    const decrypted = getDecryptedSshKey(user);
    if (!decrypted || !user.ssh_public_key) return null;
    return {
        privateKey: Buffer.from(decrypted),
        publicKey: user.ssh_public_key,
    };
}

export function sanitizeDomain(domain: string): string {
    if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
        throw new Error(`Invalid domain format — only alphanumeric, dots, and hyphens allowed: ${domain}`);
    }
    return domain;
}

function isRetryable(err: Error): boolean {
    if (NON_RETRYABLE_ERRORS.some((msg) => err.message.includes(msg))) return false;
    return RETRYABLE_ERRORS.some((msg) => err.message.includes(msg));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeSSHCommand(
    host: string,
    command: string,
    options: { user?: string; port?: number; timeoutMs?: number; privateKey?: Buffer } = {}
): Promise<string> {
    // Priority: explicit privateKey > per-user DB key > .env cached key
    let key = options.privateKey ?? null;

    if (!key) {
        // Try per-user SSH key from current Cloudstick context
        const ctx = getCloudstickUser();
        if (ctx?.ssh_private_key) {
            try {
                const decrypted = getDecryptedSshKey(ctx);
                if (decrypted) {
                    key = Buffer.from(decrypted);
                    console.log(`[ssh] Using per-user SSH key for ${host}`);
                }
            } catch (err) {
                console.warn(`[ssh] Failed to decrypt per-user SSH key, falling back to .env key`, err);
            }
        }
    }

    // Fallback to .env cached key
    if (!key) {
        key = SSH_PRIVATE_KEY;
    }

    if (!key) {
        throw new Error('SSH private key is not configured — set SSH_PRIVATE_KEY_PATH in .env or run /setkey');
    }

    const port = options.port ?? env.SSH_PORT ?? 22;
    const user = options.user ?? env.SSH_USER ?? 'root';
    const timeoutMs = options.timeoutMs ?? 30_000;

    // W1: Try SSH Certificate Authority (short-lived signed cert)
    let certificate: Buffer | null = null;
    if (isSSHCAConfigured()) {
        try {
            const certPath = await getSignedCert();
            if (certPath) {
                certificate = readCertificate(certPath);
                if (certificate) {
                    console.log(`[ssh] Using SSH CA certificate for ${host}`);
                }
            }
        } catch (err) {
            console.warn(`[ssh] SSH CA cert generation failed, falling back to key auth:`, err);
        }
    }

    // Use connection pool for multiplexing
    const conn = await getPooledConnection(host, port, user, key, certificate);

    return new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => {
            releaseConnection(host, port, user, conn);
            reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${command}`));
        }, timeoutMs);

        conn.exec(command, (err, stream) => {
            if (err) {
                clearTimeout(timer);
                releaseConnection(host, port, user, conn);
                return reject(err);
            }
            stream
                .on('close', () => {
                    clearTimeout(timer);
                    releaseConnection(host, port, user, conn);
                    if (output.length > MAX_OUTPUT_BYTES) {
                        output = output.slice(0, MAX_OUTPUT_BYTES) + '\n...[truncated at 50KB]';
                    }
                    resolve(output.trim());
                })
                .on('data', (data: Buffer) => {
                    output += data.toString();
                })
                .stderr.on('data', (data: Buffer) => {
                    output += data.toString();
                });
        });
    });
}

export async function sshExec(
    host: string,
    command: string,
    options: { retries?: number; timeoutMs?: number; timeout?: number; port?: number; user?: string; privateKey?: Buffer } = {}
): Promise<string> {
    const retries = options.retries ?? MAX_RETRIES;
    const timeoutMs = options.timeoutMs ?? ((options.timeout ?? 30) * 1000);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await executeSSHCommand(host, command, {
                port: options.port ?? 22,
                user: options.user ?? 'root',
                timeoutMs,
                privateKey: options.privateKey,
            });
            if (attempt > 1) {
                console.log(`[ssh] Connected on attempt ${attempt}/${retries} for ${host}`);
            }
            return result;
        } catch (err: any) {
            const error = err instanceof Error ? err : new Error(String(err));
            const isLast = attempt === retries;
            const retryable = isRetryable(error);

            console.warn(`[ssh] Attempt ${attempt}/${retries} failed for ${host}: ${error.message}`);

            if (isLast || !retryable) {
                throw new Error(`SSH failed on ${host} after ${attempt} attempt(s): ${error.message}`);
            }

            const delay = BASE_RETRY_DELAY_MS * attempt;
            console.log(`[ssh] Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }

    throw new Error('SSH exhausted all retries');
}
