import { useEffect, useState } from "react";
import { SketchBox, SketchButton, SketchPill } from "../SketchPrimitives.js";

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
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 p-4">
      <SketchPill className="self-start">
        STEP 2 / 6
      </SketchPill>
      <div>
        <h2 className="sk-heading text-2xl">
          有什麼想補充的嗎？
        </h2>
        <p className="sk-body mt-2 text-sm" style={{ color: "var(--sk-ink-soft)" }}>
          你選了「{goalLabel}」。如果有特別在意的事，可以在這裡補充。沒有的話直接跳過。
        </p>
      </div>

      <SketchBox className="p-3">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onFieldEdit?.();
          }}
          placeholder="例如：不想影響重訓表現、想慢慢減不要太激進..."
          rows={3}
          className="sk-body w-full resize-none bg-transparent p-1 text-sm outline-none"
          style={{ color: "var(--sk-ink)" }}
        />
      </SketchBox>

      {error ? (
        <p className="sk-body text-sm" role="alert" style={{ color: "var(--sk-accent)" }}>
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <SketchButton onClick={onBack}>
          上一步
        </SketchButton>
        <SketchButton
          onClick={() => onNext(text.trim() || undefined)}
          className="flex-1"
          variant="accent"
        >
          {text.trim() ? "下一步" : "跳過"}
        </SketchButton>
      </div>
    </div>
  );
}
