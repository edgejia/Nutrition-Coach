import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDailyRolloverController } from "../../client/src/useDailyRollover.js";

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
    let timer: (() => void) | null = null;
    let delayMs: number | undefined;
    let refreshCount = 0;

    createDailyRolloverController({
      refresh: () => {
        refreshCount++;
      },
      now: () => current,
      setTimer: (callback, delay) => {
        timer = callback;
        delayMs = delay;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });

    assert.equal(delayMs, 1000);
    current = new Date("2026-03-26T00:00:00+08:00");
    timer?.();

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
      setTimer: (() => 1) as typeof setTimeout,
      clearTimer: (() => undefined) as typeof clearTimeout,
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
      setTimer: (() => 1) as typeof setTimeout,
      clearTimer: (() => undefined) as typeof clearTimeout,
    });

    current = new Date("2026-03-26T08:00:00+08:00");
    windowTarget.dispatch("focus");

    assert.equal(refreshCount, 1);
  });

  it("cleanup removes both listeners and clears the active timeout", () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    let cleared = false;

    const cleanup = createDailyRolloverController({
      refresh: () => undefined,
      now: () => new Date("2026-03-25T23:59:59+08:00"),
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
      setTimer: (() => 123) as typeof setTimeout,
      clearTimer: (() => {
        cleared = true;
      }) as typeof clearTimeout,
    });

    assert.equal(documentTarget.listenerCount("visibilitychange"), 1);
    assert.equal(windowTarget.listenerCount("focus"), 1);

    cleanup();

    assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
    assert.equal(windowTarget.listenerCount("focus"), 0);
    assert.equal(cleared, true);
  });
});

type DailyRolloverDocumentTarget = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
type DailyRolloverWindowTarget = Pick<Window, "addEventListener" | "removeEventListener">;
