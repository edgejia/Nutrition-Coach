import assert from "node:assert/strict";
import { describe, it } from "node:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

const mainLayout = await import("../../client/src/components/MainLayout.js");

type Listener = () => void;

class FakeEventTarget {
  listeners = new Map<string, Set<Listener>>();

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

class FakeStyle {
  values = new Map<string, string>();

  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }

  removeProperty(name: string) {
    this.values.delete(name);
  }

  getPropertyValue(name: string) {
    return this.values.get(name) ?? "";
  }
}

function createFakeViewport() {
  const viewport = new FakeEventTarget() as FakeEventTarget & {
    height: number;
    offsetTop: number;
  };
  viewport.height = 520;
  viewport.offsetTop = 0;
  return viewport;
}

function createFakeShell() {
  let nextFrameId = 1;
  const scheduledFrames = new Map<number, FrameRequestCallback>();
  const visualViewport = createFakeViewport();
  const windowTarget = new FakeEventTarget() as FakeEventTarget & {
    innerHeight: number;
    visualViewport: typeof visualViewport;
    requestAnimationFrame: typeof window.requestAnimationFrame;
    cancelAnimationFrame: typeof window.cancelAnimationFrame;
    scrollToCalls: Array<[number, number]>;
    scrollTo: (x: number, y: number) => void;
  };
  const root = {
    clientHeight: 780,
    style: new FakeStyle(),
  };

  windowTarget.innerHeight = 780;
  windowTarget.visualViewport = visualViewport;
  windowTarget.scrollToCalls = [];
  windowTarget.scrollTo = (x: number, y: number) => {
    windowTarget.scrollToCalls.push([x, y]);
  };
  windowTarget.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    scheduledFrames.set(frameId, callback);
    return frameId;
  };
  windowTarget.cancelAnimationFrame = (frameId: number) => {
    scheduledFrames.delete(frameId);
  };

  return {
    root,
    scheduledFrames,
    visualViewport,
    windowTarget,
    documentTarget: { documentElement: root },
    flushFrame() {
      const [[frameId, callback]] = scheduledFrames;
      assert.ok(frameId, "expected a scheduled animation frame");
      scheduledFrames.delete(frameId);
      callback(performance.now());
    },
  };
}

describe("visual viewport shell variables", () => {
  it("syncs visual viewport height and bottom occlusion on resize", () => {
    assert.equal(
      typeof mainLayout.installVisualViewportShellVars,
      "function",
      "MainLayout should export a testable viewport shell helper",
    );

    const shell = createFakeShell();
    const cleanup = mainLayout.installVisualViewportShellVars({
      window: shell.windowTarget,
      document: shell.documentTarget,
    });

    assert.equal(shell.root.style.getPropertyValue("--app-visual-viewport-height"), "520px");
    assert.equal(shell.root.style.getPropertyValue("--app-bottom-occlusion"), "0px");
    assert.deepEqual(shell.windowTarget.scrollToCalls.at(-1), [0, 0]);

    shell.visualViewport.height = 460;
    shell.visualViewport.offsetTop = 20;
    shell.visualViewport.dispatch("resize");

    assert.equal(shell.scheduledFrames.size, 1, "visualViewport resize should throttle through one frame");
    shell.flushFrame();

    assert.equal(shell.root.style.getPropertyValue("--app-visual-viewport-height"), "460px");
    assert.equal(shell.root.style.getPropertyValue("--app-bottom-occlusion"), "0px");
    assert.deepEqual(shell.windowTarget.scrollToCalls.at(-1), [0, 0]);

    cleanup();
  });

  it("registers and removes one viewport listener system", () => {
    const shell = createFakeShell();
    const cleanup = mainLayout.installVisualViewportShellVars({
      window: shell.windowTarget,
      document: shell.documentTarget,
    });

    for (const eventName of ["resize", "orientationchange", "focusin", "focusout"]) {
      assert.equal(shell.windowTarget.listenerCount(eventName), 1, `${eventName} should be registered once`);
    }
    for (const eventName of ["resize", "scroll"]) {
      assert.equal(shell.visualViewport.listenerCount(eventName), 1, `visualViewport ${eventName} should be registered once`);
    }

    shell.visualViewport.dispatch("scroll");
    assert.equal(shell.scheduledFrames.size, 1, "visualViewport scroll should schedule a sync frame");

    cleanup();

    for (const eventName of ["resize", "orientationchange", "focusin", "focusout"]) {
      assert.equal(shell.windowTarget.listenerCount(eventName), 0, `${eventName} should be removed on cleanup`);
    }
    for (const eventName of ["resize", "scroll"]) {
      assert.equal(shell.visualViewport.listenerCount(eventName), 0, `visualViewport ${eventName} should be removed on cleanup`);
    }

    assert.equal(shell.scheduledFrames.size, 0, "cleanup should cancel pending viewport sync frames");
    assert.equal(shell.root.style.getPropertyValue("--app-visual-viewport-height"), "");
    assert.equal(shell.root.style.getPropertyValue("--app-bottom-occlusion"), "");
  });
});
