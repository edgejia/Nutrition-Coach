// server/lib/time.ts
import { config } from "../config.js";

const INVALID_TZ_PREFIX = "[nutrition-coach] Invalid TZ configuration:";

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

export function validateTimezone(log?: { info?: (payload: { tz: string }, message: string) => void }) {
  if (config.tz === undefined) {
    throw new Error(`${INVALID_TZ_PREFIX} TZ must be explicitly set to Asia/Taipei.`);
  }

  if (config.tz !== config.requiredTimezone) {
    throw new Error(`${INVALID_TZ_PREFIX} expected Asia/Taipei but received ${config.tz}.`);
  }

  log?.info?.({ tz: config.tz }, "Timezone contract verified");
}
