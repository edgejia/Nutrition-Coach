import { useCallback, useEffect } from "react";
import { useStore } from "../store.js";
import { getMeals } from "../api.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { useDailyRollover } from "../useDailyRollover.js";
import { HomeScreen } from "./HomeScreen.js";
import { ChatPanel } from "./ChatPanel.js";
import { GoalSettings } from "./GoalSettings.js";
import { SummaryDetailScreen } from "./SummaryDetailScreen.js";

export function MainLayout() {
  const deviceId = useStore((s) => s.deviceId);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setMeals = useStore((s) => s.setMeals);
  const clearDevice = useStore((s) => s.clearDevice);
  const setRolloverRefreshHandler = useStore((s) => s.setRolloverRefreshHandler);
  const activeScreen = useStore((s) => s.activeScreen);
  const showSettings = useStore((s) => s.showSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);

  const refreshForRollover = useCallback(async () => {
    if (!deviceId) return;
    disconnectSSE();
    connectSSE(deviceId, setDailySummary);
    try {
      const { meals } = await getMeals({ refreshReason: "day_rollover" });
      setMeals(meals);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        clearDevice();
      }
    }
  }, [deviceId, setDailySummary, setMeals, clearDevice]);

  useEffect(() => {
    if (!deviceId) return;
    connectSSE(deviceId, setDailySummary);
    return () => disconnectSSE();
  }, [deviceId, setDailySummary]);

  useEffect(() => {
    setRolloverRefreshHandler(deviceId ? refreshForRollover : null);
    return () => setRolloverRefreshHandler(null);
  }, [deviceId, refreshForRollover, setRolloverRefreshHandler]);

  useDailyRollover(refreshForRollover);

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {activeScreen === "home" && <HomeScreen />}
      {activeScreen === "summary" && <SummaryDetailScreen />}
      {activeScreen === "chat" && <ChatPanel />}
      {showSettings && <GoalSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
