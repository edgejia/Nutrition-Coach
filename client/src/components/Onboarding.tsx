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
    <div className="flex min-h-screen flex-col justify-center p-8" style={{ background: "var(--bg)" }}>
      <div className="mb-3 text-xs font-bold tracking-widest uppercase" style={{ color: "var(--orange)", letterSpacing: "0.2em" }}>
        // SYSTEM INIT
      </div>

      <h1
        className="mb-5 leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(56px, 16vw, 72px)",
          fontWeight: 800,
          color: "var(--text)",
          letterSpacing: "-0.02em",
          lineHeight: 0.92,
        }}
      >
        AI
        <br />
        <span style={{ color: "var(--orange)" }}>NUTRITION</span>
        <br />
        COACH
      </h1>

      <p className="mb-10 text-sm leading-relaxed" style={{ color: "var(--text-2)", maxWidth: 280 }}>
        設定你的訓練目標。AI 教練會根據你的目標，每天即時分析飲食並給出建議。
      </p>

      <div className="space-y-3">
        <button
          onClick={() => handleSelect("fat_loss")}
          disabled={loading}
          className="flex w-full items-center justify-between rounded-xl p-5 text-left transition-opacity disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, #0D1A0D, #0F2010)",
            border: "1px solid rgba(76,184,122,0.25)",
          }}
        >
          <div>
            <div
              className="mb-1 text-xl font-bold tracking-wide"
              style={{ fontFamily: "var(--font-display)", color: "var(--green)" }}
            >
              減脂 · FAT LOSS
            </div>
            <div className="text-sm" style={{ color: "var(--text-2)" }}>
              降低體脂，維持肌肉量
            </div>
          </div>
          <span style={{ color: "var(--green)", fontSize: 20 }}>→</span>
        </button>

        <button
          onClick={() => handleSelect("muscle_gain")}
          disabled={loading}
          className="flex w-full items-center justify-between rounded-xl p-5 text-left transition-opacity disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, #100D1A, #181025)",
            border: "1px solid rgba(91,150,232,0.25)",
          }}
        >
          <div>
            <div
              className="mb-1 text-xl font-bold tracking-wide"
              style={{ fontFamily: "var(--font-display)", color: "var(--blue)" }}
            >
              增肌 · MUSCLE GAIN
            </div>
            <div className="text-sm" style={{ color: "var(--text-2)" }}>
              增加肌肉，熱量盈餘策略
            </div>
          </div>
          <span style={{ color: "var(--blue)", fontSize: 20 }}>→</span>
        </button>
      </div>
    </div>
  );
}
