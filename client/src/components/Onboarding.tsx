import { useState } from "react";
import { useStore } from "../store.js";
import { registerDevice } from "../api.js";

export function Onboarding() {
  const setDevice = useStore((s) => s.setDevice);
  const [loading, setLoading] = useState(false);

  async function handleSelect(goal: "fat_loss" | "muscle_gain") {
    setLoading(true);
    try {
      const { deviceId, dailyTargets } = await registerDevice(goal);
      setDevice(deviceId, goal, dailyTargets);
    } catch {
      alert("無法連線，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-bold text-gray-900">AI 營養教練</h1>
        <p className="text-gray-600">選擇你的目標，開始記錄飲食吧！</p>
        <div className="space-y-3">
          <button
            onClick={() => handleSelect("fat_loss")}
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 px-6 py-4 text-lg font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            減脂
          </button>
          <button
            onClick={() => handleSelect("muscle_gain")}
            disabled={loading}
            className="w-full rounded-xl bg-green-600 px-6 py-4 text-lg font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            增肌
          </button>
        </div>
      </div>
    </div>
  );
}
