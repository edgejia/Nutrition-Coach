import { useEffect, useState } from "react";
import { useStore } from "../../store.js";
import { submitIntake } from "../../api.js";
import {
  applyFieldEditRecovery,
  getAdvancedMetricsSkipData,
  getStepAdvanceOutcome,
  runSubmitAttempt,
} from "../../lib/onboarding-stepper-flow.js";
import { SportBoltIcon, SportFlameIcon } from "../SportIcons.js";
import type { IntakeData, IntakeResult, IntakeValidationIssue, OnboardingField, OnboardingStep } from "../../types.js";

type PartialIntake = Partial<IntakeData>;
type StepState = OnboardingStep | 6;
type BodyForm = { sex: IntakeData["sex"]; age: string; heightCm: string; weightKg: string };
type LifestyleForm = Pick<IntakeData, "activityLevel" | "trainingFrequency"> & Pick<Partial<IntakeData>, "allergies">;
type AdvancedForm = { bodyFatPercent: string; tdee: string; advancedNotes: string };
type StepIssue = Pick<IntakeValidationIssue, "message" | "field">;

interface OnboardingStepperPresentationProps {
  step: StepState;
  data: PartialIntake;
  validationIssues?: IntakeValidationIssue[];
  loading: boolean;
  transportError: string | null;
  result: IntakeResult | null;
  onGoalSelect: (goal: IntakeData["goal"]) => void;
  onGoalClarificationNext: (goalClarification?: string) => void;
  onBodyDataNext: (bodyData: Pick<IntakeData, "sex" | "age" | "heightCm" | "weightKg">) => void;
  onLifestyleNext: (
    lifestyle: Pick<IntakeData, "activityLevel" | "trainingFrequency"> & Pick<Partial<IntakeData>, "allergies">,
  ) => void;
  onAdvancedMetricsNext: (metrics: Pick<Partial<IntakeData>, "bodyFatPercent" | "tdee" | "advancedNotes">) => void;
  onAdvancedMetricsSkip: () => void;
  onBack: (nextStep: OnboardingStep) => void;
  onStart: () => void;
  onRetry: () => void;
  onFieldEdit: (field: OnboardingField) => void;
}

function mergeStepIssues(
  previous: IntakeValidationIssue[],
  step: OnboardingStep,
  nextStepIssues: IntakeValidationIssue[],
) {
  return [...previous.filter((issue) => issue.step !== step), ...nextStepIssues];
}

function SpStepperBar({ step, total = 6 }: { step: number; total?: number }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 8,
      padding: "0 18px",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="sp-label">第 {String(step).padStart(2, "0")} 步 / 共 {String(total).padStart(2, "0")} 步</div>
      </div>
      <div className="sp-ticks">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < step ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}

function SpObActions({ onBack, onNext, nextLabel = "繼續 →" }: { onBack?: () => void; onNext?: () => void; nextLabel?: string }) {
  return (
    <div className="sp-ob-actions">
      <button type="button" className="sp-btn sp-btn-ghost" onClick={onBack}>← 上一步</button>
      <button type="button" className="sp-btn sp-btn-primary" onClick={onNext}>{nextLabel}</button>
    </div>
  );
}

function SpNumberWheel({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  compact = false,
  minimal = false,
  hideHeader = false,
  onChange,
}: {
  label: string;
  value: string | number | undefined;
  unit: string;
  min: number;
  max: number;
  step?: number;
  compact?: boolean;
  minimal?: boolean;
  hideHeader?: boolean;
  onChange?: (value: string) => void;
}) {
  const current = Number(value || 0);
  const clamp = (n: number) => String(Math.min(max, Math.max(min, n)));
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startValue = current;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const DIRECTION = -1;
      const diff = moveEvent.clientX - startX;
      const slots = Math.trunc(diff / 26) * DIRECTION;
      if (slots !== 0) onChange?.(clamp(startValue + slots * step));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const offsets = minimal ? [-1, 0, 1] : [-2, -1, 0, 1, 2];
  const items = offsets.map((offset) => {
    const next = Math.min(max, Math.max(min, current + offset * step));
    const key = `${label}-${offset}-${next}`;
    const className = offset === 0 ? "sp-num-wheel-item active" : Math.abs(offset) === 1 ? "sp-num-wheel-item near" : "sp-num-wheel-item";
    return <span key={key} className={className}>{next}</span>;
  });
  return (
    <div>
      {hideHeader ? null : (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <span className="sp-zh" style={{ fontSize: 12, color: "var(--sp-ink-2)" }}>{label}</span>
          <span className="sp-label" style={{ fontSize: 9 }}>{unit}</span>
        </div>
      )}
      <div className={`${compact ? "sp-num-wheel compact" : "sp-num-wheel"}${minimal ? " minimal" : ""}`}>
        <div className="sp-num-wheel-track" onPointerDown={startDrag} role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={current}>
          {items}
        </div>
      </div>
    </div>
  );
}

function SpObHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sp-header" style={{ paddingBottom: 4 }}>
      <div style={{ width: 38 }} />
      <div className="sp-ob-brand">
        <SportBoltIcon size={14} />
        <span className="sp-ob-brand-text">ChatGPT - Gain <b>ProTein</b></span>
      </div>
      {right ?? <div style={{ width: 38 }} />}
    </header>
  );
}

function SpValidationIssues({ issues }: { issues?: StepIssue[] }) {
  if (!issues?.length) return null;

  return (
    <section
      className="sp-card-flat"
      style={{
        border: "1px solid rgba(255,77,77,.34)",
        background: "rgba(255,77,77,.08)",
        color: "#ffb3b3",
      }}
    >
      <div className="sp-label" style={{ color: "#ffb3b3", marginBottom: 8 }}>需要修正</div>
      <div style={{ display: "grid", gap: 6 }}>
        {issues.map((issue) => (
          <p key={`${issue.field}-${issue.message}`} className="sp-zh" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
            {issue.message}
          </p>
        ))}
      </div>
    </section>
  );
}

function SpOptionalField({
  title,
  sub,
  unit,
  enabled,
  onAdd,
  onRemove,
  children,
}: {
  title: string;
  sub: string;
  unit?: string;
  enabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return (
      <section className="sp-card sp-ob-metric-card">
        <div className="sp-optional-head">
          <div className="sp-optional-copy">
            <div className="sp-zh" style={{ fontSize: 14, fontWeight: 800, color: "var(--sp-ink)" }}>{title}</div>
            <div className="sp-zh" style={{ fontSize: 11, color: "var(--sp-ink-3)", marginTop: 4, lineHeight: 1.45 }}>{sub}</div>
          </div>
          <button
            type="button"
            onClick={onAdd}
            style={{
              flex: "0 0 auto",
              minWidth: 56,
              minHeight: 32,
              padding: "0 14px",
              border: "1px solid var(--sp-lime-line)",
              background: "var(--sp-lime-soft)",
              color: "var(--sp-lime)",
              borderRadius: "var(--sp-r-pill)",
              fontWeight: 800,
              fontFamily: "var(--sp-font-zh)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            加入
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="sp-card sp-ob-metric-card">
      <div className="sp-optional-head">
        <div className="sp-optional-copy" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="sp-zh" style={{ fontSize: 14, fontWeight: 800, color: "var(--sp-ink)" }}>{title}</span>
          {unit ? <span className="sp-label" style={{ fontSize: 9 }}>{unit}</span> : null}
        </div>
        <button
          type="button"
          onClick={onRemove}
          style={{
            flex: "0 0 auto",
            background: "transparent",
            border: 0,
            color: "var(--sp-ink-3)",
            fontFamily: "var(--sp-font-mono)",
            fontSize: 10,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            cursor: "pointer",
            padding: 4,
          }}
          aria-label={`移除 ${title}`}
        >
          移除
        </button>
      </div>
      <div className="sp-optional-body">{children}</div>
    </section>
  );
}

function SpStepGoal({
  value,
  issues,
  onSelect,
}: {
  value?: string;
  issues?: StepIssue[];
  onSelect?: (goal: IntakeData["goal"]) => void;
}) {
  const choices = [
    { key: "fat_loss", zh: "減脂", desc: "降低體脂，維持肌肉量", accent: "var(--sp-lime)" },
    { key: "muscle_gain", zh: "增肌", desc: "熱量盈餘，蛋白優先", accent: "var(--sp-cyan)" },
    { key: "maintain", zh: "維持", desc: "穩定體態，習慣養成", accent: "var(--sp-amber)" },
  ];
  return (
    <div className="sp-screen">
      <SpObHeader />
      <SpStepperBar step={1} />
      <main className="sp-scroll" style={{ paddingTop: 18 }}>
        <div style={{ padding: "0 4px 4px" }}>
          <h1 className="sp-zh" style={{ fontSize: 31, lineHeight: 1.12, margin: 0, color: "var(--sp-ink)", fontWeight: 900 }}>
            你的主要<br/>目標是什麼？
          </h1>
          <p className="sp-zh" style={{ fontSize: 13, color: "var(--sp-ink-2)", margin: "10px 0 0", lineHeight: 1.55 }}>
            選一個主要方向，教練會以這個為基準規劃熱量與蛋白配比。之後可以調整。
          </p>
        </div>
        <SpValidationIssues issues={issues} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {choices.map((c) => {
            const on = value === c.key;
            return (
              <button key={c.key} type="button" onClick={() => onSelect?.(c.key as IntakeData["goal"])}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "16px 16px",
                  background: on ? "var(--sp-surface-2)" : "var(--sp-surface)",
                  border: on ? `1px solid ${c.accent}` : "1px solid var(--sp-line)",
                  borderRadius: "var(--sp-r-md)",
                  textAlign: "left", cursor: "pointer", color: "inherit",
                  position: "relative",
                }}>
                <div style={{
                  width: 8, height: 56, borderRadius: 999,
                  background: on ? c.accent : "var(--sp-surface-3)",
                  boxShadow: on ? `0 0 18px ${c.accent}66` : "none",
                  flexShrink: 0,
                }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="sp-zh" style={{ fontSize: 20, lineHeight: 1.2, fontWeight: 900, color: on ? c.accent : "var(--sp-ink)" }}>{c.zh}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <span className="sp-zh" style={{ fontSize: 12, color: "var(--sp-ink-2)" }}>{c.desc}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function SpStepGoalClarification({
  goal,
  value,
  issues,
  onChange,
  onNext,
  onBack,
}: {
  goal?: string;
  value?: string;
  issues?: StepIssue[];
  onChange?: (value: string) => void;
  onNext?: () => void;
  onBack?: () => void;
}) {
  const goalLabel = goal === "muscle_gain" ? "增肌" : goal === "maintain" ? "維持" : "減脂";
  const text = value ?? "";
  const quickNotes = [
    "不想影響重訓表現",
    "想慢慢減，不要太激進",
    "外食很多，需要好執行",
  ];
  return (
    <div className="sp-screen">
      <SpObHeader />
      <SpStepperBar step={2} />
      <main className="sp-scroll sp-scroll-actions" style={{ paddingTop: 18 }}>
        <div style={{ padding: "0 4px" }}>
          <div className="sp-label" style={{ color: "var(--sp-cyan)" }}>選填 · 補充教練判斷</div>
          <h1 className="sp-zh" style={{ fontSize: 30, lineHeight: 1.12, margin: "8px 0 0", color: "var(--sp-ink)", fontWeight: 900 }}>
            還有什麼<br/>需要注意？
          </h1>
          <p className="sp-zh" style={{ fontSize: 13, color: "var(--sp-ink-2)", margin: "10px 0 0", lineHeight: 1.55 }}>
            你選了「{goalLabel}」。如果有特別在意的事，先告訴教練；沒有可以直接跳過。
          </p>
        </div>

        <SpValidationIssues issues={issues} />

        <section className="sp-card" style={{ padding: 14 }}>
          <textarea
            value={text}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder="例如：不想影響重訓表現、想慢慢減不要太激進..."
            rows={4}
            style={{
              width: "100%",
              resize: "none",
              background: "transparent",
              border: 0,
              outline: "none",
              color: "var(--sp-ink)",
              fontFamily: "var(--sp-font-zh)",
              fontSize: 13,
              lineHeight: 1.55,
              padding: 0,
            }}
          />
        </section>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {quickNotes.map((note) => (
            <button
              key={note}
              type="button"
              className="sp-chip"
              onClick={() => onChange?.(text ? `${text}、${note}` : note)}
              style={{ cursor: "pointer" }}
            >
              <span className="sp-chip-zh">{note}</span>
            </button>
          ))}
        </div>
      </main>
      <SpObActions onBack={onBack} onNext={onNext} nextLabel={text.trim() ? "繼續 →" : "略過 →"} />
    </div>
  );
}

function SpStepBody({
  value,
  issues,
  onChange,
  onNext,
  onBack,
}: {
  value?: BodyForm;
  issues?: StepIssue[];
  onChange?: (value: BodyForm) => void;
  onNext?: () => void;
  onBack?: () => void;
}) {
  const v = {
    sex: value?.sex ?? "male",
    age: value?.age ?? "28",
    heightCm: value?.heightCm ?? "175",
    weightKg: value?.weightKg ?? "70",
  };
  const set = (k: keyof typeof v, val: string) => onChange?.({ ...v, [k]: val });
  return (
    <div className="sp-screen">
      <SpObHeader />
      <SpStepperBar step={3} />
      <main className="sp-scroll sp-scroll-actions" style={{ paddingTop: 18 }}>
        <div style={{ padding: "0 4px" }}>
          <h1 className="sp-zh" style={{ fontSize: 28, lineHeight: 1.18, margin: 0, color: "var(--sp-ink)", fontWeight: 900 }}>身體資料</h1>
          <p className="sp-zh" style={{ fontSize: 13, color: "var(--sp-ink-2)", margin: "8px 0 0", lineHeight: 1.55 }}>
            這些資料只用來算每日目標。
          </p>
        </div>

        <SpValidationIssues issues={issues} />

        <div>
          <div className="sp-label" style={{ marginBottom: 8 }}>性別</div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0,
            background: "var(--sp-surface)",
            border: "1px solid var(--sp-line)",
            borderRadius: "var(--sp-r-pill)",
            padding: 4,
          }}>
            {["male", "female"].map((s) => (
              <button key={s} type="button" onClick={() => set("sex", s as IntakeData["sex"])}
                style={{
                  padding: "10px 0",
                  background: v.sex === s ? "var(--sp-lime)" : "transparent",
                  color: v.sex === s ? "#0a0b0d" : "var(--sp-ink-2)",
                  border: 0, borderRadius: 999,
                  fontFamily: "var(--sp-font-mono)", fontSize: 11,
                  letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600,
                  cursor: "pointer",
                }}>
                {s === "male" ? "男" : "女"}
              </button>
            ))}
          </div>
        </div>

        <SpNumberWheel label="年齡" value={v.age} unit="歲" min={12} max={90} onChange={(val) => set("age", val)} />
        <SpNumberWheel label="身高" value={v.heightCm} unit="cm" min={120} max={220} onChange={(val) => set("heightCm", val)} />
        <SpNumberWheel label="體重" value={v.weightKg} unit="kg" min={35} max={180} onChange={(val) => set("weightKg", val)} />
      </main>
      <SpObActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function SpStepLifestyle({
  value,
  issues,
  onChange,
  onNext,
  onBack,
}: {
  value?: LifestyleForm;
  issues?: StepIssue[];
  onChange?: (value: LifestyleForm) => void;
  onNext?: () => void;
  onBack?: () => void;
}) {
  const v = {
    activityLevel: value?.activityLevel ?? "moderate",
    trainingFrequency: value?.trainingFrequency ?? "3_4",
    allergies: value?.allergies ?? "",
  };
  const set = (k: keyof typeof v, val: string) => onChange?.({ ...v, [k]: val });
  const activities = [
    { value: "sedentary", label: "久坐", detail: "辦公為主", level: 2 },
    { value: "light", label: "輕度活動", detail: "偶爾走動", level: 3 },
    { value: "moderate", label: "中度活動", detail: "一般活動", level: 4 },
    { value: "active", label: "積極活動", detail: "活動量高", level: 5 },
    { value: "very_active", label: "高度活動", detail: "接近運動員", level: 6 },
  ];
  const training = [
    { value: "none", label: "不訓練", detail: "0 次/週" },
    { value: "1_2", label: "1-2 次/週", detail: "輕量" },
    { value: "3_4", label: "3-4 次/週", detail: "基準" },
    { value: "5_plus", label: "5+ 次/週", detail: "高頻" },
  ];
  return (
    <div className="sp-screen">
      <SpObHeader />
      <SpStepperBar step={4} />
      <main className="sp-scroll sp-scroll-actions" style={{ paddingTop: 18 }}>
        <div style={{ padding: "0 4px" }}>
          <h1 className="sp-zh" style={{ fontSize: 30, lineHeight: 1.12, margin: 0, color: "var(--sp-ink)", fontWeight: 900 }}>
            你的日常<br/>活動量
          </h1>
          <p className="sp-zh" style={{ fontSize: 13, color: "var(--sp-ink-2)", margin: "10px 0 0", lineHeight: 1.55 }}>
            日常活動量和訓練頻率會影響每日消耗量估算。
          </p>
        </div>

        <SpValidationIssues issues={issues} />

        <section>
          <div className="sp-label" style={{ marginBottom: 8 }}>日常活動量</div>
          <div style={{ display: "grid", gap: 8 }}>
            {activities.map((item) => {
              const on = v.activityLevel === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => set("activityLevel", item.value as IntakeData["activityLevel"])}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "76px 1fr auto",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    background: on ? "var(--sp-surface-2)" : "var(--sp-surface)",
                    border: on ? "1px solid var(--sp-lime-line)" : "1px solid var(--sp-line)",
                    borderRadius: "var(--sp-r-md)",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span className="sp-zh" style={{ fontSize: 13, fontWeight: 700, color: "var(--sp-ink)" }}>{item.label}</span>
                  <span className="sp-ticks" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, i) => <i key={i} className={i < item.level ? "on" : ""} />)}
                  </span>
                  <span className="sp-label" style={{ fontSize: 8, color: on ? "var(--sp-lime)" : "var(--sp-ink-3)" }}>{item.detail}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="sp-label" style={{ marginBottom: 8 }}>訓練頻率</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {training.map((item) => {
              const on = v.trainingFrequency === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => set("trainingFrequency", item.value as IntakeData["trainingFrequency"])}
                  style={{
                    minHeight: 66,
                    padding: 12,
                    background: on ? "var(--sp-surface-2)" : "var(--sp-surface)",
                    border: on ? "1px solid var(--sp-lime-line)" : "1px solid var(--sp-line)",
                    borderRadius: "var(--sp-r-md)",
                    color: "var(--sp-ink)",
                    textAlign: "left",
                    cursor: "pointer",
                    boxShadow: on ? "inset 0 0 0 1px var(--sp-lime-line)" : "none",
                  }}
                >
                  <div className="sp-zh" style={{ fontSize: 13, fontWeight: 800, color: "var(--sp-ink)" }}>{item.label}</div>
                  <div className="sp-label" style={{ fontSize: 8, marginTop: 6, color: on ? "var(--sp-lime)" : "var(--sp-ink-3)" }}>{item.detail}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="sp-card-flat" style={{ border: "1px solid var(--sp-line)" }}>
          <div className="sp-label" style={{ marginBottom: 8 }}>過敏 / 飲食限制</div>
          <input
            type="text"
            value={v.allergies}
            onChange={(e) => set("allergies", e.target.value)}
            placeholder="例如：花生、乳糖不耐、素食..."
            style={{
              width: "100%",
              background: "transparent",
              border: 0,
              outline: "none",
              color: "var(--sp-ink)",
              fontFamily: "var(--sp-font-zh)",
              fontSize: 13,
            }}
          />
        </section>
      </main>
      <SpObActions onBack={onBack} onNext={onNext} />
    </div>
  );
}

function SpStepAdvancedMetrics({
  value,
  issues,
  onChange,
  onNext,
  onSkip,
  onBack,
}: {
  value?: AdvancedForm;
  issues?: StepIssue[];
  onChange?: (value: AdvancedForm) => void;
  onNext?: () => void;
  onSkip?: () => void;
  onBack?: () => void;
}) {
  const v = {
    bodyFatPercent: value?.bodyFatPercent ?? "",
    tdee: value?.tdee ?? "",
    advancedNotes: value?.advancedNotes ?? "",
  };
  const set = (k: keyof typeof v, val: string) => onChange?.({ ...v, [k]: val });
  const bfEnabled = v.bodyFatPercent !== "" && v.bodyFatPercent != null;
  const tdeeEnabled = v.tdee !== "" && v.tdee != null;
  const hasData = bfEnabled || tdeeEnabled || Boolean(v.advancedNotes?.trim());
  return (
    <div className="sp-screen">
      <SpObHeader />
      <SpStepperBar step={5} />
      <main className="sp-scroll sp-scroll-actions" style={{ paddingTop: 18 }}>
        <div style={{ padding: "0 4px" }}>
          <div className="sp-label" style={{ color: "var(--sp-cyan)" }}>選填 · 提高精準度</div>
          <h1 className="sp-zh" style={{ fontSize: 31, lineHeight: 1.12, margin: "8px 0 0", color: "var(--sp-ink)", fontWeight: 900, whiteSpace: "nowrap" }}>
            進階數據
          </h1>
          <p className="sp-zh" style={{ fontSize: 13, color: "var(--sp-ink-2)", margin: "10px 0 0", lineHeight: 1.55 }}>
            如果你有體脂率或 TDEE，教練可以算得更精準。沒有資料也可以跳過。
          </p>
        </div>

        <SpValidationIssues issues={issues} />

        <SpOptionalField
          title="體脂率"
          sub="選填 · 有 InBody 或量測資料再加入"
          unit="%"
          enabled={bfEnabled}
          onAdd={() => set("bodyFatPercent", "20")}
          onRemove={() => set("bodyFatPercent", "")}
        >
          <SpNumberWheel
            label="體脂率"
            value={v.bodyFatPercent || "20"}
            unit="%"
            min={5}
            max={45}
            compact={true}
            hideHeader={true}
            onChange={(val) => set("bodyFatPercent", val)}
          />
        </SpOptionalField>

        <SpOptionalField
          title="每日消耗"
          sub="選填 · 知道 TDEE 時再加入"
          unit="kcal"
          enabled={tdeeEnabled}
          onAdd={() => set("tdee", "2200")}
          onRemove={() => set("tdee", "")}
        >
          <SpNumberWheel
            label="每日消耗"
            value={v.tdee || "2200"}
            unit="kcal"
            min={1200}
            max={4200}
            step={50}
            compact={true}
            minimal={true}
            hideHeader={true}
            onChange={(val) => set("tdee", val)}
          />
        </SpOptionalField>

        <section className="sp-card-flat" style={{ border: "1px solid var(--sp-line)" }}>
          <div className="sp-label" style={{ marginBottom: 8 }}>其他備註 · 選填</div>
          <input
            type="text"
            value={v.advancedNotes}
            onChange={(e) => set("advancedNotes", e.target.value)}
            placeholder="任何你覺得教練該知道的事..."
            style={{
              width: "100%",
              background: "transparent",
              border: 0,
              outline: "none",
              color: "var(--sp-ink)",
              fontFamily: "var(--sp-font-zh)",
              fontSize: 13,
            }}
          />
        </section>

        <section className="sp-card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid var(--sp-lime-line)", display: "grid", placeItems: "center", color: "var(--sp-lime)" }}>
            <SportFlameIcon size={18} />
          </div>
          <div>
            <div className="sp-label" style={{ color: "var(--sp-lime)" }}>沒有資料也可以估算</div>
            <div className="sp-zh" style={{ fontSize: 12, color: "var(--sp-ink-2)", marginTop: 4, lineHeight: 1.45 }}>
              留空時會用身高、體重、年齡和活動量估算。
            </div>
          </div>
        </section>
      </main>
      <SpObActions onBack={onBack} onNext={hasData ? onNext : onSkip} nextLabel={hasData ? "繼續 →" : "略過 →"} />
    </div>
  );
}

function SpStepHandoff({
  loading,
  transportError,
  result,
  onStart,
  onRetry,
  onBack,
}: {
  loading: boolean;
  transportError: string | null;
  result: IntakeResult | null;
  onStart?: () => void;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  const targets = result?.dailyTargets ?? { calories: 2150, protein: 145, carbs: 240, fat: 65 };
  return (
    <div className="sp-screen">
      <SpObHeader />
      <SpStepperBar step={6} />
      <main className="sp-scroll sp-scroll-actions" style={{ paddingTop: 18 }}>
        <div style={{ padding: "0 4px" }}>
          <div className="sp-label" style={{ color: "var(--sp-lime)" }}>你的計畫已準備好</div>
          <h1 className="sp-zh" style={{ fontSize: 32, lineHeight: 1.12, margin: "8px 0 0", color: "var(--sp-ink)", fontWeight: 900, whiteSpace: "nowrap" }}>
            每日目標
          </h1>
        </div>

        <section className="sp-card-glow" style={{
          padding: 18,
          background: "linear-gradient(135deg, rgba(214,255,58,.10) 0%, rgba(20,21,25,1) 70%), var(--sp-surface)",
          borderColor: "var(--sp-lime-line)",
        }}>
          <div className="sp-label" style={{ color: "var(--sp-lime)" }}>每日熱量</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
            <span className="sp-display" style={{ fontSize: 72, color: "var(--sp-ink)" }}>{targets.calories.toLocaleString("en-US")}</span>
            <span className="sp-num" style={{ fontSize: 13, color: "var(--sp-ink-3)" }}>kcal</span>
          </div>
          <div className="sp-zh" style={{ fontSize: 12, color: "var(--sp-ink-2)", marginTop: 2 }}>
            根據減脂目標 · 中度活動 · TDEE −400
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { zh: "蛋白質", en: "protein", val: targets.protein, unit: "g", color: "var(--sp-lime)" },
            { zh: "碳水", en: "carbs", val: targets.carbs, unit: "g", color: "var(--sp-cyan)" },
            { zh: "脂肪", en: "fat", val: targets.fat, unit: "g", color: "var(--sp-amber)" },
          ].map(({ zh, en, val, unit, color }) => (
            <div key={en} style={{
              background: "var(--sp-surface)",
              border: "1px solid var(--sp-line)",
              borderRadius: "var(--sp-r-md)",
              padding: 14,
            }}>
              <div style={{ width: 22, height: 3, background: color, borderRadius: 2, marginBottom: 10 }} />
              <div className="sp-zh" style={{ fontSize: 11, color: "var(--sp-ink-2)" }}>{zh}</div>
              <div className="sp-label" style={{ fontSize: 8, marginTop: 1 }}>每日目標</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 8 }}>
                <span className="sp-display" style={{ fontSize: 30, color: "var(--sp-ink)" }}>{val}</span>
                <span className="sp-num" style={{ fontSize: 10, color: "var(--sp-ink-3)" }}>{unit}</span>
              </div>
            </div>
          ))}
        </section>

        <section className="sp-card" style={{
          borderLeft: "2px solid var(--sp-lime)",
          paddingLeft: 18,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <SportBoltIcon size={12} />
            <span className="sp-label" style={{ color: "var(--sp-lime)" }}>教練備註</span>
          </div>
          <p className="sp-zh" style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "var(--sp-ink)" }}>
            減脂期蛋白優先：每餐至少 30g。碳水多放在訓練日，脂肪維持基本量。
            前兩週體重每週掉 0.5–1% 是健康的節奏。
          </p>
        </section>

        {transportError ? (
          <section className="sp-card" style={{ borderColor: "rgba(255,77,77,.32)", color: "#ffb3b3" }}>
            <div className="sp-label" style={{ color: "#ffb3b3" }}>送出失敗</div>
            <p className="sp-zh" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.55 }}>{transportError}</p>
            <button type="button" className="sp-btn sp-btn-primary" style={{ marginTop: 12 }} onClick={onRetry}>重新送出</button>
          </section>
        ) : null}
      </main>
      <SpObActions onBack={onBack} onNext={result ? onStart : undefined} nextLabel={loading ? "建立中…" : "開始記錄飲食 →"} />
    </div>
  );
}

export function OnboardingStepperPresentation({
  step,
  data,
  validationIssues = [],
  loading,
  transportError,
  result,
  onGoalSelect,
  onGoalClarificationNext,
  onBodyDataNext,
  onLifestyleNext,
  onAdvancedMetricsNext,
  onAdvancedMetricsSkip,
  onBack,
  onStart,
  onRetry,
  onFieldEdit,
}: OnboardingStepperPresentationProps) {
  const [goalClarification, setGoalClarification] = useState(data.goalClarification ?? "");
  const [bodyData, setBodyData] = useState<BodyForm>({
    sex: data.sex ?? "male",
    age: String(data.age ?? "28"),
    heightCm: String(data.heightCm ?? "175"),
    weightKg: String(data.weightKg ?? "70"),
  });
  const [lifestyle, setLifestyle] = useState<LifestyleForm>({
    activityLevel: data.activityLevel ?? "moderate",
    trainingFrequency: data.trainingFrequency ?? "3_4",
    allergies: data.allergies ?? "",
  });
  const [advanced, setAdvanced] = useState<AdvancedForm>({
    bodyFatPercent: data.bodyFatPercent == null ? "" : String(data.bodyFatPercent),
    tdee: data.tdee == null ? "" : String(data.tdee),
    advancedNotes: data.advancedNotes ?? "",
  });

  useEffect(() => {
    setGoalClarification(data.goalClarification ?? "");
    setBodyData({
      sex: data.sex ?? "male",
      age: String(data.age ?? "28"),
      heightCm: String(data.heightCm ?? "175"),
      weightKg: String(data.weightKg ?? "70"),
    });
    setLifestyle({
      activityLevel: data.activityLevel ?? "moderate",
      trainingFrequency: data.trainingFrequency ?? "3_4",
      allergies: data.allergies ?? "",
    });
    setAdvanced({
      bodyFatPercent: data.bodyFatPercent == null ? "" : String(data.bodyFatPercent),
      tdee: data.tdee == null ? "" : String(data.tdee),
      advancedNotes: data.advancedNotes ?? "",
    });
  }, [data]);

  const issuesForStep = (stepNumber: OnboardingStep): StepIssue[] =>
    validationIssues.filter((issue) => issue.step === stepNumber);

  if (step === 1) return <SpStepGoal value={data.goal} issues={issuesForStep(1)} onSelect={onGoalSelect} />;
  if (step === 2) return (
    <SpStepGoalClarification
      goal={data.goal}
      value={goalClarification}
      issues={issuesForStep(2)}
      onChange={(value) => {
        setGoalClarification(value);
        onFieldEdit("goalClarification");
      }}
      onNext={() => onGoalClarificationNext(goalClarification)}
      onBack={() => onBack(1)}
    />
  );
  if (step === 3) return (
    <SpStepBody
      value={bodyData}
      issues={issuesForStep(3)}
      onChange={(value) => {
        if (value.age !== bodyData.age) onFieldEdit("age");
        if (value.heightCm !== bodyData.heightCm) onFieldEdit("heightCm");
        if (value.weightKg !== bodyData.weightKg) onFieldEdit("weightKg");
        setBodyData(value);
      }}
      onNext={() => onBodyDataNext({
        sex: bodyData.sex,
        age: Number(bodyData.age),
        heightCm: Number(bodyData.heightCm),
        weightKg: Number(bodyData.weightKg),
      })}
      onBack={() => onBack(2)}
    />
  );
  if (step === 4) return (
    <SpStepLifestyle
      value={lifestyle}
      issues={issuesForStep(4)}
      onChange={(value) => {
        if (value.activityLevel !== lifestyle.activityLevel) onFieldEdit("activityLevel");
        if (value.trainingFrequency !== lifestyle.trainingFrequency) onFieldEdit("trainingFrequency");
        setLifestyle(value);
      }}
      onNext={() => onLifestyleNext(lifestyle)}
      onBack={() => onBack(3)}
    />
  );
  if (step === 5) return (
    <SpStepAdvancedMetrics
      value={advanced}
      issues={issuesForStep(5)}
      onChange={(value) => {
        if (value.bodyFatPercent !== advanced.bodyFatPercent) onFieldEdit("bodyFatPercent");
        if (value.tdee !== advanced.tdee) onFieldEdit("tdee");
        if (value.advancedNotes !== advanced.advancedNotes) onFieldEdit("advancedNotes");
        setAdvanced(value);
      }}
      onNext={() => onAdvancedMetricsNext({
        bodyFatPercent: advanced.bodyFatPercent === "" ? undefined : Number(advanced.bodyFatPercent),
        tdee: advanced.tdee === "" ? undefined : Number(advanced.tdee),
        advancedNotes: advanced.advancedNotes,
      })}
      onSkip={onAdvancedMetricsSkip}
      onBack={() => onBack(4)}
    />
  );
  return (
    <SpStepHandoff
      loading={loading}
      transportError={transportError}
      result={result}
      onStart={onStart}
      onRetry={onRetry}
      onBack={() => onBack(5)}
    />
  );
}

export function OnboardingStepper() {
  const setDevice = useStore((s) => s.setDevice);
  const [step, setStep] = useState<StepState>(1);
  const [data, setData] = useState<PartialIntake>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [validationIssues, setValidationIssues] = useState<IntakeValidationIssue[]>([]);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step]);

  function handleBack(nextStep: OnboardingStep) {
    setStep(nextStep);
    setTransportError(null);
    setLoading(false);
  }

  function handleFieldEdit(field: OnboardingField) {
    setValidationIssues((current) => applyFieldEditRecovery(current, field));
    setTransportError(null);
  }

  function handleStepAdvance(stepNumber: OnboardingStep, partial: PartialIntake) {
    const merged = { ...data, ...partial };
    const outcome = getStepAdvanceOutcome(stepNumber, merged);

    setData(merged);
    setValidationIssues((current) => mergeStepIssues(current, stepNumber, outcome.issues));
    setTransportError(null);
    setResult(null);
    setLoading(false);
    setStep(outcome.issues.length > 0 ? stepNumber : outcome.nextStep);
  }

  async function handleSubmit(finalData: Pick<Partial<IntakeData>, "bodyFatPercent" | "tdee" | "advancedNotes">) {
    if (loading) return;

    const merged = { ...data, ...finalData };
    const stepFiveOutcome = getStepAdvanceOutcome(5, merged);

    setData(merged);
    setValidationIssues((current) => mergeStepIssues(current, 5, stepFiveOutcome.issues));
    setTransportError(null);
    setResult(null);

    if (stepFiveOutcome.issues.length > 0) {
      setLoading(false);
      setStep(5);
      return;
    }

    const completeIntake = merged as IntakeData;
    const submitOutcome = await runSubmitAttempt(completeIntake, submitIntake, () => {
      setStep(6);
      setLoading(true);
      setTransportError(null);
      setValidationIssues([]);
      setResult(null);
    });

    setStep(submitOutcome.nextStep);
    setValidationIssues(submitOutcome.issues);
    setTransportError(submitOutcome.transportError);
    setResult(submitOutcome.result);
    setLoading(false);
  }

  function handleComplete() {
    if (!result || !data.goal) return;
    setDevice(result.deviceId, data.goal!, result.dailyTargets);
  }

  return (
    <OnboardingStepperPresentation
      step={step}
      data={data}
      validationIssues={validationIssues}
      loading={loading}
      transportError={transportError}
      result={result}
      onGoalSelect={(goal) => handleStepAdvance(1, { goal })}
      onGoalClarificationNext={(goalClarification) => handleStepAdvance(2, { goalClarification })}
      onBodyDataNext={(nextBodyData) => handleStepAdvance(3, nextBodyData)}
      onLifestyleNext={(nextLifestyle) => handleStepAdvance(4, nextLifestyle)}
      onAdvancedMetricsNext={handleSubmit}
      onAdvancedMetricsSkip={() => handleSubmit(getAdvancedMetricsSkipData())}
      onBack={handleBack}
      onStart={handleComplete}
      onRetry={() =>
        handleSubmit({
          bodyFatPercent: data.bodyFatPercent,
          tdee: data.tdee,
          advancedNotes: data.advancedNotes,
        })
      }
      onFieldEdit={handleFieldEdit}
    />
  );
}
