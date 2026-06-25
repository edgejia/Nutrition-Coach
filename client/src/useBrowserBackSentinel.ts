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
}

export interface BrowserBackControllerOptions {
  goBack: () => boolean;
  windowTarget: BrowserBackWindowTarget;
  historyTarget: BrowserBackHistoryTarget;
}

function isBrowserBackSentinelState(state: unknown) {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { nutritionCoachBrowserBackSentinel?: unknown }).nutritionCoachBrowserBackSentinel === true
  );
}

export function createBrowserBackSentinelController(options: BrowserBackControllerOptions): () => void {
  const { goBack, historyTarget, windowTarget } = options;
  let disposed = false;

  function armSentinel({ force = false }: { force?: boolean } = {}) {
    if (!force && isBrowserBackSentinelState(historyTarget.state)) {
      return;
    }
    historyTarget.pushState(BROWSER_BACK_SENTINEL_STATE, "");
  }

  function handlePopState(_event: PopStateEvent) {
    if (disposed) {
      return;
    }
    if (goBack()) {
      armSentinel({ force: true });
    }
  }

  armSentinel();
  windowTarget.addEventListener("popstate", handlePopState);

  return () => {
    disposed = true;
    windowTarget.removeEventListener("popstate", handlePopState);
  };
}

export function useBrowserBackSentinel(goBack: () => boolean) {
  useEffect(() => {
    return createBrowserBackSentinelController({
      goBack,
      historyTarget: window.history,
      windowTarget: window,
    });
  }, [goBack]);
}
