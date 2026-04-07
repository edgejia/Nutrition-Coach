import { useState } from "react";

interface Props {
  onNext: (data: { activityLevel: string; trainingFrequency: string; allergies?: string }) => void;
  onBack: () => void;
}

const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "久坐" },
  { value: "light", label: "輕度活動" },
  { value: "moderate", label: "中度活動" },
  { value: "active", label: "積極活動" },
  { value: "very_active", label: "高度活動" },
];

const TRAINING_OPTIONS = [
  { value: "none", label: "不訓練" },
  { value: "1_2", label: "1-2 次/週" },
  { value: "3_4", label: "3-4 次/週" },
  { value: "5_plus", label: "5+ 次/週" },
];

export function StepLifestyle({ onNext, onBack }: Props) {
  const [activity, setActivity] = useState("");
  const [training, setTraining] = useState("");
  const [allergies, setAllergies] = useState("");

  const canProceed = activity && training;

  return (
    <div className="flex min-h-screen flex-col justify-center p-8" style={{ background: "var(--bg)" }}>
      <div className="mb-3 text-xs font-bold tracking-widest uppercase" style={{ color: "var(--orange)", letterSpacing: "0.2em" }}>
        STEP 4 / 6
      </div>
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
        生活與訓練習慣
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-2)" }}>
        這會影響你的每日消耗量估算。
      </p>

      {/* Activity Level */}
      <div className="mb-5">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>日常活動量</label>
        <div className="flex flex-wrap gap-2">
          {ACTIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActivity(opt.value)}
              className="rounded-lg px-4 py-2 text-sm"
              style={{
                background: activity === opt.value ? "var(--orange)" : "var(--bg-raised)",
                color: activity === opt.value ? "#000" : "var(--text)",
                border: `1px solid ${activity === opt.value ? "var(--orange)" : "var(--border)"}`,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Training Frequency */}
      <div className="mb-5">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>訓練頻率</label>
        <div className="flex flex-wrap gap-2">
          {TRAINING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTraining(opt.value)}
              className="rounded-lg px-4 py-2 text-sm"
              style={{
                background: training === opt.value ? "var(--orange)" : "var(--bg-raised)",
                color: training === opt.value ? "#000" : "var(--text)",
                border: `1px solid ${training === opt.value ? "var(--orange)" : "var(--border)"}`,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Allergies */}
      <div className="mb-6">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-2)" }}>過敏/飲食限制（選填）</label>
        <input
          type="text"
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          placeholder="例如：花生、乳糖不耐、素食..."
          className="w-full rounded-lg px-4 py-3 text-sm"
          style={{ background: "var(--bg-raised)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="rounded-xl px-5 py-3 text-sm font-medium" style={{ color: "var(--text-2)", border: "1px solid var(--border)" }}>
          上一步
        </button>
        <button
          onClick={() => onNext({ activityLevel: activity, trainingFrequency: training, allergies: allergies.trim() || undefined })}
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
