import "dotenv/config";
import { z } from "zod";

/**
 * Zod schema for all environment variables.
 * Every limit, delay, and secret is read from env — nothing hardcoded.
 * Defaults are sane development values; override in .env or CI.
 */
const envSchema = z.object({
  // ── Server ─────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  API_PORT: z.coerce.number().default(3000),

  // ── Database ───────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── Redis ──────────────────────────────────────────────────────────────
  REDIS_URL: z.string().url(),

  // ── Elasticsearch ──────────────────────────────────────────────────────
  ELASTICSEARCH_URL: z.string().url(),

  // ── BullMQ Worker ──────────────────────────────────────────────────────
  WORKER_CONCURRENCY: z.coerce.number().min(1).default(5),
  BULLMQ_STALLED_INTERVAL: z.coerce.number().default(30_000),
  BULLMQ_MAX_STALLED_COUNT: z.coerce.number().default(3),

  // ── Rate Limiting & Pacing ─────────────────────────────────────────────
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().min(1).default(100),
  MIN_DELAY_BETWEEN_SENDS_MS: z.coerce.number().min(0).default(2000),
  MAX_RECIPIENTS_PER_CAMPAIGN: z.coerce.number().min(1).default(10_000),
  // If the pacing slot is more than this far in the future, use
  // moveToDelayed instead of sleeping (keeps the worker free).
  MAX_PACING_WAIT_MS: z.coerce.number().default(10_000),

  // ── Reconciler ─────────────────────────────────────────────────────────
  // Emails stuck in 'processing' longer than this are reset to 'scheduled'
  STALE_PROCESSING_THRESHOLD_MS: z.coerce.number().default(300_000),

  // ── Auth ───────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),

  // ── Slack OAuth (optional — Slack features disabled if missing) ─────────
  SLACK_CLIENT_ID: z.string().optional().default(""),
  SLACK_CLIENT_SECRET: z.string().optional().default(""),
  SLACK_REDIRECT_URI: z.string().optional().default(""),

  // ── Encryption (hex-encoded 32 bytes for AES-256-GCM) ──────────────────
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),

  // ── Bull Board ─────────────────────────────────────────────────────────
  BULL_BOARD_USER: z.string().default("admin"),
  BULL_BOARD_PASSWORD: z.string().default("admin"),

  // ── CORS ───────────────────────────────────────────────────────────────
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

/** Parsed and validated environment. Throws on startup if invalid. */
export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
