import { useEffect } from "react";
import { formatLocalDate } from "./lib/time.js";

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

  let activeDate = formatLocalDate(now());
  let activeTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function runRefresh() {
    try {
      const result = options.refresh();
      if (result && typeof result === "object" && "catch" in result) {
        void result.catch(() => undefined);
      }
    } catch {
      // Rollover refresh should not throw into timer, focus, or visibility callbacks.
    }
  }

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
    const nextMidnight = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
    );
    const delayMs = Math.max(0, nextMidnight.getTime() - current.getTime());

    activeTimer = setTimer(() => {
      const nextDate = formatLocalDate(now());
      if (nextDate !== activeDate) {
        activeDate = nextDate;
        runRefresh();
      }
      scheduleNextMidnight();
    }, delayMs);
  }

  function refreshIfDateChanged() {
    const nextDate = formatLocalDate(now());
    if (nextDate === activeDate) return;

    activeDate = nextDate;
    runRefresh();
    scheduleNextMidnight();
  }

  function handleVisibilityChange() {
    if (documentTarget?.visibilityState === "hidden") return;
    refreshIfDateChanged();
  }

  documentTarget?.addEventListener("visibilitychange", handleVisibilityChange);
  windowTarget?.addEventListener("focus", refreshIfDateChanged);
  scheduleNextMidnight();

  return () => {
    disposed = true;
    clearActiveTimer();
    documentTarget?.removeEventListener("visibilitychange", handleVisibilityChange);
    windowTarget?.removeEventListener("focus", refreshIfDateChanged);
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
