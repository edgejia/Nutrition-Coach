import { useEffect, useState } from "react";
import { SketchBox, SketchButton, SketchPill } from "../SketchPrimitives.js";
import type { IntakeData, OnboardingField } from "../../types.js";

interface Props {
  onNext: (data: { bodyFatPercent?: number; tdee?: number; advancedNotes?: string }) => void;
  onSkip: () => void;
  onBack: () => void;
  initialData?: Partial<IntakeData>;
  errors?: Partial<Record<OnboardingField, string>>;
  onFieldEdit?: (field: OnboardingField) => void;
}

export function StepAdvancedMetrics({ onNext, onSkip, onBack, initialData, errors, onFieldEdit }: Props) {
  const [bodyFat, setBodyFat] = useState(initialData?.bodyFatPercent?.toString() ?? "");
  const [tdee, setTdee] = useState(initialData?.tdee?.toString() ?? "");
  const [notes, setNotes] = useState(initialData?.advancedNotes ?? "");

  useEffect(() => {
    setBodyFat(initialData?.bodyFatPercent?.toString() ?? "");
    setTdee(initialData?.tdee?.toString() ?? "");
    setNotes(initialData?.advancedNotes ?? "");
  }, [initialData]);

  const hasData = bodyFat || tdee || notes.trim();

  function handleNext() {
    onNext({
      bodyFatPercent: bodyFat ? Number(bodyFat) : undefined,
      tdee: tdee ? Number(tdee) : undefined,
      advancedNotes: notes.trim() || undefined,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 p-4">
      <SketchPill className="self-start">
        STEP 5 / 6
      </SketchPill>
      <div>
        <h2 className="sk-heading text-2xl">
          進階指標
        </h2>
        <p className="sk-body mt-2 text-sm" style={{ color: "var(--sk-ink-soft)" }}>
          如果你有體脂率或 TDEE 的數據，教練可以算得更精準。沒有的話可以直接跳過。
        </p>
      </div>

      <div>
        <label className="sk-body mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--sk-ink-soft)" }}>體脂率</label>
        <div className="flex items-center gap-2">
          <SketchBox className="flex flex-1 items-center px-3 py-2">
            <input
              type="number"
              inputMode="decimal"
              value={bodyFat}
              onChange={(e) => {
                setBodyFat(e.target.value);
                onFieldEdit?.("bodyFatPercent");
              }}
              placeholder="20"
              className="sk-body min-w-0 flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--sk-ink)" }}
            />
          </SketchBox>
          <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>%</span>
        </div>
        {errors?.bodyFatPercent ? (
          <p className="sk-body mt-2 text-sm" role="alert" style={{ color: "var(--sk-accent)" }}>
            {errors.bodyFatPercent}
          </p>
        ) : null}
      </div>

      <div>
        <label className="sk-body mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--sk-ink-soft)" }}>TDEE</label>
        <div className="flex items-center gap-2">
          <SketchBox className="flex flex-1 items-center px-3 py-2">
            <input
              type="number"
              inputMode="numeric"
              value={tdee}
              onChange={(e) => {
                setTdee(e.target.value);
                onFieldEdit?.("tdee");
              }}
              placeholder="2200"
              className="sk-body min-w-0 flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--sk-ink)" }}
            />
          </SketchBox>
          <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>kcal</span>
        </div>
        {errors?.tdee ? (
          <p className="sk-body mt-2 text-sm" role="alert" style={{ color: "var(--sk-accent)" }}>
            {errors.tdee}
          </p>
        ) : null}
      </div>

      <div>
        <label className="sk-body mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--sk-ink-soft)" }}>其他備註（選填）</label>
        <SketchBox className="px-3 py-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              onFieldEdit?.("advancedNotes");
            }}
            placeholder="任何你覺得教練該知道的事..."
            className="sk-body w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--sk-ink)" }}
          />
        </SketchBox>
        {errors?.advancedNotes ? (
          <p className="sk-body mt-2 text-sm" role="alert" style={{ color: "var(--sk-accent)" }}>
            {errors.advancedNotes}
          </p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <SketchButton onClick={onBack}>
          上一步
        </SketchButton>
        <SketchButton
          onClick={hasData ? handleNext : onSkip}
          className="flex-1"
          variant="accent"
        >
          {hasData ? "下一步" : "跳過，開始分析"}
        </SketchButton>
      </div>
    </div>
  );
}
