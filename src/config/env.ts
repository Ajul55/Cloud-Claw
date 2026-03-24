import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
    // LLM
    LLM_API_KEY: z.preprocess((val) => val === '' ? undefined : val, z.string().min(1).optional()),

    LLM_BASE_URL: z.string().url().optional(),
    LLM_MODEL: z.string().default('gpt-4o'),
    LLM_PROVIDER: z.enum(['openai', 'anthropic', 'groq', 'minimax']).default('openai'),

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
    SSH_USER: z.string().default('cloud-agent'),
    SSH_HOST: z.string().optional(),
    SSH_PORT: z.coerce.number().int().positive().default(22),

    // Hub-level encryption key for SSH private keys at rest (32-byte hex = 64 chars)
    ENCRYPTION_KEY: z.string().optional(),
});

function loadEnv() {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
        console.error('[Config] ❌ Invalid environment variables:');
        result.error.issues.forEach((issue) => {
            console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
        });
        process.exit(1);
    }
    return result.data;
}

export const env = loadEnv();
export type Env = typeof env;
