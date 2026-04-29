import { useEffect, useState } from "react";
import { SketchBox, SketchButton, SketchPill } from "../SketchPrimitives.js";
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
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 p-4">
      <SketchPill className="self-start">
        STEP 3 / 6
      </SketchPill>
      <div>
        <h2 className="sk-heading text-2xl">
          基本身體數據
        </h2>
        <p className="sk-body mt-2 text-sm" style={{ color: "var(--sk-ink-soft)" }}>
          教練需要這些資料來計算你的營養目標。
        </p>
      </div>

      {/* Sex */}
      <div>
        <label className="sk-body mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--sk-ink-soft)" }}>性別</label>
        <div className="flex gap-2">
          {(["male", "female"] as const).map((s) => (
            <SketchButton
              key={s}
              onClick={() => {
                setSex(s);
                onFieldEdit?.("sex");
              }}
              aria-pressed={sex === s}
              className="flex-1"
              variant={sex === s ? "accent" : "default"}
            >
              {s === "male" ? "男" : "女"}
            </SketchButton>
          ))}
        </div>
        {errors?.sex ? (
          <p className="sk-body mt-2 text-sm" role="alert" style={{ color: "var(--sk-accent)" }}>
            {errors.sex}
          </p>
        ) : null}
      </div>

      {/* Age, Height, Weight */}
      {[
        { key: "age" as const, label: "年齡", value: age, setter: setAge, unit: "歲", placeholder: "25" },
        { key: "heightCm" as const, label: "身高", value: height, setter: setHeight, unit: "cm", placeholder: "175" },
        { key: "weightKg" as const, label: "體重", value: weight, setter: setWeight, unit: "kg", placeholder: "70" },
      ].map(({ key, label, value, setter, unit, placeholder }) => (
        <div key={key}>
          <label className="sk-body mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--sk-ink-soft)" }}>{label}</label>
          <div className="flex items-center gap-2">
            <SketchBox className="flex flex-1 items-center px-3 py-2">
              <input
                type="number"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setter(e.target.value);
                  onFieldEdit?.(key);
                }}
                placeholder={placeholder}
                className="sk-body min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--sk-ink)" }}
              />
            </SketchBox>
            <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>{unit}</span>
          </div>
          {errors?.[key] ? (
            <p className="sk-body mt-2 text-sm" role="alert" style={{ color: "var(--sk-accent)" }}>
              {errors[key]}
            </p>
          ) : null}
        </div>
      ))}

      <div className="mt-4 flex gap-3">
        <SketchButton onClick={onBack}>
          上一步
        </SketchButton>
        <SketchButton
          onClick={handleNext}
          disabled={!canProceed}
          className="flex-1"
          variant="accent"
        >
          下一步
        </SketchButton>
      </div>
    </div>
  );
}
