import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runHomeAnimationEffect } from "../../client/src/lib/home-animation-lifecycle.js";
import type { HomeTimelineEndpoints } from "../../client/src/lib/home-animation-timeline.js";

const start: HomeTimelineEndpoints = {
  kcal: 0,
  percent: 0,
  ringValue: 0,
  macros: [{ grams: 0, percent: 0, barValue: 0 }],
};
const end: HomeTimelineEndpoints = {
  kcal: 1030,
  percent: 49,
  ringValue: 0.49,
  macros: [{ grams: 74, percent: 62, barValue: 0.62 }],
};

function fakeAnimationFrameScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, (timestamp: number) => void>();
  return {
    request(callback: (timestamp: number) => void) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id: number) {
      callbacks.delete(id);
    },
    tick(timestamp: number) {
      const [id, callback] = callbacks.entries().next().value ?? [];
      if (id === undefined || typeof callback !== "function") return;
      callbacks.delete(id);
      callback(timestamp);
    },
    get pendingCount() {
      return callbacks.size;
    },
  };
}

function setupRun(
  scheduler: ReturnType<typeof fakeAnimationFrameScheduler>,
  token: number,
  options: { reducedMotion?: boolean } = {},
) {
  const frames: HomeTimelineEndpoints[] = [];
  const running: boolean[] = [];
  const consumed: number[] = [];
  const cleanup = runHomeAnimationEffect({
    start,
    end,
    intentToken: token,
    reducedMotion: options.reducedMotion ?? false,
    scheduler,
    onFrame: (frame) => frames.push(frame),
    onRunningChange: (value) => running.push(value),
    onConsumeIntent: (intentToken) => consumed.push(intentToken),
  });
  return { cleanup, frames, running, consumed };
}

describe("Home animation lifecycle", () => {
  it("keeps a valid completion path across StrictMode setup-cleanup-setup", () => {
    const scheduler = fakeAnimationFrameScheduler();
    const firstSetup = setupRun(scheduler, 1);

    assert.equal(firstSetup.running.at(-1), true);
    assert.equal(scheduler.pendingCount, 1);
    firstSetup.cleanup();

    assert.equal(firstSetup.running.at(-1), false);
    assert.equal(scheduler.pendingCount, 0);

    const secondSetup = setupRun(scheduler, 1);
    assert.equal(secondSetup.running.at(-1), true);
    assert.equal(scheduler.pendingCount, 1);

    scheduler.tick(0);
    scheduler.tick(250);
    scheduler.tick(500);

    assert.equal(secondSetup.running.at(-1), false);
    assert.equal(scheduler.pendingCount, 0);
    assert.deepEqual(secondSetup.frames.at(-1), end);
    assert.deepEqual(secondSetup.consumed, [1]);
    secondSetup.cleanup();
  });

  it("cancels on unmount, completes reduced motion, and replaces an older run", () => {
    const scheduler = fakeAnimationFrameScheduler();
    const firstRun = setupRun(scheduler, 1);
    firstRun.cleanup();
    const replacement = setupRun(scheduler, 2);
    scheduler.tick(0);
    replacement.cleanup();

    assert.equal(scheduler.pendingCount, 0);
    assert.equal(replacement.running.at(-1), false);
    assert.deepEqual(firstRun.consumed, []);

    const reducedMotion = setupRun(scheduler, 3, { reducedMotion: true });
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(reducedMotion.running.at(-1), false);
    assert.deepEqual(reducedMotion.frames.at(-1), end);
    assert.deepEqual(reducedMotion.consumed, [3]);
    reducedMotion.cleanup();
  });
});
