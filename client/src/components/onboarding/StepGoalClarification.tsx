import { useState } from "react";

interface Props {
  goal: "fat_loss" | "muscle_gain";
  onNext: (clarification?: string) => void;
  onBack: () => void;
}

export function StepGoalClarification({ goal, onNext, onBack }: Props) {
  const [text, setText] = useState("");
  const goalLabel = goal === "fat_loss" ? "減脂" : "增肌";

  return (
    <div className="flex min-h-screen flex-col justify-center p-8" style={{ background: "var(--bg)" }}>
      <div className="mb-3 text-xs font-bold tracking-widest uppercase" style={{ color: "var(--orange)", letterSpacing: "0.2em" }}>
        STEP 2 / 6
      </div>
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
        有什麼想補充的嗎？
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-2)" }}>
        你選了「{goalLabel}」。如果有特別在意的事，可以在這裡補充。沒有的話直接跳過。
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例如：不想影響重訓表現、想慢慢減不要太激進..."
        rows={3}
        className="mb-6 w-full rounded-xl p-4 text-sm"
        style={{
          background: "var(--bg-raised)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          resize: "none",
        }}
      />

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="rounded-xl px-5 py-3 text-sm font-medium"
          style={{ color: "var(--text-2)", border: "1px solid var(--border)" }}
        >
          上一步
        </button>
        <button
          onClick={() => onNext(text.trim() || undefined)}
          className="flex-1 rounded-xl py-3 text-sm font-bold"
          style={{ background: "var(--orange)", color: "#000" }}
        >
          {text.trim() ? "下一步" : "跳過"}
        </button>
      </div>
    </div>
  );
}
