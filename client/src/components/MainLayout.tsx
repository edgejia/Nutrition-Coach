import { useEffect } from "react";
import { useStore } from "../store.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { HomeScreen } from "./HomeScreen.js";
import { ChatPanel } from "./ChatPanel.js";
import { GoalSettings } from "./GoalSettings.js";
import { SummaryDetailScreen } from "./SummaryDetailScreen.js";

export function MainLayout() {
  const deviceId = useStore((s) => s.deviceId);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const activeScreen = useStore((s) => s.activeScreen);
  const showSettings = useStore((s) => s.showSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);

  useEffect(() => {
    if (!deviceId) return;
    connectSSE(deviceId, setDailySummary);
    return () => disconnectSSE();
  }, [deviceId, setDailySummary]);

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {activeScreen === "home" && <HomeScreen />}
      {activeScreen === "summary" && <SummaryDetailScreen />}
      {activeScreen === "chat" && <ChatPanel />}
      {showSettings && <GoalSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
