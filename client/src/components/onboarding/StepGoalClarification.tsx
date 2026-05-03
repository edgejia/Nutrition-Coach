import { useEffect, useState } from "react";

interface Props {
  goal: "fat_loss" | "muscle_gain";
  onNext: (clarification?: string) => void;
  onBack: () => void;
  initialValue?: string;
  error?: string;
  onFieldEdit?: () => void;
}

export function StepGoalClarification({ goal, onNext, onBack, initialValue, error, onFieldEdit }: Props) {
  const [text, setText] = useState(initialValue ?? "");
  const goalLabel = goal === "fat_loss" ? "減脂" : "增肌";

  useEffect(() => {
    setText(initialValue ?? "");
  }, [initialValue]);

  return (
    <div className="sp-onboarding-step">
      <div className="sp-onboarding-copy">
        <div className="sp-onboarding-kicker">選填 · 補充教練判斷</div>
        <h2>
          還有什麼需要注意？
        </h2>
        <p>
          你選了「{goalLabel}」。如果有特別在意的事，可以在這裡補充。沒有的話直接跳過。
        </p>
      </div>

      <div className="sp-onboarding-field-card">
        <label className="sp-onboarding-field-label" htmlFor="goal-clarification">
          目標補充
        </label>
        <textarea
          id="goal-clarification"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onFieldEdit?.();
          }}
          placeholder="例如：減脂不掉肌肉、不想影響重訓表現..."
          rows={3}
          className="sp-onboarding-textarea"
        />
      </div>

      <div className="sp-onboarding-helper-row">
        <span>減脂不掉肌肉</span>
        <span>不想影響重訓表現</span>
      </div>

      {error ? (
        <p className="sp-onboarding-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sp-onboarding-actions">
        <button type="button" className="sp-onboarding-secondary" onClick={onBack}>
          上一步
        </button>
        <button
          type="button"
          onClick={() => onNext(text.trim() || undefined)}
          className="sp-onboarding-primary"
        >
          {text.trim() ? "下一步" : "跳過"}
        </button>
      </div>
    </div>
  );
}
