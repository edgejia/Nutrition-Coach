import { SketchBox, SketchButton, SketchPill, SketchSoftBox } from "../SketchPrimitives.js";
import type { IntakeResult } from "../../types.js";

interface Props {
  loading: boolean;
  transportError: string | null;
  result: IntakeResult | null;
  onStart: () => void;
  onRetry: () => void;
}

export function StepCoachHandoff({ loading, transportError, result, onStart, onRetry }: Props) {
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center p-4">
        <SketchBox className="p-5 text-center">
          <div className="mb-4 text-4xl">🏋️</div>
          <h2 className="sk-heading mb-2 text-2xl">
            教練正在分析你的資料…
          </h2>
          <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
            根據你提供的數據，量身打造營養計畫
          </p>
        </SketchBox>
      </div>
    );
  }

  if (transportError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center p-4">
        <SketchBox className="p-5 text-center" role="alert" style={{ background: "var(--sk-accent-soft)" }}>
          <h2 className="sk-heading mb-3 text-2xl">
            連線失敗
          </h2>
          <p className="sk-body mb-5 text-sm" style={{ color: "var(--sk-ink-soft)" }}>{transportError}</p>
          <SketchButton onClick={onRetry} variant="accent">
            重試
          </SketchButton>
        </SketchBox>
      </div>
    );
  }

  if (!result) return null;

  const { dailyTargets, coachExplanation } = result;

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 p-4">
      <SketchPill className="self-start">
        YOUR PLAN
      </SketchPill>
      <h2 className="sk-heading text-2xl">
        你的專屬營養計畫
      </h2>

      {/* Targets Grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "每日熱量", value: `${dailyTargets.calories}`, unit: "kcal" },
          { label: "蛋白質", value: `${dailyTargets.protein}`, unit: "g" },
          { label: "碳水化合物", value: `${dailyTargets.carbs}`, unit: "g" },
          { label: "脂肪", value: `${dailyTargets.fat}`, unit: "g" },
        ].map(({ label, value, unit }) => (
          <SketchSoftBox
            key={label}
            className="p-4"
          >
            <div className="sk-body mb-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>{label}</div>
            <div className="sk-heading text-2xl">
              {value}
              <span className="sk-body ml-1 text-xs font-normal" style={{ color: "var(--sk-ink-soft)" }}>{unit}</span>
            </div>
          </SketchSoftBox>
        ))}
      </div>

      {/* Coach Explanation */}
      <SketchBox className="p-5">
        <div className="sk-body mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--sk-accent)" }}>
          教練說明
        </div>
        <p className="sk-body text-sm leading-relaxed">
          {coachExplanation}
        </p>
      </SketchBox>

      {/* CTA */}
      <SketchButton
        onClick={onStart}
        className="w-full py-4"
        variant="accent"
      >
        開始記錄飲食
      </SketchButton>
    </div>
  );
}
