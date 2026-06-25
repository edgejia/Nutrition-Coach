import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  createBrowserBackSentinelController,
  type BrowserBackDiagnosticEvent,
  type BrowserBackHistoryTarget,
  type BrowserBackWindowTarget,
} from "../../client/src/useBrowserBackSentinel.js";

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

  it("pushes exactly one sentinel entry and registers one popstate listener on setup", () => {
    setupController();

    assert.equal(historyTarget.pushCalls.length, 1);
    assert.equal(windowTarget.listenerCount("popstate"), 1);
    assert.deepEqual(historyTarget.state, {
      nutritionCoachBrowserBackSentinel: true,
    });
  });

  it("calls goBack on popstate, ignores event.state, and re-arms after handled in-app back", () => {
    setupController();

    windowTarget.emitPopState({ routeName: "untrusted-history-state" });

    assert.equal(goBackCalls, 1);
    assert.equal(historyTarget.pushCalls.length, 2);
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
    assert.equal(historyTarget.pushCalls.length, 6);
    assert.deepEqual(historyTarget.state, {
      nutritionCoachBrowserBackSentinel: true,
    });
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
    assert.equal(historyTarget.pushCalls.length, 1);
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

    assert.equal(historyTarget.pushCalls.length, 1);
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
    assert.equal(historyTarget.pushCalls.length, 1);
  });
});
