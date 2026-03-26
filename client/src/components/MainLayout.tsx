import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import { connectSSE, disconnectSSE } from "../sse.js";
import { Dashboard } from "./Dashboard.js";
import { ChatPanel } from "./ChatPanel.js";
import { GoalSettings } from "./GoalSettings.js";

export function MainLayout() {
  const deviceId = useStore((s) => s.deviceId);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    connectSSE(deviceId, setDailySummary);
    return () => disconnectSSE();
  }, [deviceId]);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <h1 className="text-lg font-bold text-gray-900">AI 營養教練</h1>
        <button onClick={() => setShowSettings(true)} className="text-sm text-blue-600 hover:underline">
          設定目標
        </button>
      </header>
      <div className="p-4">
        <Dashboard />
      </div>
      <ChatPanel />
      {showSettings && <GoalSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
