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
    <div className="sp-onboarding-step">
      <div className="sp-onboarding-copy">
        <div className="sp-onboarding-kicker">選填 · 提高精準度</div>
        <h2>
          進階指標
        </h2>
        <p>
          如果你有體脂率或 TDEE 的數據，教練可以算得更精準。沒有的話可以直接跳過。
        </p>
      </div>

      <div className="sp-onboarding-field-group">
        <label className="sp-onboarding-field-label" htmlFor="onboarding-body-fat">體脂率 · 選填</label>
        <div className="sp-onboarding-input-row">
          <div className="sp-onboarding-input-card">
            <input
              id="onboarding-body-fat"
              type="number"
              inputMode="decimal"
              value={bodyFat}
              onChange={(e) => {
                setBodyFat(e.target.value);
                onFieldEdit?.("bodyFatPercent");
              }}
              placeholder="20"
              className="sp-onboarding-input"
            />
          </div>
          <span className="sp-onboarding-unit">%</span>
        </div>
        {errors?.bodyFatPercent ? (
          <p className="sp-onboarding-error" role="alert">
            {errors.bodyFatPercent}
          </p>
        ) : null}
      </div>

      <div className="sp-onboarding-field-group">
        <label className="sp-onboarding-field-label" htmlFor="onboarding-tdee">TDEE · 選填</label>
        <div className="sp-onboarding-input-row">
          <div className="sp-onboarding-input-card">
            <input
              id="onboarding-tdee"
              type="number"
              inputMode="numeric"
              value={tdee}
              onChange={(e) => {
                setTdee(e.target.value);
                onFieldEdit?.("tdee");
              }}
              placeholder="2200"
              className="sp-onboarding-input"
            />
          </div>
          <span className="sp-onboarding-unit">kcal</span>
        </div>
        {errors?.tdee ? (
          <p className="sp-onboarding-error" role="alert">
            {errors.tdee}
          </p>
        ) : null}
      </div>

      <div className="sp-onboarding-field-group">
        <label className="sp-onboarding-field-label" htmlFor="onboarding-advanced-notes">其他備註（選填）</label>
        <div className="sp-onboarding-input-card">
          <input
            id="onboarding-advanced-notes"
            type="text"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              onFieldEdit?.("advancedNotes");
            }}
            placeholder="任何你覺得教練該知道的事..."
            className="sp-onboarding-input"
          />
        </div>
        {errors?.advancedNotes ? (
          <p className="sp-onboarding-error" role="alert">
            {errors.advancedNotes}
          </p>
        ) : null}
      </div>

      <div className="sp-onboarding-note">
        留空時會用身高、體重、年齡和活動量估算。
      </div>

      <div className="sp-onboarding-actions">
        <button type="button" className="sp-onboarding-secondary" onClick={onBack}>
          上一步
        </button>
        <button
          type="button"
          onClick={hasData ? handleNext : onSkip}
          className="sp-onboarding-primary"
        >
          {hasData ? "下一步" : "跳過，開始分析"}
        </button>
      </div>
    </div>
  );
}
