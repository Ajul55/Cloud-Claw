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

export function sanitizeDomain(domain: string): string {
    if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
        throw new Error(`Invalid domain format — only alphanumeric, dots, and hyphens allowed: ${domain}`);
    }
    return domain;
}

export async function sshExec(
    host: string,
    command: string,
    options?: { user?: string; port?: number; timeout?: number }
): Promise<string> {
    // TODO Level 2: implement hostVerifier using stored fingerprints from DB

    return new Promise((resolve, reject) => {
        if (!SSH_PRIVATE_KEY) {
            return reject(new Error('SSH_PRIVATE_KEY_PATH is not configured in .env'));
        }

        const conn = new SSHClient();
        let output = '';

        const timer = setTimeout(() => {
            conn.destroy();
            reject(new Error(`SSH command timed out after ${options?.timeout ?? 15}s: ${command}`));
        }, (options?.timeout ?? 15) * 1000);

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
