import { useCallback, useEffect, useLayoutEffect } from "react";
import { useStore } from "../store.js";
import { getMeals } from "../api.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { useDailyRollover } from "../useDailyRollover.js";
import { BottomTabBar } from "./BottomTabBar.js";
import { HomeScreen } from "./HomeScreen.js";
import { ChatPanel } from "./ChatPanel.js";
import { GoalSettings } from "./GoalSettings.js";
import { SecondaryHeader, SketchScreen } from "./SketchPrimitives.js";

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

function HistoryScreen() {
  return (
    <SketchScreen>
      <header className="sk-screen-header">
        <span aria-hidden="true" />
        <h1 className="sk-heading text-xl">歷史</h1>
        <span aria-hidden="true" />
      </header>
      <main className="sk-screen-content screen-scroll-safe p-4">
        <div className="sk-box-soft p-4">
          <h2 className="sk-heading text-lg">還沒有資料</h2>
          <p className="sk-body mt-2" style={{ color: "var(--sk-ink-soft)" }}>
            History content lands in Phase 34
          </p>
        </div>
      </main>
    </SketchScreen>
  );
}

function SecondaryPlaceholder({
  title,
  backLabel,
  onBack,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[var(--sk-paper)]">
      <SketchScreen>
        <SecondaryHeader title={title} backLabel={backLabel} onBack={onBack} />
        <main className="sk-screen-content screen-scroll-safe p-4">
          <div className="sk-box-dashed p-4">
            <p className="sk-body" style={{ color: "var(--sk-ink-soft)" }}>
              {title} shell lands in a later v1.8 phase.
            </p>
          </div>
        </main>
      </SketchScreen>
    </div>
  );
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
    <div className="app-viewport sk-app-canvas flex flex-col">
      {activeScreen === "home" && <HomeScreen />}
      {activeScreen === "chat" && <ChatPanel />}
      {activeScreen === "history" && <HistoryScreen />}
      <BottomTabBar />
      {secondaryScreen?.screen === "settings" && <GoalSettings onClose={closeSecondaryScreen} />}
      {secondaryScreen?.screen === "dayDetail" && (
        <SecondaryPlaceholder title="Day Detail" backLabel="‹ 歷史" onBack={closeSecondaryScreen} />
      )}
      {secondaryScreen?.screen === "mealEdit" && (
        <SecondaryPlaceholder title="Meal Edit" backLabel="‹ 對話" onBack={closeSecondaryScreen} />
      )}
    </div>
  );
}
