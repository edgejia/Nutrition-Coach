// WOULD-HAVE-CAUGHT (Round 6, Gap A):
// The original FakeHistory below is a toy model: back() merely nulls history.state
// and the suite ran scheduleRearm() synchronously between presses. That made the
// "consecutive popstates" case pass even when the sentinel was re-armed only by the
// deferred confirmRearm() (setTimeout 0), so the real Android press-to-press window
// with NO poppable sentinel was invisible and the bug survived five rounds.
// PositionalFakeHistory below reproduces a real back stack (cursor + entries; back()
// moves the cursor, pushState truncates forward entries) so the SECOND consecutive
// hardware Back is exercised the way Android exercises it. The consecutive-Back test
// asserts each hardware Back lands on an app-owned sentinel rather than the bottom
// history entry and that another poppable sentinel remains available before the next
// press.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createBrowserBackSentinelController,
  type BrowserBackDiagnosticEvent,
  type BrowserBackHistoryTarget,
  type BrowserBackWindowTarget,
} from "../../client/src/useBrowserBackSentinel.js";

const browserBackSentinelSource = await readFile(
  fileURLToPath(new URL("../../client/src/useBrowserBackSentinel.ts", import.meta.url)),
  "utf8",
);

function isSentinelState(state: unknown) {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { nutritionCoachBrowserBackSentinel?: unknown }).nutritionCoachBrowserBackSentinel === true
  );
}

class FakeHistory implements BrowserBackHistoryTarget {
  public state: unknown = null;
  public backCalls = 0;
  public pushCalls: Array<{ state: unknown; title: string; url?: string | URL | null }> = [];

  pushState(state: unknown, title: string, url?: string | URL | null) {
    this.state = state;
    this.pushCalls.push({ state, title, url });
  }

  back() {
    this.backCalls += 1;
    this.state = null;
  }
}

class AndroidLikeFakeHistory extends FakeHistory {
  public ignorePushState = false;

  override pushState(state: unknown, title: string, url?: string | URL | null) {
    if (this.ignorePushState) {
      this.pushCalls.push({ state, title, url });
      return;
    }
    super.pushState(state, title, url);
  }
}

/**
 * Position-based back-stack model that reproduces a real browser history stack.
 *
 * `entries` is the ordered back stack and `cursor` is the index of the current
 * entry. `pushState` truncates any forward entries above the cursor, appends the
 * new state, and advances the cursor (the real "navigating after a back" rule).
 * `back()` decrements the cursor (never below 0) and lands on the entry it points
 * at, exposing it as `state` — exactly what a hardware Back does. `state` is a live
 * view of `entries[cursor]`.
 *
 * A poppable sentinel exists when the cursor currently sits ON a sentinel entry that
 * is NOT at the bottom of the stack (cursor > 0). That is the device invariant: the
 * NEXT hardware Back pops the sentinel and fires popstate while the app still holds
 * navigation authority, instead of popping past the bottom and exiting the app.
 * `sentinelBelowCursor()` / `canPopSentinel()` report that invariant.
 */
class PositionalFakeHistory implements BrowserBackHistoryTarget {
  public entries: unknown[] = [null];
  public cursor = 0;
  public backCalls = 0;
  public pushCalls: Array<{ state: unknown; title: string; url?: string | URL | null }> = [];

  get state(): unknown {
    return this.entries[this.cursor] ?? null;
  }

  pushState(state: unknown, title: string, url?: string | URL | null) {
    // Truncate forward entries (everything above the current cursor) like a real stack.
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(state);
    this.cursor = this.entries.length - 1;
    this.pushCalls.push({ state, title, url });
  }

  back() {
    this.backCalls += 1;
    if (this.cursor > 0) {
      this.cursor -= 1;
    }
  }

  /**
   * Does a poppable sentinel exist for the NEXT hardware Back? True when the cursor
   * sits on a sentinel entry that is above the bottom of the stack, so the next Back
   * pops the sentinel (firing popstate) rather than exiting the app.
   */
  sentinelBelowCursor(): boolean {
    return this.cursor > 0 && isSentinelState(this.entries[this.cursor]);
  }

  /** Alias kept for readability at call sites: a NEXT Back would still land on a sentinel. */
  canPopSentinel(): boolean {
    return this.sentinelBelowCursor();
  }
}

class FakeWindow implements BrowserBackWindowTarget {
  public listeners = new Map<string, Set<(event: PopStateEvent) => void>>();

  addEventListener(type: "popstate", listener: (event: PopStateEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "popstate", listener: (event: PopStateEvent) => void) {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
  }

  emitPopState(state: unknown) {
    const event = { state } as PopStateEvent;
    for (const listener of this.listeners.get("popstate") ?? []) {
      listener(event);
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe("createBrowserBackSentinelController", () => {
  let historyTarget: FakeHistory;
  let windowTarget: FakeWindow;
  let goBackCalls: number;
  let goBackResult: boolean;

  beforeEach(() => {
    historyTarget = new FakeHistory();
    windowTarget = new FakeWindow();
    goBackCalls = 0;
    goBackResult = true;
  });

  function setupController() {
    return createBrowserBackSentinelController({
      historyTarget,
      windowTarget,
      goBack: () => {
        goBackCalls++;
        return goBackResult;
      },
    });
  }

  function setupControllerWithDiagnostics(options: {
    history?: BrowserBackHistoryTarget;
    scheduleRearm?: (callback: () => void) => void;
  } = {}) {
    const events: BrowserBackDiagnosticEvent[] = [];
    const cleanup = createBrowserBackSentinelController({
      historyTarget: options.history ?? historyTarget,
      windowTarget,
      sourceId: "test-shell",
      onDiagnosticEvent: (event) => events.push(event),
      scheduleRearm: options.scheduleRearm,
      goBack: () => {
        goBackCalls++;
        return goBackResult;
      },
    });
    return { cleanup, events };
  }

  it("pushes a two-entry sentinel guard and registers one popstate listener on setup", () => {
    setupController();

    assert.equal(historyTarget.pushCalls.length, 2);
    assert.equal(windowTarget.listenerCount("popstate"), 1);
    assert.deepEqual(historyTarget.state, {
      nutritionCoachBrowserBackSentinel: true,
    });
  });

  it("upgrades a preexisting single sentinel state once on first setup", () => {
    const positional = new PositionalFakeHistory();
    positional.pushState({ nutritionCoachBrowserBackSentinel: true }, "");
    assert.equal(positional.pushCalls.length, 1);
    assert.equal(positional.canPopSentinel(), true);

    const cleanupFirst = createBrowserBackSentinelController({
      historyTarget: positional,
      windowTarget,
      goBack: () => true,
    });

    assert.equal(positional.pushCalls.length, 2);
    assert.equal(positional.canPopSentinel(), true);

    cleanupFirst();
    const cleanupSecond = createBrowserBackSentinelController({
      historyTarget: positional,
      windowTarget,
      goBack: () => true,
    });

    assert.equal(positional.pushCalls.length, 2);
    assert.equal(windowTarget.listenerCount("popstate"), 1);

    cleanupSecond();
  });

  it("calls goBack on popstate, ignores event.state, and re-arms after handled in-app back", () => {
    setupController();

    windowTarget.emitPopState({ routeName: "untrusted-history-state" });

    assert.equal(goBackCalls, 1);
    assert.equal(historyTarget.pushCalls.length, 3);
    assert.deepEqual(historyTarget.state, {
      nutritionCoachBrowserBackSentinel: true,
    });
  });

  it("emits diagnostics for a handled popstate and confirmed re-arm", () => {
    const scheduled: Array<() => void> = [];
    const { events } = setupControllerWithDiagnostics({
      scheduleRearm: (callback) => {
        scheduled.push(callback);
      },
    });

    windowTarget.emitPopState({ routeName: "untrusted-history-state" });
    scheduled.shift()?.();

    assert.deepEqual(events.map((event) => event.event), [
      "popstate",
      "go_back_handled",
      "rearm_attempted",
      "rearm_confirmed",
    ]);
    assert.deepEqual(events.map((event) => event.sourceId), [
      "test-shell",
      "test-shell",
      "test-shell",
      "test-shell",
    ]);
    assert.equal(events.at(-1)?.repaired, false);
  });

  it("handles consecutive popstates and re-arms after each handled Back", () => {
    const scheduled: Array<() => void> = [];
    setupControllerWithDiagnostics({
      scheduleRearm: (callback) => {
        scheduled.push(callback);
      },
    });

    for (let index = 0; index < 5; index += 1) {
      windowTarget.emitPopState({ routeName: `untrusted-${index}` });
      scheduled.shift()?.();
    }

    assert.equal(goBackCalls, 5);
    assert.equal(historyTarget.pushCalls.length, 7);
    assert.deepEqual(historyTarget.state, {
      nutritionCoachBrowserBackSentinel: true,
    });
  });

  it("keeps a poppable sentinel below the cursor between consecutive Android Back presses (positional model)", () => {
    const positional = new PositionalFakeHistory();
    const scheduled: Array<() => void> = [];
    createBrowserBackSentinelController({
      historyTarget: positional,
      windowTarget,
      sourceId: "positional-shell",
      // Capture but DO NOT run the scheduler between presses — this reproduces the
      // real Android press-to-press window where only the synchronous re-push can
      // keep a sentinel poppable.
      scheduleRearm: (callback) => {
        scheduled.push(callback);
      },
      goBack: () => {
        goBackCalls++;
        return goBackResult;
      },
    });

    // Setup armed two sentinels: [null, sentinel, sentinel], cursor on the top sentinel.
    assert.equal(positional.canPopSentinel(), true);

    for (let press = 0; press < 3; press += 1) {
      // Hardware Back moves the cursor down onto the lower sentinel, not the bottom entry...
      positional.back();
      assert.equal(
        isSentinelState(positional.state),
        true,
        `press ${press}: hardware Back must land on an app-owned sentinel`,
      );
      // ...then the browser fires popstate for that Back.
      windowTarget.emitPopState({ routeName: `android-back-${press}` });

      // SYNCHRONOUSLY, before any scheduled confirmRearm runs, a poppable sentinel
      // must already exist for the NEXT consecutive Back. This fails against
      // deferred-only re-arm because the stack would still sit at the bottom.
      assert.equal(
        positional.canPopSentinel(),
        true,
        `press ${press}: a poppable sentinel must exist before the next Back`,
      );
    }

    // Each handled press called goBack exactly once.
    assert.equal(goBackCalls, 3);
    // confirmRearm() is coalesced (it won't re-schedule while a confirmation is
    // already pending), so the deferred backstop was scheduled but never run; the
    // poppable-sentinel contract above held purely on the synchronous re-push.
    assert.ok(scheduled.length >= 1, "the deferred backstop was scheduled at least once");
  });

  it("re-pushes the sentinel inside the popstate turn before the scheduled confirmRearm runs", () => {
    const positional = new PositionalFakeHistory();
    const scheduled: Array<() => void> = [];
    createBrowserBackSentinelController({
      historyTarget: positional,
      windowTarget,
      sourceId: "positional-shell",
      scheduleRearm: (callback) => {
        scheduled.push(callback);
      },
      goBack: () => {
        goBackCalls++;
        return goBackResult;
      },
    });

    // Setup arms the two-entry sentinel guard.
    const pushesAfterSetup = positional.pushCalls.length;
    assert.equal(pushesAfterSetup, 2);

    positional.back();
    windowTarget.emitPopState({ routeName: "sync-push-turn" });

    // The push count grew WITHIN the popstate turn, before any scheduled callback ran.
    assert.equal(positional.pushCalls.length, pushesAfterSetup + 1);
    assert.equal(scheduled.length, 1, "the deferred backstop was scheduled but not yet run");

    // Running the deferred backstop afterwards must not double-push: the sentinel is
    // already present, so confirmRearm reports repaired:false and pushes nothing more.
    scheduled.shift()?.();
    assert.equal(positional.pushCalls.length, pushesAfterSetup + 1);
  });

  it("repairs Android-style ignored immediate re-arm during scheduled confirmation", () => {
    const androidHistory = new AndroidLikeFakeHistory();
    historyTarget = androidHistory;
    const scheduled: Array<() => void> = [];
    const { events } = setupControllerWithDiagnostics({
      history: androidHistory,
      scheduleRearm: (callback) => {
        scheduled.push(callback);
      },
    });

    androidHistory.state = null;
    androidHistory.ignorePushState = true;
    windowTarget.emitPopState({ nutritionCoachBrowserBackSentinel: true });
    androidHistory.ignorePushState = false;
    scheduled.shift()?.();

    assert.equal(goBackCalls, 1);
    assert.deepEqual(androidHistory.state, {
      nutritionCoachBrowserBackSentinel: true,
    });
    assert.equal(events.at(-1)?.event, "rearm_confirmed");
    assert.equal(events.at(-1)?.repaired, true);
  });

  it("delegates to browser history when goBack returns false so root browser exit proceeds on the first press", () => {
    const { events } = setupControllerWithDiagnostics();
    goBackResult = false;

    windowTarget.emitPopState({ nutritionCoachBrowserBackSentinel: true });

    assert.equal(goBackCalls, 1);
    assert.equal(historyTarget.pushCalls.length, 2);
    assert.equal(historyTarget.backCalls, 1);
    assert.equal(historyTarget.state, null);
    assert.deepEqual(events.map((event) => event.event), [
      "popstate",
      "go_back_unhandled",
      "browser_back_delegated",
    ]);
  });

  it("remounts idempotently without pushing a duplicate sentinel when already armed", () => {
    const cleanupFirst = setupController();
    cleanupFirst();

    const cleanupSecond = setupController();

    assert.equal(historyTarget.pushCalls.length, 2);
    assert.equal(windowTarget.listenerCount("popstate"), 1);

    cleanupSecond();
    assert.equal(windowTarget.listenerCount("popstate"), 0);
  });

  it("removes the popstate listener during cleanup", () => {
    const cleanup = setupController();

    cleanup();
    windowTarget.emitPopState({ routeName: "after-cleanup" });

    assert.equal(windowTarget.listenerCount("popstate"), 0);
    assert.equal(goBackCalls, 0);
    assert.equal(historyTarget.pushCalls.length, 2);
  });

  it("keeps the React hook listener stable while callbacks change across step renders", () => {
    assert.match(browserBackSentinelSource, /import \{ useEffect, useRef \} from "react";/);
    assert.match(browserBackSentinelSource, /const initializedBrowserBackSentinelHistories = new WeakSet<object>\(\);/);
    assert.match(browserBackSentinelSource, /const goBackRef = useRef\(goBack\);/);
    assert.match(browserBackSentinelSource, /const onDiagnosticEventRef = useRef\(options\.onDiagnosticEvent\);/);
    assert.match(browserBackSentinelSource, /goBackRef\.current = goBack;/);
    assert.match(browserBackSentinelSource, /onDiagnosticEventRef\.current = options\.onDiagnosticEvent;/);
    assert.match(browserBackSentinelSource, /goBack: \(\) => goBackRef\.current\(\),/);
    assert.match(browserBackSentinelSource, /onDiagnosticEvent: \(event\) => onDiagnosticEventRef\.current\?\.\(event\),/);
    assert.match(browserBackSentinelSource, /\}, \[sourceId\]\);/);
    assert.doesNotMatch(browserBackSentinelSource, /\[goBack, options\.onDiagnosticEvent, options\.sourceId\]/);
  });
});
