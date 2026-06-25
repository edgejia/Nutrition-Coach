import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SportRefreshIcon } from "./SportIcons.js";

type PullRefreshPhase = "idle" | "pulling" | "ready" | "refreshing" | "complete";

type PullRefreshIgnoredReason =
  | "in_flight"
  | "missing_touch"
  | "interactive_target"
  | "not_at_top"
  | "horizontal_drag"
  | "below_threshold";

export interface PullRefreshDiagnosticEvent {
  event:
    | "listener_attached"
    | "touch_start_accepted"
    | "touch_start_ignored"
    | "pulling"
    | "threshold_ready"
    | "refresh_start"
    | "refresh_settle"
    | "cleanup";
  surfaceId: string;
  eventTargetKind?: "scroll" | "wrapper";
  scrollTop?: number;
  pullDistance?: number;
  progress?: number;
  reason?: PullRefreshIgnoredReason;
  phase?: PullRefreshPhase;
}

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

export interface PullEventTarget {
  addEventListener: (type: string, listener: (event: PullTouchEvent) => void, options?: AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: (event: PullTouchEvent) => void, options?: AddEventListenerOptions) => void;
}

export interface PullRefreshRoot extends PullEventTarget {
  querySelector?: (selector: string) => PullEventTarget | null;
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
  surfaceId?: string;
  eventTargetKind?: "scroll" | "wrapper";
  onDiagnosticEvent?: (event: PullRefreshDiagnosticEvent) => void;
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
const TOUCH_START_OPTIONS = { passive: true, capture: true } as const;
const TOUCH_MOVE_OPTIONS = { passive: false, capture: true } as const;
const TOUCH_END_OPTIONS = { capture: true } as const;

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

export function resolvePullRefreshEventTarget(root: PullRefreshRoot): {
  eventTarget: PullEventTarget;
  eventTargetKind: "scroll" | "wrapper";
} {
  const scrollTarget = root.querySelector?.(SCROLL_CONTAINER_SELECTOR);
  if (scrollTarget) {
    return { eventTarget: scrollTarget, eventTargetKind: "scroll" };
  }
  return { eventTarget: root, eventTargetKind: "wrapper" };
}

export function createPullToRefreshController({
  eventTarget,
  onRefresh,
  thresholdPx = DEFAULT_THRESHOLD_PX,
  maxPullPx = DEFAULT_MAX_PULL_PX,
  getScrollTop = resolveScrollTop,
  onStateChange,
  surfaceId = "unknown",
  eventTargetKind = "wrapper",
  onDiagnosticEvent,
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

  function emitDiagnostic(event: PullRefreshDiagnosticEvent) {
    if (!disposed) {
      onDiagnosticEvent?.(event);
    }
  }

  function emitIgnored(reason: PullRefreshIgnoredReason, target: PullElement | null) {
    emitDiagnostic({
      event: "touch_start_ignored",
      surfaceId,
      eventTargetKind,
      scrollTop: getScrollTop(target),
      reason,
      phase: refreshing ? "refreshing" : "idle",
    });
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
    emitDiagnostic({
      event: "refresh_start",
      surfaceId,
      eventTargetKind,
      pullDistance: thresholdPx,
      progress: 1,
      phase: "refreshing",
    });

    try {
      const result = onRefresh();
      const settle = () => {
        refreshing = false;
        emitDiagnostic({ event: "refresh_settle", surfaceId, eventTargetKind, phase: "complete" });
        emitState({ phase: "complete", pullDistance: 0, progress: 0 });
      };

      if (isPromiseLike(result)) {
        void result.then(settle, settle);
        return;
      }
      settle();
    } catch {
      refreshing = false;
      emitDiagnostic({ event: "refresh_settle", surfaceId, eventTargetKind, phase: "complete" });
      emitState({ phase: "complete", pullDistance: 0, progress: 0 });
    }
  }

  function handleTouchStart(event: PullTouchEvent) {
    if (disposed) return;
    const target = asPullElement(event.target);
    if (refreshing) {
      emitIgnored("in_flight", target);
      return;
    }
    const touch = firstTouch(event);
    if (!touch) {
      emitIgnored("missing_touch", target);
      return;
    }

    if (isInteractiveTarget(target)) {
      emitIgnored("interactive_target", target);
      return;
    }
    const scrollTop = getScrollTop(target);
    if (scrollTop > 0) {
      emitIgnored("not_at_top", target);
      return;
    }

    gestureActive = true;
    startX = touch.clientX;
    startY = touch.clientY;
    pullDistance = 0;
    emitDiagnostic({
      event: "touch_start_accepted",
      surfaceId,
      eventTargetKind,
      scrollTop,
      pullDistance: 0,
      progress: 0,
      phase: "idle",
    });
  }

  function handleTouchMove(event: PullTouchEvent) {
    if (!gestureActive || refreshing || disposed) return;
    const touch = firstTouch(event);
    if (!touch) return;

    const deltaY = touch.clientY - startY;
    const deltaX = Math.abs(touch.clientX - startX);
    if (deltaY <= 0 || deltaX > deltaY) {
      emitIgnored("horizontal_drag", asPullElement(event.target));
      resetGesture();
      return;
    }

    pullDistance = clamp(deltaY, 0, maxPullPx);
    const progress = clamp(pullDistance / thresholdPx, 0, 1);
    const phase = progress >= 1 ? "ready" : "pulling";
    emitState({
      phase,
      pullDistance,
      progress,
    });
    emitDiagnostic({
      event: progress >= 1 ? "threshold_ready" : "pulling",
      surfaceId,
      eventTargetKind,
      pullDistance,
      progress,
      phase,
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
    emitIgnored("below_threshold", asPullElement(null));
    emitState(idleState);
  }

  function handleTouchCancel() {
    resetGesture();
  }

  eventTarget.addEventListener("touchstart", handleTouchStart, TOUCH_START_OPTIONS);
  eventTarget.addEventListener("touchmove", handleTouchMove, TOUCH_MOVE_OPTIONS);
  eventTarget.addEventListener("touchend", handleTouchEnd, TOUCH_END_OPTIONS);
  eventTarget.addEventListener("touchcancel", handleTouchCancel, TOUCH_END_OPTIONS);
  emitDiagnostic({ event: "listener_attached", surfaceId, eventTargetKind, phase: "idle" });

  return () => {
    emitDiagnostic({ event: "cleanup", surfaceId, eventTargetKind, phase: "idle" });
    disposed = true;
    gestureActive = false;
    eventTarget.removeEventListener("touchstart", handleTouchStart, TOUCH_START_OPTIONS);
    eventTarget.removeEventListener("touchmove", handleTouchMove, TOUCH_MOVE_OPTIONS);
    eventTarget.removeEventListener("touchend", handleTouchEnd, TOUCH_END_OPTIONS);
    eventTarget.removeEventListener("touchcancel", handleTouchCancel, TOUCH_END_OPTIONS);
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
  surfaceId = "unknown",
  completionLabel = "已更新",
  onDiagnosticEvent,
  thresholdPx,
  maxPullPx,
}: {
  children: ReactNode;
  className?: string;
  onRefresh: () => void | Promise<void>;
  refreshing?: boolean;
  ariaLabel?: string;
  surfaceId?: string;
  completionLabel?: string;
  onDiagnosticEvent?: (event: PullRefreshDiagnosticEvent) => void;
  thresholdPx?: number;
  maxPullPx?: number;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const refreshingRef = useRef(refreshing);
  const [state, setState] = useState<PullRefreshState>(idleState);
  const [lastDiagnostic, setLastDiagnostic] = useState<PullRefreshDiagnosticEvent | null>(null);
  const displayState = refreshing
    ? { phase: "refreshing" as const, pullDistance: thresholdPx ?? DEFAULT_THRESHOLD_PX, progress: 1 }
    : state;
  const lastIgnoreReason = lastDiagnostic?.event === "touch_start_ignored" ? lastDiagnostic.reason : undefined;

  useEffect(() => {
    refreshingRef.current = refreshing;
    if (!refreshing) {
      setState((current) => (current.phase === "refreshing" ? { phase: "complete", pullDistance: 0, progress: 0 } : current));
    }
  }, [refreshing]);

  useEffect(() => {
    if (state.phase !== "complete") return undefined;
    const timeout = window.setTimeout(() => setState(idleState), 650);
    return () => window.clearTimeout(timeout);
  }, [state.phase]);

  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return undefined;
    const { eventTarget, eventTargetKind } = resolvePullRefreshEventTarget(root);

    return createPullToRefreshController({
      eventTarget,
      onRefresh: () => {
        if (refreshingRef.current) return undefined;
        return onRefresh();
      },
      thresholdPx,
      maxPullPx,
      onStateChange: setState,
      surfaceId,
      eventTargetKind,
      onDiagnosticEvent: (event) => {
        setLastDiagnostic(event);
        onDiagnosticEvent?.(event);
      },
    });
  }, [maxPullPx, onDiagnosticEvent, onRefresh, surfaceId, thresholdPx]);

  return (
    <div
      ref={surfaceRef}
      data-pull-refresh-surface={surfaceId}
      data-pull-refresh-event-target={lastDiagnostic?.eventTargetKind}
      data-pull-refresh-phase={displayState.phase}
      data-pull-refresh-progress={displayState.progress}
      data-pull-refresh-last-event={lastDiagnostic?.event}
      data-pull-refresh-last-ignore={lastIgnoreReason}
      className={cx(
        "sp-pull-refresh",
        (displayState.phase === "pulling" || displayState.phase === "ready") && "sp-pull-refresh--pulling",
        displayState.phase === "ready" && "sp-pull-refresh--ready",
        displayState.phase === "refreshing" && "sp-pull-refresh--refreshing",
        displayState.phase === "complete" && "sp-pull-refresh--complete",
        className,
      )}
      style={{ "--sp-pull-refresh-progress": displayState.progress } as CSSProperties}
    >
      <div
        aria-label={displayState.phase === "refreshing" ? "重新整理中" : displayState.phase === "complete" ? completionLabel : ariaLabel}
        aria-live="polite"
        className="sp-pull-refresh-indicator"
        role="status"
      >
        <SportRefreshIcon size={20} />
        <span className="sp-pull-refresh-complete-label">{completionLabel}</span>
      </div>
      <div className="sp-pull-refresh-content">{children}</div>
    </div>
  );
}
