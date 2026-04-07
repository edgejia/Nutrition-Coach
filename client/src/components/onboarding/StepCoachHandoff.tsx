import type { IntakeResult } from "../../types.js";

interface Props {
  loading: boolean;
  error: string | null;
  result: IntakeResult | null;
  onStart: () => void;
  onRetry: () => void;
}

export function StepCoachHandoff({ loading, error, result, onStart, onRetry }: Props) {
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8" style={{ background: "var(--bg)" }}>
        <div className="mb-4 text-4xl">🏋️</div>
        <h2 className="mb-2 text-xl font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
          教練正在分析你的資料…
        </h2>
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          根據你提供的數據，量身打造營養計畫
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8" style={{ background: "var(--bg)" }}>
        <h2 className="mb-4 text-xl font-bold" style={{ color: "var(--text)" }}>
          連線失敗
        </h2>
        <p className="mb-6 text-sm" style={{ color: "var(--text-2)" }}>{error}</p>
        <button
          onClick={onRetry}
          className="rounded-xl px-8 py-3 text-sm font-bold"
          style={{ background: "var(--orange)", color: "#000" }}
        >
          重試
        </button>
      </div>
    );
  }

  if (!result) return null;

  const { dailyTargets, coachExplanation } = result;

  return (
    <div className="flex min-h-screen flex-col justify-center p-8" style={{ background: "var(--bg)" }}>
      <div className="mb-3 text-xs font-bold tracking-widest uppercase" style={{ color: "var(--orange)", letterSpacing: "0.2em" }}>
        YOUR PLAN
      </div>
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
        你的專屬營養計畫
      </h2>

      {/* Targets Grid */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        {[
          { label: "每日熱量", value: `${dailyTargets.calories}`, unit: "kcal", color: "var(--orange)" },
          { label: "蛋白質", value: `${dailyTargets.protein}`, unit: "g", color: "var(--green)" },
          { label: "碳水化合物", value: `${dailyTargets.carbs}`, unit: "g", color: "var(--blue)" },
          { label: "脂肪", value: `${dailyTargets.fat}`, unit: "g", color: "var(--text-2)" },
        ].map(({ label, value, unit, color }) => (
          <div
            key={label}
            className="rounded-xl p-4"
            style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
          >
            <div className="mb-1 text-xs" style={{ color: "var(--text-2)" }}>{label}</div>
            <div className="text-2xl font-bold" style={{ color, fontFamily: "var(--font-display)" }}>
              {value}
              <span className="ml-1 text-xs font-normal" style={{ color: "var(--text-2)" }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Coach Explanation */}
      <div
        className="mb-8 rounded-xl p-5"
        style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
      >
        <div className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--orange)" }}>
          教練說明
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
          {coachExplanation}
        </p>
      </div>

      {/* CTA */}
      <button
        onClick={onStart}
        className="w-full rounded-xl py-4 text-base font-bold"
        style={{ background: "var(--orange)", color: "#000" }}
      >
        開始記錄飲食
      </button>
    </div>
  );
}
