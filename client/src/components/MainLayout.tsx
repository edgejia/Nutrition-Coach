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
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const sending = useStore((s) => s.sending);

  useEffect(() => {
    if (!deviceId) return;
    connectSSE(deviceId, setDailySummary);
    return () => disconnectSSE();
  }, [deviceId, setDailySummary]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
      <header className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => setActiveScreen("home")}
          disabled={sending}
          className="text-lg font-bold text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          AI 營養教練
        </button>
        <button
          type="button"
          onClick={() => setActiveScreen("settings")}
          disabled={sending}
          className="text-sm text-blue-600 hover:underline disabled:no-underline disabled:opacity-50"
        >
          設定目標
        </button>
      </header>

      {activeScreen === "home" && <HomeScreen />}
      {activeScreen === "summary" && <SummaryDetailScreen />}
      {activeScreen === "chat" && <ChatPanel />}
      {activeScreen === "settings" && <GoalSettings onClose={() => setActiveScreen("home")} />}
    </div>
  );
}
