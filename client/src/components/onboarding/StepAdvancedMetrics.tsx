import { useEffect, useState } from "react";
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
    <div className="flex min-h-screen flex-col justify-center p-8" style={{ background: "var(--bg)" }}>
      <div className="mb-3 text-xs font-bold tracking-widest uppercase" style={{ color: "var(--orange)", letterSpacing: "0.2em" }}>
        STEP 5 / 6
      </div>
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
        進階指標
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-2)" }}>
        如果你有體脂率或 TDEE 的數據，教練可以算得更精準。沒有的話可以直接跳過。
      </p>

      <div className="mb-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>體脂率</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={bodyFat}
            onChange={(e) => {
              setBodyFat(e.target.value);
              onFieldEdit?.("bodyFatPercent");
            }}
            placeholder="20"
            className="flex-1 rounded-lg px-4 py-3 text-sm"
            style={{ background: "var(--bg-raised)", color: "var(--text)", border: "1px solid var(--border)" }}
          />
          <span className="text-sm" style={{ color: "var(--text-2)" }}>%</span>
        </div>
        {errors?.bodyFatPercent ? (
          <p className="mt-2 text-sm" style={{ color: "var(--orange)" }}>
            {errors.bodyFatPercent}
          </p>
        ) : null}
      </div>

      <div className="mb-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>TDEE</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={tdee}
            onChange={(e) => {
              setTdee(e.target.value);
              onFieldEdit?.("tdee");
            }}
            placeholder="2200"
            className="flex-1 rounded-lg px-4 py-3 text-sm"
            style={{ background: "var(--bg-raised)", color: "var(--text)", border: "1px solid var(--border)" }}
          />
          <span className="text-sm" style={{ color: "var(--text-2)" }}>kcal</span>
        </div>
        {errors?.tdee ? (
          <p className="mt-2 text-sm" style={{ color: "var(--orange)" }}>
            {errors.tdee}
          </p>
        ) : null}
      </div>

      <div className="mb-6">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>其他備註（選填）</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            onFieldEdit?.("advancedNotes");
          }}
          placeholder="任何你覺得教練該知道的事..."
          className="w-full rounded-lg px-4 py-3 text-sm"
          style={{ background: "var(--bg-raised)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        {errors?.advancedNotes ? (
          <p className="mt-2 text-sm" style={{ color: "var(--orange)" }}>
            {errors.advancedNotes}
          </p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="rounded-xl px-5 py-3 text-sm font-medium" style={{ color: "var(--text-2)", border: "1px solid var(--border)" }}>
          上一步
        </button>
        <button
          onClick={hasData ? handleNext : onSkip}
          className="flex-1 rounded-xl py-3 text-sm font-bold"
          style={{ background: "var(--orange)", color: "#000" }}
        >
          {hasData ? "下一步" : "跳過，開始分析"}
        </button>
      </div>
    </div>
  );
}
