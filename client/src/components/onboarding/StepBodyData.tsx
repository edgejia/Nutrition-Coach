import { useEffect, useState } from "react";
import type { IntakeData, OnboardingField } from "../../types.js";

interface Props {
  onNext: (data: { sex: "male" | "female"; age: number; heightCm: number; weightKg: number }) => void;
  onBack: () => void;
  initialData?: Partial<IntakeData>;
  errors?: Partial<Record<OnboardingField, string>>;
  onFieldEdit?: (field: OnboardingField) => void;
}

export function StepBodyData({ onNext, onBack, initialData, errors, onFieldEdit }: Props) {
  const [sex, setSex] = useState<"male" | "female" | null>(initialData?.sex ?? null);
  const [age, setAge] = useState(initialData?.age?.toString() ?? "");
  const [height, setHeight] = useState(initialData?.heightCm?.toString() ?? "");
  const [weight, setWeight] = useState(initialData?.weightKg?.toString() ?? "");

  useEffect(() => {
    setSex(initialData?.sex ?? null);
    setAge(initialData?.age?.toString() ?? "");
    setHeight(initialData?.heightCm?.toString() ?? "");
    setWeight(initialData?.weightKg?.toString() ?? "");
  }, [initialData]);

  const canProceed = sex && age && height && weight &&
    Number(age) > 0 && Number(height) > 0 && Number(weight) > 0;

  function handleNext() {
    if (!canProceed || !sex) return;
    onNext({ sex, age: Number(age), heightCm: Number(height), weightKg: Number(weight) });
  }

  return (
    <div className="sp-onboarding-step">
      <div className="sp-onboarding-copy">
        <h2>
          基本身體數據
        </h2>
        <p>
          教練需要這些資料來計算你的營養目標。
        </p>
      </div>

      <div className="sp-onboarding-field-group">
        <label className="sp-onboarding-field-label">性別</label>
        <div className="sp-onboarding-segmented">
          {(["male", "female"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSex(s);
                onFieldEdit?.("sex");
              }}
              aria-pressed={sex === s}
            >
              {s === "male" ? "男" : "女"}
            </button>
          ))}
        </div>
        {errors?.sex ? (
          <p className="sp-onboarding-error" role="alert">
            {errors.sex}
          </p>
        ) : null}
      </div>

      {[
        { key: "age" as const, label: "年齡", value: age, setter: setAge, unit: "歲", placeholder: "25" },
        { key: "heightCm" as const, label: "身高", value: height, setter: setHeight, unit: "cm", placeholder: "175" },
        { key: "weightKg" as const, label: "體重", value: weight, setter: setWeight, unit: "kg", placeholder: "70" },
      ].map(({ key, label, value, setter, unit, placeholder }) => (
        <div className="sp-onboarding-field-group" key={key}>
          <label className="sp-onboarding-field-label" htmlFor={`onboarding-${key}`}>{label}</label>
          <div className="sp-onboarding-input-row">
            <div className="sp-onboarding-input-card">
              <input
                id={`onboarding-${key}`}
                type="number"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setter(e.target.value);
                  onFieldEdit?.(key);
                }}
                placeholder={placeholder}
                className="sp-onboarding-input"
              />
            </div>
            <span className="sp-onboarding-unit">{unit}</span>
          </div>
          {errors?.[key] ? (
            <p className="sp-onboarding-error" role="alert">
              {errors[key]}
            </p>
          ) : null}
        </div>
      ))}

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
