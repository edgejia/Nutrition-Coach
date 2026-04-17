import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDailyRolloverController,
  type ClearRolloverTimer,
  type RolloverTimer,
  type SetRolloverTimer,
} from "../../client/src/useDailyRollover.js";

type Listener = () => void;

class FakeEventTarget {
  listeners = new Map<string, Set<Listener>>();
  visibilityState: Document["visibilityState"] = "visible";

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe("createDailyRolloverController", () => {
  it("refreshes once when the midnight timer fires", () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const timers: Array<() => void> = [];
    let delayMs: number | undefined;
    let refreshCount = 0;
    const setTimer: SetRolloverTimer = (callback, delay) => {
      timers.push(callback);
      delayMs = delay;
      return timers.length as unknown as RolloverTimer;
    };

    createDailyRolloverController({
      refresh: () => {
        refreshCount++;
      },
      now: () => current,
      setTimer,
      clearTimer: () => undefined,
    });

    assert.equal(delayMs, 1000);
    current = new Date("2026-03-26T00:00:00+08:00");
    timers[0]?.();

    assert.equal(refreshCount, 1);
  });

  it("refreshes on visibilitychange after a hidden tab crosses the local date boundary", () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    let refreshCount = 0;
    const documentTarget = new FakeEventTarget();

    createDailyRolloverController({
      refresh: () => {
        refreshCount++;
      },
      now: () => current,
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      setTimer: (() => 1 as unknown as RolloverTimer),
      clearTimer: (() => undefined),
    });

    current = new Date("2026-03-26T08:00:00+08:00");
    documentTarget.dispatch("visibilitychange");

    assert.equal(refreshCount, 1);
  });

  it("refreshes on focus after the local date changes", () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    let refreshCount = 0;
    const windowTarget = new FakeEventTarget();

    createDailyRolloverController({
      refresh: () => {
        refreshCount++;
      },
      now: () => current,
      windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
      setTimer: (() => 1 as unknown as RolloverTimer),
      clearTimer: (() => undefined),
    });

    current = new Date("2026-03-26T08:00:00+08:00");
    windowTarget.dispatch("focus");

    assert.equal(refreshCount, 1);
  });

  it("cleanup removes both listeners and clears the active timeout", () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    let cleared = false;
    const clearTimer: ClearRolloverTimer = () => {
      cleared = true;
    };

    const cleanup = createDailyRolloverController({
      refresh: () => undefined,
      now: () => new Date("2026-03-25T23:59:59+08:00"),
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
      setTimer: (() => 123 as unknown as RolloverTimer),
      clearTimer,
    });

    assert.equal(documentTarget.listenerCount("visibilitychange"), 1);
    assert.equal(windowTarget.listenerCount("focus"), 1);

    cleanup();

    assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
    assert.equal(windowTarget.listenerCount("focus"), 0);
    assert.equal(cleared, true);
  });

  it("does not throw or stop rescheduling when refresh fails", async () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const timers: Array<() => void> = [];
    const setTimer: SetRolloverTimer = (callback) => {
      timers.push(callback);
      return timers.length as unknown as RolloverTimer;
    };

    createDailyRolloverController({
      refresh: () => {
        throw new Error("refresh failed");
      },
      now: () => current,
      setTimer,
      clearTimer: () => undefined,
    });

    current = new Date("2026-03-26T00:00:00+08:00");
    assert.doesNotThrow(() => timers[0]?.());
    assert.equal(timers.length, 2);

    const documentTarget = new FakeEventTarget();
    const cleanup = createDailyRolloverController({
      refresh: () => Promise.reject(new Error("refresh rejected")),
      now: () => current,
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      setTimer,
      clearTimer: () => undefined,
    });

    current = new Date("2026-03-27T00:00:00+08:00");
    assert.doesNotThrow(() => documentTarget.dispatch("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    cleanup();
  });
});

type DailyRolloverDocumentTarget = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
type DailyRolloverWindowTarget = Pick<Window, "addEventListener" | "removeEventListener">;
