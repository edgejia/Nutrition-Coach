import type { IntakeData } from "../../types.js";

interface Props {
  onSelect: (goal: IntakeData["goal"]) => void;
  error?: string;
}

const GOAL_OPTIONS: readonly {
  value: IntakeData["goal"];
  title: string;
  description: string;
  accent: "lime" | "cyan" | "amber";
}[] = [
  {
    value: "fat_loss",
    title: "減脂 · FAT LOSS",
    description: "降低體脂，維持肌肉量",
    accent: "lime",
  },
  {
    value: "muscle_gain",
    title: "增肌 · MUSCLE GAIN",
    description: "增加肌肉，熱量盈餘策略",
    accent: "cyan",
  },
  {
    value: "maintain",
    title: "維持 · MAINTAIN",
    description: "穩定體態，習慣養成",
    accent: "amber",
  },
];

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
        {GOAL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className="sp-onboarding-goal-card"
            data-accent={option.accent}
          >
            <div>
              <div className="sp-onboarding-goal-title">
                {option.title}
              </div>
              <div className="sp-onboarding-goal-desc">
                {option.description}
              </div>
            </div>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
