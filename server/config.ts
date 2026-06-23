export const DEFAULT_GUEST_SESSION_SECRET = "dev-guest-session-secret-change-me";

export interface GuestSessionRuntimeConfig {
  guestSessionSecret: string | undefined;
  guestSessionCookieSecure: boolean;
  nodeEnv: string | undefined;
}

export interface RuntimeConfigInput {
  port: string | undefined;
  guestSessionTtlSeconds: string | undefined;
  guestSessionResumeTtlSeconds: string | undefined;
}

export interface RuntimeConfig {
  port: number;
  guestSessionTtlSeconds: number;
  guestSessionResumeTtlSeconds: number;
}

export const MAX_GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24 * 400;

const GUEST_SESSION_SECRET_ERROR =
  "GUEST_SESSION_SECRET must be set in deployed-like runtime (NODE_ENV=production or GUEST_SESSION_COOKIE_SECURE=true) to a non-empty, non-default value at least 32 characters long.";

const PORT_CONFIG_ERROR = "PORT must be an integer from 1 to 65535.";
const GUEST_SESSION_TTL_CONFIG_ERROR =
  `GUEST_SESSION_TTL_SECONDS must be a positive safe integer number of seconds no greater than ${MAX_GUEST_SESSION_TTL_SECONDS}.`;
const GUEST_SESSION_RESUME_TTL_CONFIG_ERROR =
  `GUEST_SESSION_RESUME_TTL_SECONDS must be a positive safe integer number of seconds no greater than ${MAX_GUEST_SESSION_TTL_SECONDS}.`;

const INTEGER_STRING_PATTERN = /^(0|[1-9]\d*)$/;

export function isDeployedLikeRuntime(input: Pick<GuestSessionRuntimeConfig, "guestSessionCookieSecure" | "nodeEnv">) {
  return input.nodeEnv === "production" || input.guestSessionCookieSecure === true;
}

export function validateGuestSessionSecretForRuntime(input: GuestSessionRuntimeConfig) {
  if (!isDeployedLikeRuntime(input)) {
    return;
  }

  const trimmedSecret = input.guestSessionSecret?.trim() ?? "";
  if (
    !trimmedSecret
    || trimmedSecret === DEFAULT_GUEST_SESSION_SECRET
    || trimmedSecret.length < 32
  ) {
    throw new Error(GUEST_SESSION_SECRET_ERROR);
  }
}

function parseIntegerEnvValue(rawValue: string | undefined, defaultValue: number, errorMessage: string) {
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (!INTEGER_STRING_PATTERN.test(rawValue)) {
    throw new Error(errorMessage);
  }

  const parsedValue = Number(rawValue);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(errorMessage);
  }

  return parsedValue;
}

function parseGuestSessionTtlEnvValue(
  rawValue: string | undefined,
  defaultValue: number,
  errorMessage: string,
) {
  const parsedValue = parseIntegerEnvValue(rawValue, defaultValue, errorMessage);
  if (parsedValue <= 0 || parsedValue > MAX_GUEST_SESSION_TTL_SECONDS) {
    throw new Error(errorMessage);
  }

  return parsedValue;
}

export function validateRuntimeConfig(input: RuntimeConfigInput): RuntimeConfig {
  const port = parseIntegerEnvValue(input.port, 3000, PORT_CONFIG_ERROR);
  if (port < 1 || port > 65535) {
    throw new Error(PORT_CONFIG_ERROR);
  }

  const guestSessionTtlSeconds = parseGuestSessionTtlEnvValue(
    input.guestSessionTtlSeconds,
    60 * 60 * 12,
    GUEST_SESSION_TTL_CONFIG_ERROR,
  );

  const guestSessionResumeTtlSeconds = parseGuestSessionTtlEnvValue(
    input.guestSessionResumeTtlSeconds,
    60 * 60 * 24 * 30,
    GUEST_SESSION_RESUME_TTL_CONFIG_ERROR,
  );

  return {
    port,
    guestSessionTtlSeconds,
    guestSessionResumeTtlSeconds,
  };
}

export function readRuntimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return validateRuntimeConfig({
    port: env.PORT,
    guestSessionTtlSeconds: env.GUEST_SESSION_TTL_SECONDS,
    guestSessionResumeTtlSeconds: env.GUEST_SESSION_RESUME_TTL_SECONDS,
  });
}

/**
 * Centralised server configuration (CFG-01).
 *
 * All process.env reads and their defaults live here.
 * Consumers import { config } from "./config.js" (or "../config.js").
 *
 * Phase 8 (Structured Observability) will consume config.debug.
 */
export const config = {
  /** Node environment used for deployed-like runtime detection. */
  nodeEnv: process.env.NODE_ENV,

  /** LLM model used by the orchestrator. */
  orchestratorModel: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",

  /** HMAC secret used to sign guest-session cookies. */
  guestSessionSecret: process.env.GUEST_SESSION_SECRET ?? DEFAULT_GUEST_SESSION_SECRET,

  /** Active guest-session cookie name. */
  guestSessionCookieName: process.env.GUEST_SESSION_COOKIE_NAME ?? "guest_session",

  /** Long-lived resume cookie name used for same-browser recovery. */
  guestSessionResumeCookieName: process.env.GUEST_SESSION_RESUME_COOKIE_NAME ?? "guest_session_resume",

  // Compatibility-only for legacy imports; validateRuntimeConfig() is the authoritative runtime numeric source.
  /** TTL for the active guest-session cookie in seconds. */
  guestSessionTtlSeconds: Number(process.env.GUEST_SESSION_TTL_SECONDS ?? 60 * 60 * 12),

  /** TTL for the resume cookie in seconds. */
  guestSessionResumeTtlSeconds: Number(process.env.GUEST_SESSION_RESUME_TTL_SECONDS ?? 60 * 60 * 24 * 30),

  /** Secure-cookie toggle for deployed HTTPS environments such as Railway. */
  guestSessionCookieSecure:
    process.env.GUEST_SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",

  /** SQLite database file path. Used as fallback when buildApp opts.dbPath is not provided. */
  dbPath: process.env.DB_PATH ?? "./data/nutrition.db",

  /** Durable asset root for product-owned image files. */
  assetsDir: process.env.ASSETS_DIR ?? "./data/assets",

  /** Staging directory for request-local uploads before they are persisted as assets. */
  uploadsStagingDir: process.env.UPLOADS_STAGING_DIR ?? "./data/uploads-staging",

  /** Built client directory served by Fastify in the beta runtime. */
  clientDistDir: process.env.CLIENT_DIST_DIR ?? "./dist/client",

  // Compatibility-only for legacy imports; validateRuntimeConfig() is the authoritative runtime numeric source.
  /** HTTP server port. */
  port: Number(process.env.PORT ?? 3000),

  /**
   * Process timezone expected by day-boundary logic.
   * The actual TZ enforcement is handled by server/lib/time.ts validateTimezone().
   * Phase 22 requires an explicit runtime TZ instead of an implicit fallback.
   */
  tz: process.env.TZ,

  /**
   * Required process timezone for day-boundary correctness.
   */
  requiredTimezone: "Asia/Taipei",

  /**
   * Enable debug-level logging.
   * Phase 8 will wire this to the structured logger.
   * Set DEBUG=true in environment to activate.
   */
  debug: process.env.DEBUG === "true",
} as const;
