import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../store.js";
import { getMeals } from "../api.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { createSSESummaryCoordinator } from "../sse-summary-coordinator.js";
import { formatLocalDate } from "../lib/time.js";
import { useDailyRollover } from "../useDailyRollover.js";
import { BottomTabBar } from "./BottomTabBar.js";
import { HomeScreen } from "./HomeScreen.js";
import { ChatPanel } from "./ChatPanel.js";
import { GoalSettings } from "./GoalSettings.js";
import { HistoryDayDetailScreen } from "./HistoryDayDetailScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";
import { MealEditScreen } from "./MealEditScreen.js";

type ShellStyle = {
  setProperty: (name: string, value: string) => void;
  removeProperty: (name: string) => void;
};

type ShellRoot = {
  clientHeight: number;
  style: ShellStyle;
};

type ShellEventTarget = {
  addEventListener: (type: string, listener: () => void, options?: AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type ShellVisualViewport = ShellEventTarget & {
  height: number;
  offsetTop: number;
};

type ShellWindow = ShellEventTarget & {
  innerHeight: number;
  visualViewport?: ShellVisualViewport | null;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  scrollTo?: (x: number, y: number) => void;
};

type ShellDocument = {
  documentElement: ShellRoot;
};

export function installVisualViewportShellVars({
  window: shellWindow,
  document: shellDocument,
}: {
  window: ShellWindow;
  document: ShellDocument;
}) {
  const root = shellDocument.documentElement;
  const viewport = shellWindow.visualViewport;
  let frameId: number | null = null;

  const syncViewportVars = () => {
    frameId = null;
    const visualHeight = viewport?.height ?? shellWindow.innerHeight;
    const visualOffsetTop = viewport?.offsetTop ?? 0;

    root.style.setProperty("--app-visual-viewport-top", `${Math.max(0, Math.round(visualOffsetTop))}px`);
    root.style.setProperty("--app-visual-viewport-height", `${Math.round(visualHeight)}px`);
    root.style.setProperty("--app-bottom-occlusion", "0px");
  };

  const scheduleSync = () => {
    if (frameId !== null) {
      return;
    }

    frameId = shellWindow.requestAnimationFrame(syncViewportVars);
  };

  syncViewportVars();
  shellWindow.addEventListener("resize", scheduleSync, { passive: true });
  shellWindow.addEventListener("orientationchange", scheduleSync);
  shellWindow.addEventListener("focusin", scheduleSync);
  shellWindow.addEventListener("focusout", scheduleSync);
  viewport?.addEventListener("resize", scheduleSync, { passive: true });
  viewport?.addEventListener("scroll", scheduleSync, { passive: true });

  return () => {
    if (frameId !== null) {
      shellWindow.cancelAnimationFrame(frameId);
    }
    shellWindow.removeEventListener("resize", scheduleSync);
    shellWindow.removeEventListener("orientationchange", scheduleSync);
    shellWindow.removeEventListener("focusin", scheduleSync);
    shellWindow.removeEventListener("focusout", scheduleSync);
    viewport?.removeEventListener("resize", scheduleSync);
    viewport?.removeEventListener("scroll", scheduleSync);
    root.style.removeProperty("--app-visual-viewport-top");
    root.style.removeProperty("--app-visual-viewport-height");
    root.style.removeProperty("--app-bottom-occlusion");
  };
}

function useVisualViewportShellVars() {
  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    return installVisualViewportShellVars({ window, document });
  }, []);
}

export function SportAppShell({ children }: { children: ReactNode }) {
  useVisualViewportShellVars();

  return <div className="app-viewport sp-app-canvas relative flex flex-col">{children}</div>;
}

export function MainLayout() {
  const deviceId = useStore((s) => s.deviceId);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const setMeals = useStore((s) => s.setMeals);
  const recordMealMutation = useStore((s) => s.recordMealMutation);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const setRolloverRefreshHandler = useStore((s) => s.setRolloverRefreshHandler);
  const activeScreen = useStore((s) => s.activeScreen);
  const secondaryScreen = useStore((s) => s.secondaryScreen);
  const closeSecondaryScreen = useStore((s) => s.closeSecondaryScreen);
  const [refreshingHomeToday, setRefreshingHomeToday] = useState(false);
  const [homeRefreshError, setHomeRefreshError] = useState<string | null>(null);

  const sseSummaryCoordinator = useMemo(
    () =>
      createSSESummaryCoordinator({
        getMeals,
        setMeals,
        setDailySummary,
        recordMealMutation,
        todayKey: () => formatLocalDate(new Date()),
        onUnauthorized: () => {
          void recoverGuestSession();
        },
      }),
    [setMeals, setDailySummary, recordMealMutation, recoverGuestSession],
  );

  const refreshForRollover = useCallback(async () => {
    if (!deviceId) return;
    disconnectSSE();
    // After rollover we re-subscribe with both handlers so a goals_update
    // that lands immediately after midnight still reaches setDailyTargets.
    connectSSE(deviceId, {
      onDailySummaryEnvelope: sseSummaryCoordinator.handleSummary,
      onGoalsUpdate: setDailyTargets,
    });
    await sseSummaryCoordinator.runInitialMealsLoad({ refreshReason: "day_rollover" });
  }, [deviceId, setDailyTargets, sseSummaryCoordinator]);

  const refreshHomeManually = useCallback(async () => {
    if (!deviceId) return;
    setHomeRefreshError(null);
    setRefreshingHomeToday(true);
    try {
      const { meals } = await getMeals({ refreshReason: "manual_refresh" });
      setMeals(meals);
    } catch {
      setHomeRefreshError("資料暫時無法更新，請稍後再試。");
    } finally {
      setRefreshingHomeToday(false);
    }
  }, [deviceId, setMeals]);

  useEffect(() => {
    if (!deviceId) return;
    void sseSummaryCoordinator.runInitialMealsLoad();
  }, [deviceId, sseSummaryCoordinator]);

  useEffect(() => {
    if (!deviceId) return;
    // Goal updates flow through the existing `setDailyTargets` store action so
    // Dashboard / Settings / HomeHeader re-render via existing selectors —
    // no new UI affordance (D-25, D-26).
    connectSSE(deviceId, {
      onDailySummaryEnvelope: sseSummaryCoordinator.handleSummary,
      onGoalsUpdate: setDailyTargets,
    });
    return () => disconnectSSE();
  }, [deviceId, setDailyTargets, sseSummaryCoordinator]);

  useEffect(() => {
    setRolloverRefreshHandler(deviceId ? refreshForRollover : null);
    return () => setRolloverRefreshHandler(null);
  }, [deviceId, refreshForRollover, setRolloverRefreshHandler]);

  useDailyRollover(refreshForRollover);

  return (
    <SportAppShell>
      {activeScreen === "home" && (
        <HomeScreen
          onRefreshToday={refreshHomeManually}
          refreshingToday={refreshingHomeToday}
          refreshTodayError={homeRefreshError}
        />
      )}
      {activeScreen === "chat" && <ChatPanel />}
      {activeScreen === "history" && <HistoryScreen />}
      {activeScreen !== "chat" && <BottomTabBar />}
      {secondaryScreen?.screen === "settings" && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
          <GoalSettings onClose={closeSecondaryScreen} />
        </div>
      )}
      {secondaryScreen?.screen === "dayDetail" && <HistoryDayDetailScreen onBack={closeSecondaryScreen} />}
      {secondaryScreen?.screen === "mealEdit" && <MealEditScreen onBack={closeSecondaryScreen} />}
    </SportAppShell>
  );
}
