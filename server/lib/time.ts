// server/lib/time.ts
import { config } from "../config.js";

export function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

// All day-boundary math follows the process timezone configured via TZ.
export function currentAppDate(): Date {
  return new Date();
}

export function getLocalDayBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return {
    dateKey: formatLocalDate(date),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

/**
 * Call once at startup to verify TZ is set. Day-boundary logic depends on
 * the process timezone matching the configured TZ env var (default: Asia/Taipei).
 * Logs a warning if TZ is unset so operators notice misconfiguration early.
 */
export function validateTimezone(log?: any) {
  if (!config.tzWasProvided && log?.warn) {
    const message =
      "[nutrition-coach] WARNING: TZ env var is not set. " +
      "Day-boundary calculations default to the system timezone. " +
      "Set TZ=Asia/Taipei in .env for correct behaviour.";
    log.warn(message);
  }
}
