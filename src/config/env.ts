import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
    // LLM
    LLM_API_KEY: z.preprocess((val) => val === '' ? undefined : val, z.string().min(1).optional()),

    LLM_BASE_URL: z.string().url().optional(),
    LLM_MODEL: z.string().default('gpt-4o'),
    LLM_PROVIDER: z.enum(['openai', 'anthropic', 'groq', 'minimax']).default('openai'),
    // HIGH-9: Optional fallback provider activated by circuit breaker after 3 failures
    LLM_FALLBACK_PROVIDER: z.enum(['openai', 'anthropic', 'groq', 'minimax']).optional(),
    LLM_FALLBACK_MODEL: z.string().optional(),

    // Additional API keys for switching
    ANTHROPIC_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    MINIMAX_API_KEY: z.string().optional(),
    SERPAPI_KEY: z.string().optional(),
    CLOUDFLARE_API_TOKEN: z.string().optional(),
    CLOUDFLARE_ZONE_ID: z.string().optional(),
    CLOUDFLARE_DOMAIN: z.string().optional(),

    // Cloudstick API Config
    CLOUDSTICK_API_BASE: z.string().url().default('https://api.cloudstick.io'),
    // WebSocket base URL — set when WS runs on a different host/port than the REST API
    // (e.g. ws://192.46.211.196:8080). Falls back to CLOUDSTICK_API_BASE with protocol swap.
    CLOUDSTICK_WS_BASE: z.string().optional(),
    CLOUDSTICK_API_KEY: z.string().optional(),
    CLOUDSTICK_API_SECRET: z.string().optional(),
    CLOUDSTICK_USER_ID: z.string().optional(),

    // Sentinel
    PILOT_CHAT_ID: z.string().optional(),

    // Telegram (optional — bot starts without it)
    TELEGRAM_BOT_TOKEN: z.preprocess((val) => val === '' ? undefined : val, z.string().min(1).optional()),
    TELEGRAM_USER_ID: z.preprocess((val) => val === '' ? undefined : val, z.coerce.number().int().positive().optional()),

    // Slack
    SLACK_BOT_TOKEN: z.preprocess((val) => val === '' ? undefined : val, z.string().min(1).optional()),
    SLACK_APP_TOKEN: z.preprocess((val) => val === '' ? undefined : val, z.string().min(1).optional()),
    SLACK_USER_ID: z.preprocess((val) => val === '' ? undefined : val, z.string().min(1).optional()),
    SLACK_CHANNEL_ID: z.string().optional(),

    // Voyage AI — semantic embeddings for fix memory
    VOYAGE_API_KEY: z.string().optional(),
    VOYAGE_MODEL: z.string().default('voyage-code-2'),

    // Database (optional for initial testing — runs in memory-only mode)
    DATABASE_URL: z.string().optional(),

    // SSH (optional — tools that need it will fail gracefully)
    SSH_PRIVATE_KEY_PATH: z.string().optional(),
    SSH_PUBLIC_KEY_PATH: z.string().optional(),
    SSH_CA_KEY_PATH: z.string().optional(),    // W1: SSH Certificate Authority private key
    SSH_USER: z.string().default('cloud-agent'),
    SSH_HOST: z.string().optional(),
    SSH_PORT: z.coerce.number().int().positive().default(22),

    // Hub-level encryption key for SSH private keys at rest (32-byte hex = 64 chars)
    // FIX: Validate format at parse time. Still optional (app boots without it) but
    // a clear startup warning is logged so /setup doesn't silently crash at runtime.
    ENCRYPTION_KEY: z.preprocess(
        (val) => {
            if (val === '' || val === undefined) return undefined;
            return val;
        },
        z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be 64 hex characters (32 bytes)').optional()
    ),

    // Cloudstick gateway shared secret — 64-char hex.
    // Used as the HMAC-SHA256 signing key for server-to-server gateway requests.
    CLOUDSTICK_GATEWAY_KEY: z.preprocess((val) => val === '' ? undefined : val, z.string().regex(/^[0-9a-f]{64}$/).optional()),

    // EC public key (PEM) from Cloudstick for verifying JWT signatures during /setup.
    // When unset, signature verification is skipped with a warning.
    // Generate: openssl ec -in cloudstick-ca.key -pubout > cloudstick-ca.pub
    CLOUDSTICK_JWT_PUBLIC_KEY: z.preprocess((val) => val === '' ? undefined : val, z.string().optional()),
    CLOUDSTICK_GATEWAY_SIGNATURE_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

    // Redis — required for PM2 cluster mode / multi-instance SSE bus (Phase 3)
    // Omit or leave empty to use in-memory fallback (single-instance only)
    REDIS_URL: z.preprocess((val) => val === '' ? undefined : val, z.string().optional()),

    // CORS: allowed origin for the HTTP gateway (e.g. https://app.cloudstick.io)
    // Set to '*' during development. Omit or leave empty to deny all cross-origin requests.
    CORS_ORIGIN: z.preprocess((val) => val === '' ? undefined : val, z.string().optional()),

    // Ops alerting — Slack Incoming Webhook URL for the private #ops-alerts channel.
    // Completely separate from SLACK_BOT_TOKEN (user-facing). Optional — alerting
    // is silently skipped if unset so the app boots without it.
    SLACK_OPS_WEBHOOK_URL: z.preprocess(
        (val) => val === '' ? undefined : val,
        z.string().url().optional()
    ),
});

function loadEnv() {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
        const errorMsg = result.error.issues
            .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
            .join('\n');
        throw new Error(`[Config] ❌ Invalid environment variables:\n${errorMsg}`);
    }
    return result.data;
}

export const env = loadEnv();
export type Env = typeof env;

// FIX: Surface missing ENCRYPTION_KEY at boot instead of crashing on first /setup
if (!env.ENCRYPTION_KEY) {
    console.warn('[Config] ⚠️  ENCRYPTION_KEY is not set — /setup and credential storage will fail at runtime.');
    console.warn('[Config]    Generate one: openssl rand -hex 32');
}
