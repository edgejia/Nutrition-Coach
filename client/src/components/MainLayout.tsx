import { useCallback, useEffect } from "react";
import { useStore } from "../store.js";
import { getMeals } from "../api.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { useDailyRollover } from "../useDailyRollover.js";
import { HomeScreen } from "./HomeScreen.js";
import { ChatPanel } from "./ChatPanel.js";
import { GoalSettings } from "./GoalSettings.js";
import { SummaryDetailScreen } from "./SummaryDetailScreen.js";

function syncAppViewportHeight() {
  if (typeof window === "undefined") {
    return () => {};
  }

  const root = document.documentElement;
  const viewport = window.visualViewport;

  function applyViewportHeight() {
    root.style.setProperty(
      "--app-viewport-height",
      `${Math.round(viewport?.height ?? window.innerHeight)}px`,
    );
  }

  applyViewportHeight();
  window.addEventListener("resize", applyViewportHeight);
  window.addEventListener("orientationchange", applyViewportHeight);
  viewport?.addEventListener("resize", applyViewportHeight);
  viewport?.addEventListener("scroll", applyViewportHeight);

  return () => {
    window.removeEventListener("resize", applyViewportHeight);
    window.removeEventListener("orientationchange", applyViewportHeight);
    viewport?.removeEventListener("resize", applyViewportHeight);
    viewport?.removeEventListener("scroll", applyViewportHeight);
    root.style.removeProperty("--app-viewport-height");
  };
}

export function MainLayout() {
  const deviceId = useStore((s) => s.deviceId);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const setMeals = useStore((s) => s.setMeals);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const setRolloverRefreshHandler = useStore((s) => s.setRolloverRefreshHandler);
  const activeScreen = useStore((s) => s.activeScreen);
  const showSettings = useStore((s) => s.showSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);

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

  useEffect(() => syncAppViewportHeight(), []);

  return (
    <div className="app-viewport flex flex-col" style={{ background: "var(--bg)" }}>
      {activeScreen === "home" && <HomeScreen />}
      {activeScreen === "summary" && <SummaryDetailScreen />}
      {activeScreen === "chat" && <ChatPanel />}
      {showSettings && <GoalSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
