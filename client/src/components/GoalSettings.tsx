import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import { updateGoals } from "../api.js";
import { normalizeTargetInputValue } from "../lib/target-input.js";
import { SportBoltIcon, SportChevronLeftIcon, SportChevronRightIcon } from "./SportIcons.js";
import { SportIconButton, SportScreen } from "./SportPrimitives.js";

const TARGET_FIELDS = [
  { key: "calories", zh: "熱量", hint: "每日 kcal", unit: "kcal" },
  { key: "protein", zh: "蛋白質", hint: "每日 g", unit: "g" },
  { key: "carbs", zh: "碳水", hint: "每日 g", unit: "g" },
  { key: "fat", zh: "脂肪", hint: "每日 g", unit: "g" },
] as const;

function createTargetForm(targets: ReturnType<typeof useStore.getState>["dailyTargets"]) {
  return {
    calories: targets?.calories ?? 0,
    protein: targets?.protein ?? 0,
    carbs: targets?.carbs ?? 0,
    fat: targets?.fat ?? 0,
  };
}

export function GoalSettings({ onClose }: { onClose: () => void }) {
  const dailyTargets = useStore((s) => s.dailyTargets);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);

  const [form, setForm] = useState(() => createTargetForm(dailyTargets));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setForm(createTargetForm(dailyTargets));
    }
  }, [dailyTargets, editing]);

  function resetFormFromTargets() {
    setForm(createTargetForm(dailyTargets));
  }

  function startEditing() {
    setForm(createTargetForm(dailyTargets));
    setEditing(true);
  }

  function handleCancel() {
    resetFormFromTargets();
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { dailyTargets: updated } = await updateGoals(form);
      setDailyTargets(updated);
      setEditing(false);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      } else {
        alert("更新目標失敗，請稍後再試。");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SportScreen>
        <SecondaryHeader title="設定" badge="偏好與目標" onBack={onClose} />
        <main className="sp-scroll screen-scroll-safe" style={{ paddingTop: 16 }}>
          <section
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              background: "var(--sp-surface)",
              border: "1px solid var(--sp-line)",
              borderRadius: "var(--sp-r-md)",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "var(--sp-r-md)",
                background: "var(--sp-lime)",
                color: "#0a0b0d",
                display: "grid",
                placeItems: "center",
                fontFamily: "var(--sp-font-display)",
                fontSize: 22,
              }}
            >
              JC
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sp-zh" style={{ fontWeight: 600, fontSize: 14, color: "var(--sp-ink)" }}>
                訪客模式
              </div>
              <div className="sp-num" style={{ fontSize: 10, color: "var(--sp-ink-3)", marginTop: 2 }}>
                訪客 · 瀏覽器保存 · 12 天
              </div>
            </div>
            <span className="sp-chip sp-chip-good" style={{ padding: "3px 8px" }}>
              使用中
            </span>
          </section>

          <section className="sp-card" style={{ padding: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                borderBottom: "1px solid var(--sp-line)",
              }}
            >
              <div>
                <div className="sp-label">每日目標</div>
                <div className="sp-zh" style={{ fontWeight: 700, fontSize: 14, color: "var(--sp-ink)", marginTop: 2 }}>
                  每日目標
                </div>
              </div>
              {!editing ? (
                <button type="button" className="sp-btn" style={{ padding: "8px 14px" }} onClick={startEditing}>
                  編輯
                </button>
              ) : null}
            </div>

            {!editing ? (
              <div style={{ padding: "4px 16px 14px" }}>
                {TARGET_FIELDS.map(({ key, zh, hint, unit }) => (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderBottom: key !== "fat" ? "1px dashed var(--sp-line)" : "none",
                    }}
                  >
                    <div>
                      <div className="sp-zh" style={{ fontSize: 13, color: "var(--sp-ink-2)" }}>
                        {zh}
                      </div>
                      <div className="sp-label" style={{ fontSize: 9, marginTop: 2 }}>
                        {hint}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span className="sp-display" style={{ fontSize: 28, color: "var(--sp-ink)" }}>
                        {dailyTargets?.[key] ?? 0}
                      </span>
                      <span className="sp-num" style={{ fontSize: 10, color: "var(--sp-ink-3)" }}>
                        {unit}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                {TARGET_FIELDS.map(({ key, zh, hint, unit }) => (
                  <label key={key} style={{ display: "block" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <span className="sp-zh" style={{ fontSize: 13, color: "var(--sp-ink)", fontWeight: 500 }}>
                        {zh}
                      </span>
                      <span className="sp-label" style={{ fontSize: 9 }}>
                        {hint}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        background: "var(--sp-surface-3)",
                        border: "1px solid var(--sp-line-strong)",
                        borderRadius: "var(--sp-r-sm)",
                        padding: "10px 12px",
                      }}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={String(form[key])}
                        onChange={(e) => setForm({ ...form, [key]: normalizeTargetInputValue(e.target.value) })}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: "transparent",
                          border: 0,
                          outline: "none",
                          fontFamily: "var(--sp-font-mono)",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--sp-ink)",
                        }}
                      />
                      <span className="sp-num" style={{ fontSize: 11, color: "var(--sp-ink-3)", marginLeft: 8 }}>
                        {unit}
                      </span>
                    </div>
                  </label>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="button" className="sp-btn sp-btn-ghost" style={{ flex: 1 }} onClick={handleCancel}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="sp-btn sp-btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "儲存中…" : "儲存"}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="sp-card" style={{ padding: 0 }}>
            <CardHeader label="偏好設定" title="偏好" />
            <SettingsRow zh="時區" note="Asia/Taipei" value="Asia/Taipei" />
            <SettingsRow zh="語言" note="介面語言" value="繁體中文" />
            <SettingsRow zh="提醒" note="餐點與目標提醒" value="尚未開放" muted last />
          </section>

          <section className="sp-card" style={{ padding: 0 }}>
            <CardHeader label="資料管理" title="資料" />
            <SettingsRow zh="匯出資料" note="下載紀錄" value="尚未開放" muted />
            <SettingsRow zh="清除資料" note="刪除本機日記" value="尚未開放" muted danger last />
          </section>

          <section
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 4px",
              marginTop: 4,
            }}
          >
            <div className="sp-num" style={{ fontSize: 10, color: "var(--sp-ink-3)" }}>
              營養教練 · v1.8.2
            </div>
            <div
              className="sp-num"
              style={{
                fontSize: 10,
                color: "var(--sp-ink-3)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <SportBoltIcon size={11} /> sport · 04/30
            </div>
          </section>
        </main>
    </SportScreen>
  );
}

function SecondaryHeader({ title, badge, onBack }: { title: string; badge: string; onBack: () => void }) {
  return (
    <header className="sp-header" style={{ borderBottom: "1px solid var(--sp-line)", paddingBottom: 12 }}>
      <SportIconButton aria-label="返回" onClick={onBack}>
        <SportChevronLeftIcon size={18} />
      </SportIconButton>
      <div style={{ flex: 1, textAlign: "center" }}>
        <div className="sp-label" style={{ fontSize: 9 }}>
          {badge}
        </div>
        <div className="sp-zh" style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
          {title}
        </div>
      </div>
      <div style={{ width: 38 }} />
    </header>
  );
}

function CardHeader({ label, title }: { label: string; title: string }) {
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--sp-line)" }}>
      <div className="sp-label">{label}</div>
      <div className="sp-zh" style={{ fontWeight: 700, fontSize: 14, color: "var(--sp-ink)", marginTop: 2 }}>
        {title}
      </div>
    </div>
  );
}

function SettingsRow({
  zh,
  note,
  value,
  muted = false,
  danger = false,
  last = false,
}: {
  zh: string;
  note: string;
  value: string;
  muted?: boolean;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: last ? "none" : "1px dashed var(--sp-line)",
        cursor: muted ? "default" : "pointer",
        opacity: muted ? 0.6 : 1,
      }}
    >
      <div>
        <div className="sp-zh" style={{ fontSize: 13, color: danger ? "#ffb3b3" : "var(--sp-ink)" }}>
          {zh}
        </div>
        <div className="sp-label" style={{ fontSize: 9, marginTop: 2 }}>
          {note}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="sp-num" style={{ fontSize: 11, color: muted ? "var(--sp-ink-3)" : "var(--sp-ink-2)" }}>
          {value}
        </span>
        {!muted ? <SportChevronRightIcon size={14} /> : null}
      </div>
    </div>
  );
}
