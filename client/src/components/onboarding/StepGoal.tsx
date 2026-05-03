interface Props {
  onSelect: (goal: "fat_loss" | "muscle_gain") => void;
  error?: string;
}

export function StepGoal({ onSelect, error }: Props) {
  return (
    <div className="sp-onboarding-step sp-onboarding-step-goal">
      <div className="sp-onboarding-copy">
        <h2>
          你的目標是什麼？
        </h2>
        <p>
          選擇一個主要方向，教練會根據這個目標為你規劃。
        </p>
      </div>

      {error ? (
        <div className="sp-onboarding-alert" role="alert">
          <div className="sp-onboarding-alert-label">
            需要重新選擇
          </div>
          <p>
            {error}
          </p>
        </div>
      ) : null}

      <div className="sp-onboarding-goals">
        <button
          type="button"
          onClick={() => onSelect("fat_loss")}
          className="sp-onboarding-goal-card"
          data-accent="lime"
        >
          <div>
            <div className="sp-onboarding-goal-title">
              減脂 · FAT LOSS
            </div>
            <div className="sp-onboarding-goal-desc">
              降低體脂，維持肌肉量
            </div>
          </div>
          <span aria-hidden="true">→</span>
        </button>

        <button
          type="button"
          onClick={() => onSelect("muscle_gain")}
          className="sp-onboarding-goal-card"
          data-accent="cyan"
        >
          <div>
            <div className="sp-onboarding-goal-title">
              增肌 · MUSCLE GAIN
            </div>
            <div className="sp-onboarding-goal-desc">
              增加肌肉，熱量盈餘策略
            </div>
          </div>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
