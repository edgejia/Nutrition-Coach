import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPullToRefreshController,
  resolvePullRefreshEventTarget,
  type PullRefreshDiagnosticEvent,
} from "../../client/src/components/PullToRefreshSurface.js";

type FakeListener = (event: FakeTouchEvent) => void;

class FakeEventTarget {
  readonly listeners = new Map<string, Set<FakeListener>>();

  addEventListener(type: string, listener: FakeListener, _options?: AddEventListenerOptions) {
    const listeners = this.listeners.get(type) ?? new Set<FakeListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: FakeTouchEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeRootEventTarget extends FakeEventTarget {
  constructor(private readonly scrollTarget: FakeEventTarget | null) {
    super();
  }

  querySelector(selector: string) {
    assert.match(selector, /screen-scroll/);
    return this.scrollTarget;
  }
}

class FakeElement {
  tagName: string;
  parentElement: FakeElement | null = null;
  scrollTop = 0;
  isContentEditable = false;
  private readonly classes = new Set<string>();

  constructor(tagName: string, classNames: string[] = []) {
    this.tagName = tagName.toUpperCase();
    for (const className of classNames) {
      this.classes.add(className);
    }
  }

  appendChild(child: FakeElement) {
    child.parentElement = this;
    return child;
  }

  matches(selector: string) {
    const trimmed = selector.trim();
    if (trimmed.startsWith(".")) {
      return this.classes.has(trimmed.slice(1));
    }
    if (trimmed === "[contenteditable]") {
      return this.isContentEditable;
    }
    return this.tagName.toLowerCase() === trimmed.toLowerCase();
  }

  closest(selector: string) {
    const selectors = selector.split(",").map((part) => part.trim());
    let current: FakeElement | null = this;
    while (current) {
      if (selectors.some((part) => current?.matches(part))) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
}

interface FakeTouchEvent {
  target: EventTarget | null;
  touches: Array<{ clientX: number; clientY: number }>;
  changedTouches: Array<{ clientX: number; clientY: number }>;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

function touchEvent(target: FakeElement, x: number, y: number, active = true): FakeTouchEvent {
  return {
    target: target as unknown as EventTarget,
    touches: active ? [{ clientX: x, clientY: y }] : [],
    changedTouches: [{ clientX: x, clientY: y }],
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function pullPastThreshold(target: FakeEventTarget, surface: FakeElement, distance = 88) {
  target.emit("touchstart", touchEvent(surface, 24, 0));
  target.emit("touchmove", touchEvent(surface, 26, distance));
  target.emit("touchend", touchEvent(surface, 26, distance, false));
}

const pullSurfaceSource = await readFile(
  fileURLToPath(new URL("../../client/src/components/PullToRefreshSurface.tsx", import.meta.url)),
  "utf8",
);

describe("createPullToRefreshController", () => {
  it("emits listener and accepted gesture diagnostics in order", () => {
    const eventTarget = new FakeEventTarget();
    const surface = new FakeElement("main", ["screen-scroll"]);
    const events: PullRefreshDiagnosticEvent[] = [];

    const cleanup = createPullToRefreshController({
      eventTarget,
      surfaceId: "home",
      eventTargetKind: "scroll",
      onDiagnosticEvent: (event) => events.push(event),
      onRefresh: () => undefined,
      getScrollTop: () => 0,
    });

    pullPastThreshold(eventTarget, surface);

    assert.deepEqual(events.map((event) => event.event), [
      "listener_attached",
      "touch_start_accepted",
      "threshold_ready",
      "refresh_start",
      "refresh_settle",
    ]);
    assert.equal(events[0]?.surfaceId, "home");
    assert.equal(events[0]?.eventTargetKind, "scroll");
    cleanup();
  });

  it("calls onRefresh once when a top-of-scroll downward pull passes the threshold", () => {
    const eventTarget = new FakeEventTarget();
    const surface = new FakeElement("main", ["screen-scroll"]);
    let refreshCalls = 0;

    const cleanup = createPullToRefreshController({
      eventTarget,
      onRefresh: () => {
        refreshCalls += 1;
      },
      getScrollTop: () => 0,
    });

    pullPastThreshold(eventTarget, surface);

    assert.equal(refreshCalls, 1);
    cleanup();
  });

  it("ignores below-threshold pulls, horizontal drags, and pulls that start away from scroll top", () => {
    const belowTarget = new FakeEventTarget();
    const horizontalTarget = new FakeEventTarget();
    const scrolledTarget = new FakeEventTarget();
    const surface = new FakeElement("main", ["screen-scroll"]);
    let belowCalls = 0;
    let horizontalCalls = 0;
    let scrolledCalls = 0;

    const cleanupBelow = createPullToRefreshController({
      eventTarget: belowTarget,
      onRefresh: () => {
        belowCalls += 1;
      },
      getScrollTop: () => 0,
    });
    belowTarget.emit("touchstart", touchEvent(surface, 0, 0));
    belowTarget.emit("touchmove", touchEvent(surface, 0, 40));
    belowTarget.emit("touchend", touchEvent(surface, 0, 40, false));

    const cleanupHorizontal = createPullToRefreshController({
      eventTarget: horizontalTarget,
      onRefresh: () => {
        horizontalCalls += 1;
      },
      getScrollTop: () => 0,
    });
    horizontalTarget.emit("touchstart", touchEvent(surface, 0, 0));
    horizontalTarget.emit("touchmove", touchEvent(surface, 96, 24));
    horizontalTarget.emit("touchend", touchEvent(surface, 96, 24, false));

    const cleanupScrolled = createPullToRefreshController({
      eventTarget: scrolledTarget,
      onRefresh: () => {
        scrolledCalls += 1;
      },
      getScrollTop: () => 8,
    });
    pullPastThreshold(scrolledTarget, surface);

    assert.equal(belowCalls, 0);
    assert.equal(horizontalCalls, 0);
    assert.equal(scrolledCalls, 0);
    cleanupBelow();
    cleanupHorizontal();
    cleanupScrolled();
  });

  it("emits exact ignored diagnostics for ineligible gestures", () => {
    const eventTarget = new FakeEventTarget();
    const surface = new FakeElement("main", ["screen-scroll"]);
    const interactive = surface.appendChild(new FakeElement("button"));
    const events: PullRefreshDiagnosticEvent[] = [];

    const cleanup = createPullToRefreshController({
      eventTarget,
      surfaceId: "history",
      onDiagnosticEvent: (event) => events.push(event),
      onRefresh: () => undefined,
      getScrollTop: (target) => (target === surface ? 12 : 0),
    });

    eventTarget.emit("touchstart", touchEvent(interactive, 0, 0));
    eventTarget.emit("touchstart", touchEvent(surface, 0, 0));
    eventTarget.emit("touchstart", touchEvent(Object.assign(new FakeElement("main", ["screen-scroll"]), { scrollTop: 0 }), 0, 0));
    eventTarget.emit("touchmove", touchEvent(surface, 96, 24));
    eventTarget.emit("touchend", touchEvent(surface, 96, 24, false));

    assert.ok(events.some((event) => event.event === "touch_start_ignored" && event.reason === "interactive_target"));
    assert.ok(events.some((event) => event.event === "touch_start_ignored" && event.reason === "not_at_top"));
    assert.ok(events.some((event) => event.event === "touch_start_ignored" && event.reason === "horizontal_drag"));
    cleanup();
  });

  it("does not capture gestures that start from interactive targets", () => {
    const interactiveTargets = [
      new FakeElement("input"),
      new FakeElement("textarea"),
      new FakeElement("select"),
      new FakeElement("button"),
      new FakeElement("a"),
      Object.assign(new FakeElement("div"), { isContentEditable: true }),
      new FakeElement("div", ["sp-num-wheel-track"]),
    ];

    for (const interactiveTarget of interactiveTargets) {
      const eventTarget = new FakeEventTarget();
      const surface = new FakeElement("main", ["screen-scroll"]);
      surface.appendChild(interactiveTarget);
      let refreshCalls = 0;
      const cleanup = createPullToRefreshController({
        eventTarget,
        onRefresh: () => {
          refreshCalls += 1;
        },
        getScrollTop: () => 0,
      });

      pullPastThreshold(eventTarget, interactiveTarget);

      assert.equal(refreshCalls, 0, `${interactiveTarget.tagName} should not start pull refresh`);
      cleanup();
    }
  });

  it("keeps one in-flight refresh per surface", async () => {
    const eventTarget = new FakeEventTarget();
    const surface = new FakeElement("main", ["screen-scroll"]);
    let refreshCalls = 0;
    let resolveRefresh: (() => void) | undefined;

    const cleanup = createPullToRefreshController({
      eventTarget,
      onRefresh: () => {
        refreshCalls += 1;
        return new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        });
      },
      getScrollTop: () => 0,
    });

    pullPastThreshold(eventTarget, surface);
    pullPastThreshold(eventTarget, surface);

    assert.equal(refreshCalls, 1);
    resolveRefresh?.();
    await Promise.resolve();

    pullPastThreshold(eventTarget, surface);
    assert.equal(refreshCalls, 2);
    cleanup();
  });

  it("emits settle and returns to idle after rejected refresh promises", async () => {
    const eventTarget = new FakeEventTarget();
    const surface = new FakeElement("main", ["screen-scroll"]);
    const states: string[] = [];
    const events: PullRefreshDiagnosticEvent[] = [];

    const cleanup = createPullToRefreshController({
      eventTarget,
      surfaceId: "onboarding",
      onDiagnosticEvent: (event) => events.push(event),
      onStateChange: (state) => states.push(state.phase),
      onRefresh: () => Promise.reject(new Error("network")),
      getScrollTop: () => 0,
    });

    pullPastThreshold(eventTarget, surface);
    await Promise.resolve();

    assert.ok(events.some((event) => event.event === "refresh_settle"));
    assert.equal([...events].reverse().find((event) => event.event === "refresh_settle")?.phase, "idle");
    assert.equal(states.at(-1), "idle");
    cleanup();
  });

  it("resolves the first eligible inner scroll target before falling back to the wrapper", () => {
    const scrollTarget = new FakeEventTarget();
    const rootWithScroll = new FakeRootEventTarget(scrollTarget);
    const rootWithoutScroll = new FakeRootEventTarget(null);

    assert.deepEqual(resolvePullRefreshEventTarget(rootWithScroll), {
      eventTarget: scrollTarget,
      eventTargetKind: "scroll",
    });
    assert.deepEqual(resolvePullRefreshEventTarget(rootWithoutScroll), {
      eventTarget: rootWithoutScroll,
      eventTargetKind: "wrapper",
    });
  });

  it("cleanup removes listeners and prevents later events from refreshing", () => {
    const eventTarget = new FakeEventTarget();
    const surface = new FakeElement("main", ["screen-scroll"]);
    let refreshCalls = 0;

    const cleanup = createPullToRefreshController({
      eventTarget,
      onRefresh: () => {
        refreshCalls += 1;
      },
      getScrollTop: () => 0,
    });

    assert.equal(eventTarget.listenerCount("touchstart"), 1);
    assert.equal(eventTarget.listenerCount("touchmove"), 1);
    assert.equal(eventTarget.listenerCount("touchend"), 1);

    cleanup();
    pullPastThreshold(eventTarget, surface);

    assert.equal(refreshCalls, 0);
    assert.equal(eventTarget.listenerCount("touchstart"), 0);
    assert.equal(eventTarget.listenerCount("touchmove"), 0);
    assert.equal(eventTarget.listenerCount("touchend"), 0);
  });
});

describe("PullToRefreshSurface source contract", () => {
  it("keeps the touch controller stable while external refreshing state toggles", () => {
    assert.match(pullSurfaceSource, /const refreshingRef = useRef\(refreshing\)/);
    assert.match(pullSurfaceSource, /refreshingRef\.current = refreshing/);
    assert.match(pullSurfaceSource, /current\.phase === "refreshing" \? \{ phase: "complete", pullDistance: 0, progress: 0 \} : current/);
    assert.match(pullSurfaceSource, /if \(refreshingRef\.current\) return undefined/);
    assert.match(pullSurfaceSource, /\}, \[maxPullPx, onDiagnosticEvent, onRefresh, surfaceId, thresholdPx\]\);/);
    assert.doesNotMatch(pullSurfaceSource, /\}, \[maxPullPx, onRefresh, refreshing, thresholdPx\]\);/);
    assert.match(pullSurfaceSource, /data-pull-refresh-surface=\{surfaceId\}/);
    assert.match(pullSurfaceSource, /data-pull-refresh-phase=\{displayState\.phase\}/);
    assert.match(pullSurfaceSource, /data-pull-refresh-last-event=\{lastDiagnostic\?\.event\}/);
    assert.match(pullSurfaceSource, /data-pull-refresh-last-ignore=\{lastIgnoreReason\}/);
  });
});
