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
      <div className="sp-onboarding-step sp-onboarding-handoff">
        <div className="sp-onboarding-result-card">
          <div className="sp-onboarding-result-icon" aria-hidden="true">🏋️</div>
          <h2>
            教練正在分析你的資料…
          </h2>
          <p>
            根據你提供的數據，量身打造營養計畫
          </p>
        </div>
      </div>
    );
  }

  if (transportError) {
    return (
      <div className="sp-onboarding-step sp-onboarding-handoff">
        <div className="sp-onboarding-result-card sp-onboarding-result-card-error" role="alert">
          <div className="sp-onboarding-step-label">
            第 06 步 / 共 06 步
          </div>
          <h2>
            連線失敗
          </h2>
          <p>{transportError}</p>
          <button type="button" className="sp-onboarding-primary" onClick={onRetry}>
            重試
          </button>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const { dailyTargets, coachExplanation } = result;

  return (
    <div className="sp-onboarding-step sp-onboarding-handoff">
      <div className="sp-onboarding-copy">
        <div className="sp-onboarding-kicker">你的計畫已準備好</div>
        <h2>
          每日目標
        </h2>
      </div>

      <div className="sp-onboarding-target-grid">
        {[
          { label: "每日熱量", value: `${dailyTargets.calories}`, unit: "kcal" },
          { label: "蛋白質", value: `${dailyTargets.protein}`, unit: "g" },
          { label: "碳水化合物", value: `${dailyTargets.carbs}`, unit: "g" },
          { label: "脂肪", value: `${dailyTargets.fat}`, unit: "g" },
        ].map(({ label, value, unit }) => (
          <div
            key={label}
            className="sp-onboarding-target-card"
          >
            <div className="sp-onboarding-target-label">{label}</div>
            <div className="sp-onboarding-target-value">
              {value}
              <span>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="sp-onboarding-result-card">
        <div className="sp-onboarding-kicker">
          教練說明
        </div>
        <p>
          {coachExplanation}
        </p>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="sp-onboarding-primary"
      >
        開始記錄飲食
      </button>
    </div>
  );
}
