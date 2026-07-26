import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDailyRolloverController,
  type ClearRolloverTimer,
  type RolloverTimer,
  type SetRolloverTimer,
} from "../../client/src/useDailyRollover.js";
import { createSSESummaryCoordinator } from "../../client/src/sse-summary-coordinator.js";

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
  it("recomputes the Taipei key when a delayed timer crosses midnight", async () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const timers: Array<() => void> = [];
    const delays: number[] = [];
    let refreshCount = 0;
    let resolveRefresh: (() => void) | undefined;
    const refreshComplete = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const setTimer: SetRolloverTimer = (callback, delay) => {
      timers.push(callback);
      delays.push(delay);
      return timers.length as unknown as RolloverTimer;
    };

    const cleanup = createDailyRolloverController({
      refresh: () => {
        refreshCount++;
        return refreshComplete;
      },
      now: () => current,
      setTimer,
      clearTimer: () => undefined,
    });

    assert.equal(delays[0], 1000);
    current = new Date("2026-03-26T00:00:02+08:00");
    timers[0]?.();

    assert.equal(refreshCount, 1);
    resolveRefresh?.();
    await refreshComplete;
    cleanup();
  });

  it("keeps timer and natural signals to one in-flight refresh", async () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const timers: Array<() => void> = [];
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    let refreshCount = 0;
    let resolveRefresh: (() => void) | undefined;
    const refreshPending = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    const cleanup = createDailyRolloverController({
      refresh: () => {
        refreshCount++;
        return refreshPending;
      },
      now: () => current,
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length as unknown as RolloverTimer;
      },
      clearTimer: () => undefined,
    });

    current = new Date("2026-03-26T00:00:01+08:00");
    timers[0]?.();
    windowTarget.dispatch("focus");
    documentTarget.dispatch("visibilitychange");

    assert.equal(refreshCount, 1);
    resolveRefresh?.();
    await refreshPending;
    await Promise.resolve();

    windowTarget.dispatch("focus");
    documentTarget.dispatch("visibilitychange");
    assert.equal(refreshCount, 1);
    cleanup();
  });

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

  it("recomputes a delayed timer after more than one wall-clock second", () => {
    let current = new Date("2026-03-25T23:59:59.999+08:00");
    const timers: Array<() => void> = [];
    const delays: number[] = [];
    let refreshCount = 0;

    const cleanup = createDailyRolloverController({
      refresh: () => {
        refreshCount++;
      },
      now: () => current,
      setTimer: (callback, delay) => {
        timers.push(callback);
        delays.push(delay);
        return timers.length as unknown as RolloverTimer;
      },
      clearTimer: () => undefined,
    });

    assert.equal(delays[0], 1);
    current = new Date("2026-03-26T00:00:05.123+08:00");
    timers[0]?.();

    assert.equal(refreshCount, 1);
    cleanup();
  });

  it("dedupes every supported signal ordering after one successful refresh", async () => {
    const signalOrders: Array<Array<"timer" | "focus" | "visible">> = [
      ["timer", "focus", "visible"],
      ["focus", "visible", "timer"],
      ["visible", "timer", "focus"],
    ];

    for (const signalOrder of signalOrders) {
      let current = new Date("2026-03-25T23:59:59+08:00");
      const timers: Array<() => void> = [];
      const documentTarget = new FakeEventTarget();
      const windowTarget = new FakeEventTarget();
      let refreshCount = 0;
      let resolveRefresh: (() => void) | undefined;
      const refreshPending = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });

      const cleanup = createDailyRolloverController({
        refresh: () => {
          refreshCount++;
          return refreshPending;
        },
        now: () => current,
        documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
        windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
        setTimer: (callback) => {
          timers.push(callback);
          return timers.length as unknown as RolloverTimer;
        },
        clearTimer: () => undefined,
      });

      current = new Date("2026-03-26T00:00:01+08:00");
      for (const signal of signalOrder) {
        if (signal === "timer") {
          timers[timers.length - 1]?.();
        } else if (signal === "focus") {
          windowTarget.dispatch("focus");
        } else {
          documentTarget.dispatch("visibilitychange");
        }
      }

      assert.equal(refreshCount, 1);
      resolveRefresh?.();
      await refreshPending;
      await new Promise((resolve) => setTimeout(resolve, 0));

      windowTarget.dispatch("focus");
      documentTarget.dispatch("visibilitychange");
      timers[timers.length - 1]?.();
      assert.equal(refreshCount, 1);
      cleanup();
    }
  });

  it("suppresses hidden visibility, then handles visible visibility and omitted targets", () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const documentTarget = new FakeEventTarget();
    let refreshCount = 0;

    const cleanup = createDailyRolloverController({
      refresh: () => {
        refreshCount++;
      },
      now: () => current,
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      setTimer: (() => 1 as unknown as RolloverTimer),
      clearTimer: () => undefined,
    });

    current = new Date("2026-03-26T00:00:01+08:00");
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatch("visibilitychange");
    assert.equal(refreshCount, 0);

    documentTarget.visibilityState = "visible";
    documentTarget.dispatch("visibilitychange");
    assert.equal(refreshCount, 1);
    cleanup();

    let omittedTargetRefreshes = 0;
    let omittedTargetTimer: (() => void) | undefined;
    current = new Date("2026-03-25T23:59:59+08:00");
    const omittedTargetCleanup = createDailyRolloverController({
      refresh: () => {
        omittedTargetRefreshes++;
      },
      now: () => current,
      setTimer: (callback) => {
        omittedTargetTimer = callback;
        return 2 as unknown as RolloverTimer;
      },
      clearTimer: () => undefined,
    });

    current = new Date("2026-03-26T00:00:01+08:00");
    assert.doesNotThrow(() => omittedTargetTimer?.());
    assert.equal(omittedTargetRefreshes, 1);
    omittedTargetCleanup();
  });

  it("retries after a rejected refresh and dedupes after the later success", async () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const documentTarget = new FakeEventTarget();
    let attempts = 0;
    let resolveSecond: (() => void) | undefined;
    const secondRefresh = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    const cleanup = createDailyRolloverController({
      refresh: () => {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error("refresh rejected")) : secondRefresh;
      },
      now: () => current,
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      setTimer: (() => 1 as unknown as RolloverTimer),
      clearTimer: (() => undefined),
    });

    current = new Date("2026-03-26T00:00:01+08:00");
    documentTarget.dispatch("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(attempts, 1);

    documentTarget.dispatch("visibilitychange");
    assert.equal(attempts, 2);
    resolveSecond?.();
    await secondRefresh;
    await new Promise((resolve) => setTimeout(resolve, 0));

    documentTarget.dispatch("visibilitychange");
    assert.equal(attempts, 2);
    cleanup();
  });

  it("releases the in-flight guard after a synchronous throw for natural retry", () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const windowTarget = new FakeEventTarget();
    let attempts = 0;

    const cleanup = createDailyRolloverController({
      refresh: () => {
        attempts++;
        if (attempts === 1) throw new Error("refresh failed");
      },
      now: () => current,
      windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
      setTimer: (() => 1 as unknown as RolloverTimer),
      clearTimer: (() => undefined),
    });

    current = new Date("2026-03-26T00:00:01+08:00");
    assert.doesNotThrow(() => windowTarget.dispatch("focus"));
    assert.doesNotThrow(() => windowTarget.dispatch("focus"));
    assert.equal(attempts, 2);
    cleanup();
  });

  it("retries a production-shaped coordinator failure on one later natural signal", async () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const documentTarget = new FakeEventTarget();
    let getMealsCalls = 0;
    let resolveSecond: (() => void) | undefined;
    const secondLoad = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const coordinator = createSSESummaryCoordinator<{ id: string }>({
      getMeals: () => {
        getMealsCalls++;
        if (getMealsCalls === 1) {
          return Promise.reject(new Error("network unavailable"));
        }
        return secondLoad.then(() => ({ meals: [{ id: "latest" }] }));
      },
      setMeals: () => undefined,
      applyMealMutationRefresh: () => undefined,
      setDailySummary: () => undefined,
      recordMealMutation: () => undefined,
      todayKey: () => "2026-03-26",
    });
    const refreshForRollover = async () => {
      const committed = await coordinator.runInitialMealsLoad({ refreshReason: "day_rollover" });
      if (!committed) {
        throw new Error("ROLLOVER_REFRESH_FAILED");
      }
    };

    const cleanup = createDailyRolloverController({
      refresh: refreshForRollover,
      now: () => current,
      documentTarget: documentTarget as unknown as DailyRolloverDocumentTarget,
      setTimer: (() => 1 as unknown as RolloverTimer),
      clearTimer: (() => undefined),
    });

    current = new Date("2026-03-26T00:00:01+08:00");
    documentTarget.dispatch("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(getMealsCalls, 1);

    documentTarget.dispatch("visibilitychange");
    assert.equal(getMealsCalls, 2);
    resolveSecond?.();
    await secondLoad;
    await new Promise((resolve) => setTimeout(resolve, 0));

    documentTarget.dispatch("visibilitychange");
    assert.equal(getMealsCalls, 2);
    cleanup();
  });

  it("recomputes the success date when a refresh settles after the next Taipei midnight", async () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const windowTarget = new FakeEventTarget();
    let refreshCount = 0;
    let resolveRefresh: (() => void) | undefined;
    const refreshPending = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    const cleanup = createDailyRolloverController({
      refresh: () => {
        refreshCount++;
        return refreshPending;
      },
      now: () => current,
      windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
      setTimer: (() => 1 as unknown as RolloverTimer),
      clearTimer: (() => undefined),
    });

    current = new Date("2026-03-26T23:59:59+08:00");
    windowTarget.dispatch("focus");
    assert.equal(refreshCount, 1);

    current = new Date("2026-03-27T00:00:01+08:00");
    resolveRefresh?.();
    await refreshPending;
    await new Promise((resolve) => setTimeout(resolve, 0));

    windowTarget.dispatch("focus");
    assert.equal(refreshCount, 1);
    cleanup();
  });

  it("keeps the fixed-zone timer bounded after a cross-midnight settlement", async () => {
    let current = new Date("2026-03-25T23:59:59+08:00");
    const timers: Array<() => void> = [];
    const delays: number[] = [];
    const windowTarget = new FakeEventTarget();
    let refreshCount = 0;
    let resolveRefresh: (() => void) | undefined;
    const refreshPending = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    const cleanup = createDailyRolloverController({
      refresh: () => {
        refreshCount++;
        return refreshPending;
      },
      now: () => current,
      windowTarget: windowTarget as unknown as DailyRolloverWindowTarget,
      setTimer: (callback, delay) => {
        timers.push(callback);
        delays.push(delay);
        return timers.length as unknown as RolloverTimer;
      },
      clearTimer: () => undefined,
    });

    assert.equal(delays[0], 1000);
    current = new Date("2026-03-26T23:59:59+08:00");
    windowTarget.dispatch("focus");
    assert.equal(refreshCount, 1);
    assert.equal(delays[1], 1000);

    current = new Date("2026-03-27T00:00:01+08:00");
    resolveRefresh?.();
    await refreshPending;
    await new Promise((resolve) => setTimeout(resolve, 0));

    timers[1]?.();
    assert.equal(refreshCount, 1);
    assert.equal(delays[2], 86_399_000);
    windowTarget.dispatch("focus");
    assert.equal(refreshCount, 1);
    cleanup();
  });
});

type DailyRolloverDocumentTarget = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
type DailyRolloverWindowTarget = Pick<Window, "addEventListener" | "removeEventListener">;
