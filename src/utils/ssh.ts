import { readFileSync } from 'fs';
import { Client as SSHClient } from 'ssh2';
import { env } from '../config/env.js';

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

const RETRYABLE_ERRORS = [
    'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
    'Connection refused', 'Timed out', 'socket hang up',
    'read ECONNRESET', 'write ECONNRESET'
];

const NON_RETRYABLE_ERRORS = [
    'Authentication failed', 'All configured authentication',
    'Cannot parse privateKey', 'Encrypted private key detected'
];

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
    options: { user?: string; port?: number; timeoutMs?: number } = {}
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!SSH_PRIVATE_KEY) {
            return reject(new Error('SSH_PRIVATE_KEY_PATH is not configured in .env'));
        }

        const conn = new SSHClient();
        let output = '';
        const timeoutMs = options.timeoutMs ?? 30_000;

        const timer = setTimeout(() => {
            conn.destroy();
            reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${command}`));
        }, timeoutMs);

        conn
            .on('ready', () => {
                conn.exec(command, (err, stream) => {
                    if (err) {
                        clearTimeout(timer);
                        conn.end();
                        return reject(err);
                    }
                    stream
                        .on('close', () => {
                            clearTimeout(timer);
                            conn.end();
                            resolve(output.trim());
                        })
                        .on('data', (data: Buffer) => {
                            output += data.toString();
                        })
                        .stderr.on('data', (data: Buffer) => {
                            output += data.toString();
                        });
                });
            })
            .on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

        try {
            conn.connect({
                host,
                port: options?.port ?? env.SSH_PORT,
                username: options?.user ?? env.SSH_USER,
                privateKey: SSH_PRIVATE_KEY,
                readyTimeout: 10_000,
            });
        } catch (err) {
            clearTimeout(timer);
            reject(err);
        }
    });
}

export async function sshExec(
    host: string,
    command: string,
    options: { retries?: number; timeoutMs?: number; timeout?: number; port?: number; user?: string } = {}
): Promise<string> {
    const retries = options.retries ?? MAX_RETRIES;
    const timeoutMs = options.timeoutMs ?? ((options.timeout ?? 30) * 1000);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await executeSSHCommand(host, command, {
                port: options.port ?? 22,
                user: options.user ?? 'root',
                timeoutMs,
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
