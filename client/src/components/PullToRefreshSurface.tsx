import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SportRefreshIcon } from "./SportIcons.js";

type PullRefreshPhase = "idle" | "pulling" | "ready" | "refreshing";

export interface PullRefreshState {
  phase: PullRefreshPhase;
  pullDistance: number;
  progress: number;
}

interface PullTouchPoint {
  clientX: number;
  clientY: number;
}

interface PullTouchEvent {
  target: EventTarget | null;
  touches: ArrayLike<PullTouchPoint>;
  changedTouches: ArrayLike<PullTouchPoint>;
  cancelable?: boolean;
  preventDefault?: () => void;
}

interface PullEventTarget {
  addEventListener: (type: string, listener: (event: PullTouchEvent) => void, options?: AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: (event: PullTouchEvent) => void) => void;
}

interface PullElement {
  tagName?: string;
  parentElement?: PullElement | null;
  scrollTop?: number;
  isContentEditable?: boolean;
  matches?: (selector: string) => boolean;
  closest?: (selector: string) => PullElement | null;
}

export interface PullToRefreshControllerOptions {
  eventTarget: PullEventTarget;
  onRefresh: () => void | Promise<void>;
  thresholdPx?: number;
  maxPullPx?: number;
  getScrollTop?: (target: PullElement | null) => number;
  onStateChange?: (state: PullRefreshState) => void;
}

const DEFAULT_THRESHOLD_PX = 72;
const DEFAULT_MAX_PULL_PX = 96;
const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "[contenteditable]",
  ".sp-num-wheel-track",
].join(",");
const SCROLL_CONTAINER_SELECTOR = ".screen-scroll,.screen-scroll-safe,.screen-scroll-with-input,.sp-scroll";

const idleState: PullRefreshState = {
  phase: "idle",
  pullDistance: 0,
  progress: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value && typeof value === "object" && "then" in value);
}

function asPullElement(target: EventTarget | null): PullElement | null {
  if (!target || typeof target !== "object") return null;
  return target as PullElement;
}

function closestElement(target: PullElement | null, selector: string): PullElement | null {
  if (!target) return null;
  if (typeof target.closest === "function") {
    return target.closest(selector);
  }

  let current: PullElement | null | undefined = target;
  const selectors = selector.split(",").map((part) => part.trim());
  while (current) {
    if (selectors.some((part) => current?.matches?.(part))) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isInteractiveTarget(target: PullElement | null) {
  if (!target) return false;
  const tagName = target.tagName?.toLowerCase();
  if (tagName && ["input", "textarea", "select", "button", "a"].includes(tagName)) {
    return true;
  }
  if (target.isContentEditable) return true;
  return Boolean(closestElement(target, INTERACTIVE_SELECTOR));
}

function resolveScrollTop(target: PullElement | null) {
  const scrollContainer = closestElement(target, SCROLL_CONTAINER_SELECTOR);
  return Math.max(0, scrollContainer?.scrollTop ?? 0);
}

function firstTouch(event: PullTouchEvent) {
  return event.touches[0] ?? event.changedTouches[0] ?? null;
}

export function createPullToRefreshController({
  eventTarget,
  onRefresh,
  thresholdPx = DEFAULT_THRESHOLD_PX,
  maxPullPx = DEFAULT_MAX_PULL_PX,
  getScrollTop = resolveScrollTop,
  onStateChange,
}: PullToRefreshControllerOptions): () => void {
  let disposed = false;
  let gestureActive = false;
  let startX = 0;
  let startY = 0;
  let pullDistance = 0;
  let refreshing = false;

  function emitState(state: PullRefreshState) {
    if (!disposed) {
      onStateChange?.(state);
    }
  }

  function resetGesture() {
    gestureActive = false;
    pullDistance = 0;
    if (!refreshing) {
      emitState(idleState);
    }
  }

  function beginRefresh() {
    if (refreshing || disposed) return;
    refreshing = true;
    emitState({ phase: "refreshing", pullDistance: thresholdPx, progress: 1 });

    try {
      const result = onRefresh();
      const settle = () => {
        refreshing = false;
        emitState(idleState);
      };

      if (isPromiseLike(result)) {
        void result.then(settle, settle);
        return;
      }
      settle();
    } catch {
      refreshing = false;
      emitState(idleState);
    }
  }

  function handleTouchStart(event: PullTouchEvent) {
    if (disposed || refreshing) return;
    const touch = firstTouch(event);
    if (!touch) return;

    const target = asPullElement(event.target);
    if (isInteractiveTarget(target)) return;
    if (getScrollTop(target) > 0) return;

    gestureActive = true;
    startX = touch.clientX;
    startY = touch.clientY;
    pullDistance = 0;
  }

  function handleTouchMove(event: PullTouchEvent) {
    if (!gestureActive || refreshing || disposed) return;
    const touch = firstTouch(event);
    if (!touch) return;

    const deltaY = touch.clientY - startY;
    const deltaX = Math.abs(touch.clientX - startX);
    if (deltaY <= 0 || deltaX > deltaY) {
      resetGesture();
      return;
    }

    pullDistance = clamp(deltaY, 0, maxPullPx);
    const progress = clamp(pullDistance / thresholdPx, 0, 1);
    emitState({
      phase: progress >= 1 ? "ready" : "pulling",
      pullDistance,
      progress,
    });
    if (event.cancelable !== false) {
      event.preventDefault?.();
    }
  }

  function handleTouchEnd() {
    if (!gestureActive || disposed) return;
    const shouldRefresh = pullDistance >= thresholdPx;
    gestureActive = false;
    pullDistance = 0;
    if (shouldRefresh) {
      beginRefresh();
      return;
    }
    emitState(idleState);
  }

  function handleTouchCancel() {
    resetGesture();
  }

  eventTarget.addEventListener("touchstart", handleTouchStart, { passive: true });
  eventTarget.addEventListener("touchmove", handleTouchMove, { passive: false });
  eventTarget.addEventListener("touchend", handleTouchEnd);
  eventTarget.addEventListener("touchcancel", handleTouchCancel);

  return () => {
    disposed = true;
    gestureActive = false;
    eventTarget.removeEventListener("touchstart", handleTouchStart);
    eventTarget.removeEventListener("touchmove", handleTouchMove);
    eventTarget.removeEventListener("touchend", handleTouchEnd);
    eventTarget.removeEventListener("touchcancel", handleTouchCancel);
  };
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function PullToRefreshSurface({
  children,
  className,
  onRefresh,
  refreshing = false,
  ariaLabel = "下拉重新整理",
  thresholdPx,
  maxPullPx,
}: {
  children: ReactNode;
  className?: string;
  onRefresh: () => void | Promise<void>;
  refreshing?: boolean;
  ariaLabel?: string;
  thresholdPx?: number;
  maxPullPx?: number;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<PullRefreshState>(idleState);
  const displayState = refreshing
    ? { phase: "refreshing" as const, pullDistance: thresholdPx ?? DEFAULT_THRESHOLD_PX, progress: 1 }
    : state;

  useEffect(() => {
    const eventTarget = surfaceRef.current;
    if (!eventTarget) return undefined;

    return createPullToRefreshController({
      eventTarget,
      onRefresh: () => {
        if (refreshing) return undefined;
        return onRefresh();
      },
      thresholdPx,
      maxPullPx,
      onStateChange: setState,
    });
  }, [maxPullPx, onRefresh, refreshing, thresholdPx]);

  return (
    <div
      ref={surfaceRef}
      className={cx(
        "sp-pull-refresh",
        (displayState.phase === "pulling" || displayState.phase === "ready") && "sp-pull-refresh--pulling",
        displayState.phase === "ready" && "sp-pull-refresh--ready",
        displayState.phase === "refreshing" && "sp-pull-refresh--refreshing",
        className,
      )}
      style={{ "--sp-pull-refresh-progress": displayState.progress } as CSSProperties}
    >
      <div
        aria-label={displayState.phase === "refreshing" ? "重新整理中" : ariaLabel}
        aria-live="polite"
        className="sp-pull-refresh-indicator"
        role="status"
      >
        <SportRefreshIcon size={20} />
      </div>
      <div className="sp-pull-refresh-content">{children}</div>
    </div>
  );
}
