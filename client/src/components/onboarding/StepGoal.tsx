interface Props {
  onSelect: (goal: "fat_loss" | "muscle_gain") => void;
  error?: string;
}

export function StepGoal({ onSelect, error }: Props) {
  return (
    <div className="flex min-h-screen flex-col justify-center p-8" style={{ background: "var(--bg)" }}>
      <div className="mb-3 text-xs font-bold tracking-widest uppercase" style={{ color: "var(--orange)", letterSpacing: "0.2em" }}>
        STEP 1 / 6
      </div>
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
        你的目標是什麼？
      </h2>
      <p className="mb-8 text-sm" style={{ color: "var(--text-2)" }}>
        選擇一個主要方向，教練會根據這個目標為你規劃。
      </p>

      {error ? (
        <div
          className="mb-5 rounded-xl px-4 py-3"
          role="alert"
          style={{
            background: "rgba(229,85,85,0.12)",
            border: "1px solid rgba(229,85,85,0.45)",
            color: "var(--text)",
          }}
        >
          <div className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--red)" }}>
            需要重新選擇
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {error}
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        <button
          onClick={() => onSelect("fat_loss")}
          className="flex w-full items-center justify-between rounded-xl p-5 text-left"
          style={{
            background: "linear-gradient(135deg, #0D1A0D, #0F2010)",
            border: "1px solid rgba(76,184,122,0.25)",
          }}
        >
          <div>
            <div className="mb-1 text-xl font-bold tracking-wide" style={{ fontFamily: "var(--font-display)", color: "var(--green)" }}>
              減脂 · FAT LOSS
            </div>
            <div className="text-sm" style={{ color: "var(--text-2)" }}>
              降低體脂，維持肌肉量
            </div>
          </div>
          <span style={{ color: "var(--green)", fontSize: 20 }}>→</span>
        </button>

        <button
          onClick={() => onSelect("muscle_gain")}
          className="flex w-full items-center justify-between rounded-xl p-5 text-left"
          style={{
            background: "linear-gradient(135deg, #100D1A, #181025)",
            border: "1px solid rgba(91,150,232,0.25)",
          }}
        >
          <div>
            <div className="mb-1 text-xl font-bold tracking-wide" style={{ fontFamily: "var(--font-display)", color: "var(--blue)" }}>
              增肌 · MUSCLE GAIN
            </div>
            <div className="text-sm" style={{ color: "var(--text-2)" }}>
              增加肌肉，熱量盈餘策略
            </div>
          </div>
          <span style={{ color: "var(--blue)", fontSize: 20 }}>→</span>
        </button>
      </div>
    </div>
  );
}
