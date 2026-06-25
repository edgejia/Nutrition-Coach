import { useEffect } from "react";

const BROWSER_BACK_SENTINEL_STATE = {
  nutritionCoachBrowserBackSentinel: true,
} as const;

export type BrowserBackPopStateListener = (event: PopStateEvent) => void;

export interface BrowserBackWindowTarget {
  addEventListener(type: "popstate", listener: BrowserBackPopStateListener): void;
  removeEventListener(type: "popstate", listener: BrowserBackPopStateListener): void;
}

export interface BrowserBackHistoryTarget {
  readonly state: unknown;
  pushState(state: unknown, title: string, url?: string | URL | null): void;
  back(): void;
}

export interface BrowserBackDiagnosticEvent {
  event:
    | "popstate"
    | "go_back_handled"
    | "go_back_unhandled"
    | "rearm_attempted"
    | "rearm_confirmed"
    | "browser_back_delegated";
  sourceId: string;
  handled?: boolean;
  repaired?: boolean;
}

export interface BrowserBackControllerOptions {
  goBack: () => boolean;
  windowTarget: BrowserBackWindowTarget;
  historyTarget: BrowserBackHistoryTarget;
  sourceId?: string;
  onDiagnosticEvent?: (event: BrowserBackDiagnosticEvent) => void;
  scheduleRearm?: (callback: () => void) => void;
}

function isBrowserBackSentinelState(state: unknown) {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { nutritionCoachBrowserBackSentinel?: unknown }).nutritionCoachBrowserBackSentinel === true
  );
}

export function createBrowserBackSentinelController(options: BrowserBackControllerOptions): () => void {
  const {
    goBack,
    historyTarget,
    windowTarget,
    sourceId = "authenticated-shell",
    onDiagnosticEvent,
    scheduleRearm = (callback) => {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(callback);
        return;
      }
      globalThis.setTimeout(callback, 0);
    },
  } = options;
  let disposed = false;
  let rearmConfirmationPending = false;

  function emit(event: BrowserBackDiagnosticEvent) {
    if (!disposed) {
      onDiagnosticEvent?.(event);
    }
  }

  function armSentinel({ force = false }: { force?: boolean } = {}) {
    if (!force && isBrowserBackSentinelState(historyTarget.state)) {
      return;
    }
    historyTarget.pushState(BROWSER_BACK_SENTINEL_STATE, "");
  }

  function confirmRearm() {
    if (rearmConfirmationPending || disposed) {
      return;
    }
    rearmConfirmationPending = true;
    scheduleRearm(() => {
      rearmConfirmationPending = false;
      if (disposed) {
        return;
      }
      const repaired = !isBrowserBackSentinelState(historyTarget.state);
      if (repaired) {
        armSentinel({ force: true });
      }
      emit({ event: "rearm_confirmed", sourceId, repaired });
    });
  }

  function handlePopState(_event: PopStateEvent) {
    if (disposed) {
      return;
    }
    emit({ event: "popstate", sourceId });
    if (goBack()) {
      emit({ event: "go_back_handled", sourceId, handled: true });
      armSentinel({ force: true });
      emit({ event: "rearm_attempted", sourceId });
      confirmRearm();
      return;
    }
    emit({ event: "go_back_unhandled", sourceId, handled: false });
    emit({ event: "browser_back_delegated", sourceId, handled: false });
    historyTarget.back();
  }

  armSentinel();
  windowTarget.addEventListener("popstate", handlePopState);

  return () => {
    disposed = true;
    windowTarget.removeEventListener("popstate", handlePopState);
  };
}

export function useBrowserBackSentinel(
  goBack: () => boolean,
  options: Pick<BrowserBackControllerOptions, "sourceId" | "onDiagnosticEvent"> = {},
) {
  useEffect(() => {
    return createBrowserBackSentinelController({
      goBack,
      historyTarget: window.history,
      windowTarget: window,
      sourceId: options.sourceId,
      onDiagnosticEvent: options.onDiagnosticEvent,
    });
  }, [goBack, options.onDiagnosticEvent, options.sourceId]);
}
