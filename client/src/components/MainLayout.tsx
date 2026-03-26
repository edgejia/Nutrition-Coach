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

  const [showDashboard, setShowDashboard] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
      <header className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-2">
        <h1 className="text-lg font-bold text-gray-900">AI 營養教練</h1>
        <div className="flex gap-3">
          <button onClick={() => setShowDashboard((v) => !v)} className="text-sm text-green-600 hover:underline">
            今日攝取
          </button>
          <button onClick={() => setShowSettings(true)} className="text-sm text-blue-600 hover:underline">
            設定目標
          </button>
        </div>
      </header>
      <ChatPanel />
      {showDashboard && (
        <div className="fixed right-4 top-14 z-50 w-72 rounded-xl bg-white p-4 shadow-xl ring-1 ring-gray-200">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold text-gray-900">今日攝取</span>
            <button onClick={() => setShowDashboard(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <Dashboard />
        </div>
      )}
      {showSettings && <GoalSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
