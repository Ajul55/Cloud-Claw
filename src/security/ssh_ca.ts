/**
 * SSH Certificate Authority — Cloud-Claw
 *
 * Replaces static SSH key auth with short-lived signed certificates.
 *
 * How it works:
 *   1. Hub has a CA private key (SSH_CA_KEY_PATH, stored securely)
 *   2. Each server has the CA public key in authorized_keys:
 *      cert-authority ssh-ed25519 AAAA... cloudclaw-ca
 *   3. On each connection, the hub signs its public key with the CA key
 *      to generate a certificate valid for 1 hour
 *   4. The signed certificate is used for authentication
 *   5. Certificate expires automatically — no manual revocation needed
 *
 * Security improvement:
 *   Before: Compromise Hub VPS → own all servers forever
 *   After:  Compromise Hub VPS → own servers for <1 hour maximum
 *           CA key can live in AWS Secrets Manager, not on Hub VPS
 *
 * Setup (done once per server):
 *   echo "cert-authority $(cat cloudclaw-ca.pub)" >> /root/.ssh/authorized_keys
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { env } from '../config/env.js';

const execFileAsync = promisify(execFile);

const CERT_VALIDITY = '+1h';              // cert expires in 1 hour
const CLEANUP_DELAY_MS = 70 * 60 * 1000;  // clean up cert file after 70 minutes

// Track active cert files for cleanup on shutdown
const activeCertFiles = new Set<string>();

/**
 * Check if SSH Certificate Authority is configured.
 * Returns true only when both the CA key and the user's public key are available.
 */
export function isSSHCAConfigured(): boolean {
    return !!(
        env.SSH_CA_KEY_PATH &&
        env.SSH_PUBLIC_KEY_PATH &&
        existsSync(env.SSH_CA_KEY_PATH) &&
        existsSync(env.SSH_PUBLIC_KEY_PATH)
    );
}

/**
 * Generate a short-lived SSH certificate by signing the user's public key
 * with the CA private key.
 *
 * @returns Path to the generated certificate file, or null if CA is not configured.
 */
export async function getSignedCert(): Promise<string | null> {
    if (!isSSHCAConfigured()) {
        return null;
    }

    const certId = `cloudclaw-${randomBytes(8).toString('hex')}`;
    const pubKeyPath = env.SSH_PUBLIC_KEY_PATH!;
    const caKeyPath = env.SSH_CA_KEY_PATH!;
    const certPath = `/tmp/${certId}-cert.pub`;

    try {
        // Sign the public key with the CA private key.
        // Using execFile (not execSync/exec) to avoid shell injection and
        // to prevent blocking the event loop during certificate signing.
        // -s: signing key (CA private key)
        // -I: certificate identity (for audit logs)
        // -n: principal (username allowed to use this cert)
        // -V: validity period
        // -z: serial number
        await execFileAsync('ssh-keygen', [
            '-s', caKeyPath,
            '-I', certId,
            '-n', env.SSH_USER ?? 'root',
            '-V', CERT_VALIDITY,
            '-z', '1',
            pubKeyPath,
            '-O', 'no-port-forwarding',
            '-O', 'no-agent-forwarding',
            '-O', 'no-x11-forwarding',
        ], { timeout: 10_000 });

        // ssh-keygen outputs to <pubKeyPath>-cert.pub, we need to find it
        const expectedOutputPath = pubKeyPath.replace(/\.pub$/, '-cert.pub');
        if (existsSync(expectedOutputPath)) {
            // Move to our unique path to avoid collisions
            const certContent = readFileSync(expectedOutputPath);
            const { writeFileSync } = await import('fs');
            writeFileSync(certPath, certContent, { mode: 0o600 });
            unlinkSync(expectedOutputPath);
        } else if (!existsSync(certPath)) {
            console.error(`[ssh-ca] Certificate not found at expected path: ${expectedOutputPath}`);
            return null;
        }

        activeCertFiles.add(certPath);

        // Auto-cleanup after cert expires + 10 minute buffer
        setTimeout(() => {
            try {
                if (existsSync(certPath)) {
                    unlinkSync(certPath);
                    console.log(`[ssh-ca] Cleaned up expired cert: ${certId}`);
                }
            } catch { /* ignore cleanup errors */ }
            activeCertFiles.delete(certPath);
        }, CLEANUP_DELAY_MS);

        console.log(`[ssh-ca] Generated cert ${certId} (valid ${CERT_VALIDITY})`);
        return certPath;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ssh-ca] Failed to sign certificate: ${msg}`);
        // Clean up any partial files
        try { if (existsSync(certPath)) unlinkSync(certPath); } catch { /* ignore */ }
        return null;
    }
}

/**
 * Read the certificate content from disk.
 * Returns the certificate as a Buffer, or null if not available.
 */
export function readCertificate(certPath: string): Buffer | null {
    try {
        return readFileSync(certPath);
    } catch {
        return null;
    }
}

/**
 * Clean up all active certificate files (called on shutdown).
 */
export function cleanupAllCerts(): void {
    for (const certPath of activeCertFiles) {
        try {
            if (existsSync(certPath)) {
                unlinkSync(certPath);
            }
        } catch { /* ignore */ }
    }
    activeCertFiles.clear();
    console.log('[ssh-ca] Cleaned up all active certificates');
}
