import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  createBrowserBackSentinelController,
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

  it("delegates to browser history when goBack returns false so root browser exit proceeds on the first press", () => {
    setupController();
    goBackResult = false;

    windowTarget.emitPopState({ nutritionCoachBrowserBackSentinel: true });

    assert.equal(goBackCalls, 1);
    assert.equal(historyTarget.pushCalls.length, 1);
    assert.equal(historyTarget.backCalls, 1);
    assert.equal(historyTarget.state, null);
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
