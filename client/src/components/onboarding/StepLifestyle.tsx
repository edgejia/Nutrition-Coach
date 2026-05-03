import { useEffect, useState } from "react";
import type { IntakeData } from "../../types.js";
import type { OnboardingField } from "../../types.js";

type ActivityLevel = IntakeData["activityLevel"];
type TrainingFreq = IntakeData["trainingFrequency"];

interface Props {
  onNext: (data: { activityLevel: ActivityLevel; trainingFrequency: TrainingFreq; allergies?: string }) => void;
  onBack: () => void;
  initialData?: Partial<IntakeData>;
  errors?: Partial<Record<OnboardingField, string>>;
  onFieldEdit?: (field: OnboardingField) => void;
}

const ACTIVITY_OPTIONS: readonly { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "久坐" },
  { value: "light", label: "輕度活動" },
  { value: "moderate", label: "中度活動" },
  { value: "active", label: "積極活動" },
  { value: "very_active", label: "高度活動" },
];

const TRAINING_OPTIONS: readonly { value: TrainingFreq; label: string }[] = [
  { value: "none", label: "不訓練" },
  { value: "1_2", label: "1-2 次/週" },
  { value: "3_4", label: "3-4 次/週" },
  { value: "5_plus", label: "5+ 次/週" },
];

export function StepLifestyle({ onNext, onBack, initialData, errors, onFieldEdit }: Props) {
  const [activity, setActivity] = useState<ActivityLevel | "">(initialData?.activityLevel ?? "");
  const [training, setTraining] = useState<TrainingFreq | "">(initialData?.trainingFrequency ?? "");
  const [allergies, setAllergies] = useState(initialData?.allergies ?? "");

  useEffect(() => {
    setActivity(initialData?.activityLevel ?? "");
    setTraining(initialData?.trainingFrequency ?? "");
    setAllergies(initialData?.allergies ?? "");
  }, [initialData]);

  const canProceed = activity && training;

  function handleNext() {
    if (!activity || !training) return;
    onNext({ activityLevel: activity, trainingFrequency: training, allergies: allergies.trim() || undefined });
  }

  return (
    <div className="sp-onboarding-step">
      <div className="sp-onboarding-copy">
        <h2>
          生活與訓練習慣
        </h2>
        <p>
          這會影響你的每日消耗量估算。
        </p>
      </div>

      <div className="sp-onboarding-field-group">
        <label className="sp-onboarding-field-label">日常活動量</label>
        <div className="sp-onboarding-option-grid">
          {ACTIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setActivity(opt.value);
                onFieldEdit?.("activityLevel");
              }}
              aria-pressed={activity === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {errors?.activityLevel ? (
          <p className="sp-onboarding-error" role="alert">
            {errors.activityLevel}
          </p>
        ) : null}
      </div>

      <div className="sp-onboarding-field-group">
        <label className="sp-onboarding-field-label">訓練頻率</label>
        <div className="sp-onboarding-option-grid sp-onboarding-option-grid-compact">
          {TRAINING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setTraining(opt.value);
                onFieldEdit?.("trainingFrequency");
              }}
              aria-pressed={training === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {errors?.trainingFrequency ? (
          <p className="sp-onboarding-error" role="alert">
            {errors.trainingFrequency}
          </p>
        ) : null}
      </div>

      <div className="sp-onboarding-field-group">
        <label className="sp-onboarding-field-label" htmlFor="onboarding-allergies">過敏/飲食限制（選填）</label>
        <div className="sp-onboarding-input-card">
          <input
            id="onboarding-allergies"
            type="text"
            value={allergies}
            onChange={(e) => {
              setAllergies(e.target.value);
              onFieldEdit?.("allergies");
            }}
            placeholder="例如：花生、乳糖不耐、素食..."
            className="sp-onboarding-input"
          />
        </div>
        {errors?.allergies ? (
          <p className="sp-onboarding-error" role="alert">
            {errors.allergies}
          </p>
        ) : null}
      </div>

      <div className="sp-onboarding-actions">
        <button type="button" className="sp-onboarding-secondary" onClick={onBack}>
          上一步
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!canProceed}
          className="sp-onboarding-primary"
        >
          下一步
        </button>
      </div>
    </div>
  );
}
