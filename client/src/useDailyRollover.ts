import { useEffect } from "react";
import {
  formatLocalDate,
  getMillisecondsUntilNextTaipeiMidnight,
} from "./lib/time.js";

export type RolloverTimer = ReturnType<typeof setTimeout>;
export type SetRolloverTimer = (callback: () => void, delayMs: number) => RolloverTimer;
export type ClearRolloverTimer = (timer: RolloverTimer) => void;

export interface DailyRolloverControllerOptions {
  refresh: () => void | Promise<void>;
  now?: () => Date;
  setTimer?: SetRolloverTimer;
  clearTimer?: ClearRolloverTimer;
  documentTarget?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  windowTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function createDailyRolloverController(options: DailyRolloverControllerOptions): () => void {
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const documentTarget = options.documentTarget;
  const windowTarget = options.windowTarget;

  let lastSuccessfulDateKey = formatLocalDate(now());
  let activeTimer: RolloverTimer | undefined;
  let disposed = false;
  let refreshInFlight = false;

  function clearActiveTimer() {
    if (activeTimer !== undefined) {
      clearTimer(activeTimer);
      activeTimer = undefined;
    }
  }

  function scheduleNextMidnight() {
    if (disposed) return;

    clearActiveTimer();
    const current = now();
    const delayMs = getMillisecondsUntilNextTaipeiMidnight(current);

    activeTimer = setTimer(() => {
      if (disposed) return;
      refreshIfDateChanged();
      scheduleNextMidnight();
    }, delayMs);
  }

  function refreshIfDateChanged(): boolean {
    if (disposed || refreshInFlight) return false;

    const nextDate = formatLocalDate(now());
    if (nextDate === lastSuccessfulDateKey) return false;

    refreshInFlight = true;
    try {
      const refreshResult = options.refresh();
      void Promise.resolve(refreshResult).then(
        () => {
          if (!disposed) {
            lastSuccessfulDateKey = nextDate;
          }
          refreshInFlight = false;
        },
        () => {
          refreshInFlight = false;
        },
      );
    } catch {
      refreshInFlight = false;
    }

    return true;
  }

  function handleFocus() {
    if (refreshIfDateChanged()) {
      scheduleNextMidnight();
    }
  }

  function handleVisibilityChange() {
    if (documentTarget?.visibilityState === "hidden") return;
    if (refreshIfDateChanged()) {
      scheduleNextMidnight();
    }
  }

  documentTarget?.addEventListener("visibilitychange", handleVisibilityChange);
  windowTarget?.addEventListener("focus", handleFocus);
  scheduleNextMidnight();

  return () => {
    disposed = true;
    clearActiveTimer();
    documentTarget?.removeEventListener("visibilitychange", handleVisibilityChange);
    windowTarget?.removeEventListener("focus", handleFocus);
  };
}

export function useDailyRollover(refresh: () => void | Promise<void>) {
  useEffect(() => {
    return createDailyRolloverController({
      refresh,
      documentTarget: document,
      windowTarget: window,
    });
  }, [refresh]);
}
