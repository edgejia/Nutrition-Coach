import { useState } from "react";

interface Props {
  onNext: (data: { sex: "male" | "female"; age: number; heightCm: number; weightKg: number }) => void;
  onBack: () => void;
}

export function StepBodyData({ onNext, onBack }: Props) {
  const [sex, setSex] = useState<"male" | "female" | null>(null);
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const canProceed = sex && age && height && weight &&
    Number(age) > 0 && Number(height) > 0 && Number(weight) > 0;

  function handleNext() {
    if (!canProceed || !sex) return;
    onNext({ sex, age: Number(age), heightCm: Number(height), weightKg: Number(weight) });
  }

  return (
    <div className="flex min-h-screen flex-col justify-center p-8" style={{ background: "var(--bg)" }}>
      <div className="mb-3 text-xs font-bold tracking-widest uppercase" style={{ color: "var(--orange)", letterSpacing: "0.2em" }}>
        STEP 3 / 6
      </div>
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
        基本身體數據
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-2)" }}>
        教練需要這些資料來計算你的營養目標。
      </p>

      {/* Sex */}
      <div className="mb-5">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>性別</label>
        <div className="flex gap-2">
          {(["male", "female"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSex(s)}
              className="flex-1 rounded-lg py-3 text-sm font-medium"
              style={{
                background: sex === s ? "var(--orange)" : "var(--bg-raised)",
                color: sex === s ? "#000" : "var(--text)",
                border: `1px solid ${sex === s ? "var(--orange)" : "var(--border)"}`,
              }}
            >
              {s === "male" ? "男" : "女"}
            </button>
          ))}
        </div>
      </div>

      {/* Age, Height, Weight */}
      {[
        { label: "年齡", value: age, setter: setAge, unit: "歲", placeholder: "25" },
        { label: "身高", value: height, setter: setHeight, unit: "cm", placeholder: "175" },
        { label: "體重", value: weight, setter: setWeight, unit: "kg", placeholder: "70" },
      ].map(({ label, value, setter, unit, placeholder }) => (
        <div key={label} className="mb-4">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>{label}</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={value}
              onChange={(e) => setter(e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded-lg px-4 py-3 text-sm"
              style={{ background: "var(--bg-raised)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
            <span className="text-sm" style={{ color: "var(--text-2)" }}>{unit}</span>
          </div>
        </div>
      ))}

      <div className="mt-4 flex gap-3">
        <button onClick={onBack} className="rounded-xl px-5 py-3 text-sm font-medium" style={{ color: "var(--text-2)", border: "1px solid var(--border)" }}>
          上一步
        </button>
        <button
          onClick={handleNext}
          disabled={!canProceed}
          className="flex-1 rounded-xl py-3 text-sm font-bold disabled:opacity-40"
          style={{ background: "var(--orange)", color: "#000" }}
        >
          下一步
        </button>
      </div>
    </div>
  );
}
