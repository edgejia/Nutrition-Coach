/**
 * Centralised server configuration (CFG-01).
 *
 * All process.env reads and their defaults live here.
 * Consumers import { config } from "./config.js" (or "../config.js").
 *
 * Phase 8 (Structured Observability) will consume config.debug.
 */
export const config = {
  /** LLM model used by the orchestrator. */
  orchestratorModel: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5-nano",

  /** SQLite database file path. Used as fallback when buildApp opts.dbPath is not provided. */
  dbPath: process.env.DB_PATH ?? "./data/nutrition.db",

  /** Durable asset root for product-owned image files. */
  assetsDir: process.env.ASSETS_DIR ?? "./data/assets",

  /** Staging directory for request-local uploads before they are persisted as assets. */
  uploadsStagingDir: process.env.UPLOADS_STAGING_DIR ?? "./data/uploads-staging",

  /** Built client directory served by Fastify in the beta runtime. */
  clientDistDir: process.env.CLIENT_DIST_DIR ?? "./dist/client",

  /** HTTP server port. */
  port: Number(process.env.PORT ?? 3000),

  /**
   * Process timezone expected by day-boundary logic.
   * The actual TZ enforcement is handled by server/lib/time.ts validateTimezone().
   * Phase 9 consumers use this value directly.
   */
  tz: process.env.TZ ?? "Asia/Taipei",

  /**
   * Whether TZ was explicitly provided in the environment.
   * Consumed by server/lib/time.ts to decide whether to emit the startup warning.
   */
  tzWasProvided: process.env.TZ !== undefined,

  /**
   * Enable debug-level logging.
   * Phase 8 will wire this to the structured logger.
   * Set DEBUG=true in environment to activate.
   */
  debug: process.env.DEBUG === "true",
} as const;
