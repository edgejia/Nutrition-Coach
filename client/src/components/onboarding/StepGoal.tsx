import { SketchBox, SketchButton, SketchPill } from "../SketchPrimitives.js";

interface Props {
  onSelect: (goal: "fat_loss" | "muscle_gain") => void;
  error?: string;
}

export function StepGoal({ onSelect, error }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 p-4">
      <SketchPill className="self-start">
        STEP 1 / 6
      </SketchPill>
      <div>
        <h2 className="sk-heading text-2xl">
        你的目標是什麼？
        </h2>
        <p className="sk-body mt-2 text-sm" style={{ color: "var(--sk-ink-soft)" }}>
          選擇一個主要方向，教練會根據這個目標為你規劃。
        </p>
      </div>

      {error ? (
        <SketchBox className="p-4" role="alert" style={{ background: "var(--sk-accent-soft)" }}>
          <div className="sk-body mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--sk-accent)" }}>
            需要重新選擇
          </div>
          <p className="sk-body text-sm font-semibold">
            {error}
          </p>
        </SketchBox>
      ) : null}

      <div className="space-y-3">
        <SketchButton
          onClick={() => onSelect("fat_loss")}
          className="w-full justify-between rounded-lg px-5 py-4 text-left"
          variant="accent"
        >
          <div>
            <div className="sk-heading mb-1 text-xl">
              減脂 · FAT LOSS
            </div>
            <div className="sk-body text-sm">
              降低體脂，維持肌肉量
            </div>
          </div>
          <span aria-hidden="true">→</span>
        </SketchButton>

        <SketchButton
          onClick={() => onSelect("muscle_gain")}
          className="w-full justify-between rounded-lg px-5 py-4 text-left"
        >
          <div>
            <div className="sk-heading mb-1 text-xl">
              增肌 · MUSCLE GAIN
            </div>
            <div className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
              增加肌肉，熱量盈餘策略
            </div>
          </div>
          <span aria-hidden="true">→</span>
        </SketchButton>
      </div>
    </div>
  );
}
