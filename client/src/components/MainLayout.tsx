import { useCallback, useEffect, useLayoutEffect } from "react";
import { useStore } from "../store.js";
import { getMeals } from "../api.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { useDailyRollover } from "../useDailyRollover.js";
import { BottomTabBar } from "./BottomTabBar.js";
import { HomeScreen } from "./HomeScreen.js";
import { ChatPanel } from "./ChatPanel.js";
import { GoalSettings } from "./GoalSettings.js";
import { HistoryDayDetailScreen } from "./HistoryDayDetailScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";
import { MealEditScreen } from "./MealEditScreen.js";

function useVisualViewportShellVars() {
  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frameId: number | null = null;

    const syncViewportVars = () => {
      frameId = null;
      const layoutHeight = Math.max(window.innerHeight, root.clientHeight);
      const visualHeight = viewport?.height ?? window.innerHeight;
      const visualOffsetTop = viewport?.offsetTop ?? 0;
      const visibleBottom = visualOffsetTop + visualHeight;
      const bottomOcclusion = Math.max(0, layoutHeight - visibleBottom);

      root.style.setProperty("--app-visual-viewport-height", `${Math.round(visualHeight)}px`);
      root.style.setProperty("--app-bottom-occlusion", `${Math.round(bottomOcclusion)}px`);
    };

    const scheduleSync = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(syncViewportVars);
    };

    syncViewportVars();
    window.addEventListener("resize", scheduleSync, { passive: true });
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("focusin", scheduleSync);
    window.addEventListener("focusout", scheduleSync);
    viewport?.addEventListener("resize", scheduleSync, { passive: true });
    viewport?.addEventListener("scroll", scheduleSync, { passive: true });

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.removeEventListener("focusin", scheduleSync);
      window.removeEventListener("focusout", scheduleSync);
      viewport?.removeEventListener("resize", scheduleSync);
      viewport?.removeEventListener("scroll", scheduleSync);
      root.style.removeProperty("--app-visual-viewport-height");
      root.style.removeProperty("--app-bottom-occlusion");
    };
  }, []);
}

export function MainLayout() {
  const deviceId = useStore((s) => s.deviceId);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const setMeals = useStore((s) => s.setMeals);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const setRolloverRefreshHandler = useStore((s) => s.setRolloverRefreshHandler);
  const activeScreen = useStore((s) => s.activeScreen);
  const secondaryScreen = useStore((s) => s.secondaryScreen);
  const closeSecondaryScreen = useStore((s) => s.closeSecondaryScreen);

  useVisualViewportShellVars();

  const refreshForRollover = useCallback(async () => {
    if (!deviceId) return;
    disconnectSSE();
    // After rollover we re-subscribe with both handlers so a goals_update
    // that lands immediately after midnight still reaches setDailyTargets.
    connectSSE(deviceId, { onSummary: setDailySummary, onGoalsUpdate: setDailyTargets });
    try {
      const { meals } = await getMeals({ refreshReason: "day_rollover" });
      setMeals(meals);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      }
    }
  }, [deviceId, setDailySummary, setDailyTargets, setMeals, recoverGuestSession]);

  useEffect(() => {
    if (!deviceId) return;
    // Goal updates flow through the existing `setDailyTargets` store action so
    // Dashboard / Settings / HomeHeader re-render via existing selectors —
    // no new UI affordance (D-25, D-26).
    connectSSE(deviceId, { onSummary: setDailySummary, onGoalsUpdate: setDailyTargets });
    return () => disconnectSSE();
  }, [deviceId, setDailySummary, setDailyTargets]);

  useEffect(() => {
    setRolloverRefreshHandler(deviceId ? refreshForRollover : null);
    return () => setRolloverRefreshHandler(null);
  }, [deviceId, refreshForRollover, setRolloverRefreshHandler]);

  useDailyRollover(refreshForRollover);

  return (
    <div className="app-viewport sk-app-canvas relative flex flex-col">
      {activeScreen === "home" && <HomeScreen />}
      {activeScreen === "chat" && <ChatPanel />}
      {activeScreen === "history" && <HistoryScreen />}
      <BottomTabBar />
      {secondaryScreen?.screen === "settings" && <GoalSettings onClose={closeSecondaryScreen} />}
      {secondaryScreen?.screen === "dayDetail" && <HistoryDayDetailScreen onBack={closeSecondaryScreen} />}
      {secondaryScreen?.screen === "mealEdit" && <MealEditScreen onBack={closeSecondaryScreen} />}
    </div>
  );
}
