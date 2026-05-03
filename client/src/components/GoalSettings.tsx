import { useState } from "react";
import { useStore } from "../store.js";
import { updateGoals } from "../api.js";
import { SportBoltIcon, SportChevronLeftIcon } from "./SportIcons.js";
import { SportCard, SportChip, SportIconButton, SportScreen } from "./SportPrimitives.js";

const TARGET_FIELDS = [
  { key: "calories", label: "熱量", hint: "每日 kcal", unit: "kcal" },
  { key: "protein", label: "蛋白質", hint: "每日 g", unit: "g" },
  { key: "carbs", label: "碳水", hint: "每日 g", unit: "g" },
  { key: "fat", label: "脂肪", hint: "每日 g", unit: "g" },
] as const;

const PREFERENCE_ROWS = [
  { label: "時區", note: "日界線與紀錄時間", danger: false },
  { label: "語言", note: "介面語言", danger: false },
  { label: "提醒", note: "餐點與目標提醒", danger: false },
] as const;

const DATA_ROWS = [
  { label: "匯出資料", note: "下載紀錄", danger: false },
  { label: "清除資料", note: "刪除本機日記", danger: true },
] as const;

export function GoalSettings({ onClose }: { onClose: () => void }) {
  const dailyTargets = useStore((s) => s.dailyTargets);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);

  const [form, setForm] = useState({
    calories: dailyTargets?.calories ?? 0,
    protein: dailyTargets?.protein ?? 0,
    carbs: dailyTargets?.carbs ?? 0,
    fat: dailyTargets?.fat ?? 0,
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  function resetFormFromTargets() {
    setForm({
      calories: dailyTargets?.calories ?? 0,
      protein: dailyTargets?.protein ?? 0,
      carbs: dailyTargets?.carbs ?? 0,
      fat: dailyTargets?.fat ?? 0,
    });
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
    <SportScreen className="absolute inset-0 z-50">
      <header className="sp-header border-b border-[var(--sp-line)] pb-3">
        <SportIconButton aria-label="返回" onClick={onClose}>
          <SportChevronLeftIcon size={18} />
        </SportIconButton>
        <div className="min-w-0 flex-1 text-center">
          <div className="sp-label text-[9px]">偏好與目標</div>
          <div className="sp-zh mt-0.5 text-sm font-bold">設定</div>
        </div>
        <div aria-hidden="true" className="h-[38px] w-[38px]" />
      </header>

      <main className="sp-scroll screen-scroll-safe pt-4">
        <section className="flex items-center gap-3 rounded-[var(--sp-r-md)] border border-[var(--sp-line)] bg-[var(--sp-surface)] px-3.5 py-3">
          <div className="sp-display grid h-11 w-11 shrink-0 place-items-center rounded-[var(--sp-r-md)] bg-[var(--sp-lime)] text-[22px] text-[var(--sp-bg)]">
            NC
          </div>
          <div className="min-w-0 flex-1">
            <div className="sp-zh text-sm font-semibold">訪客模式</div>
            <div className="sp-num mt-0.5 text-[10px] text-[var(--sp-ink-3)]">瀏覽器 · cookie 保存</div>
          </div>
          <SportChip variant="good" className="px-2 py-1 text-[10px]">
            使用中
          </SportChip>
        </section>

        <SportCard className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--sp-line)] px-4 py-3.5">
            <div>
              <div className="sp-label">daily targets</div>
              <h2 className="sp-zh mt-0.5 text-sm font-bold">每日目標</h2>
            </div>
            {!editing ? (
              <button type="button" className="sp-btn px-3.5 py-2" onClick={() => setEditing(true)}>
                編輯
              </button>
            ) : null}
          </div>

          {!editing ? (
            <div className="px-4 pb-3 pt-1">
              {TARGET_FIELDS.map(({ key, label, hint, unit }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 border-b border-dashed border-[var(--sp-line)] py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="sp-zh text-[13px] text-[var(--sp-ink-2)]">{label}</div>
                    <div className="sp-label mt-0.5 text-[9px]">{hint}</div>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-1">
                    <span className="sp-display text-[28px]">{dailyTargets?.[key] ?? 0}</span>
                    <span className="sp-num text-[10px] text-[var(--sp-ink-3)]">{unit}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3 px-4 py-4">
              {TARGET_FIELDS.map(({ key, label, hint, unit }) => (
                <label key={key} className="block">
                  <span className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="sp-zh text-[13px] font-medium">{label}</span>
                    <span className="sp-label text-[9px]">{hint}</span>
                  </span>
                  <span className="flex items-center rounded-[var(--sp-r-sm)] border border-[var(--sp-line-strong)] bg-[var(--sp-surface-3)] px-3 py-2.5">
                    <input
                      type="number"
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                      className="sp-num min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--sp-ink)] outline-none"
                    />
                    <span className="sp-num ml-2 text-[11px] text-[var(--sp-ink-3)]">{unit}</span>
                  </span>
                </label>
              ))}

              <div className="flex gap-2 pt-1">
                <button type="button" className="sp-btn sp-btn-ghost min-h-11 flex-1" onClick={handleCancel}>
                  取消
                </button>
                <button
                  type="button"
                  className="sp-btn sp-btn-primary min-h-11 flex-1"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "儲存中..." : "儲存"}
                </button>
              </div>
            </div>
          )}
        </SportCard>

        <SportCard className="p-0">
          <SectionHeader eyebrow="preferences" title="偏好" />
          {PREFERENCE_ROWS.map((row, index) => (
            <UnavailableRow key={row.label} {...row} last={index === PREFERENCE_ROWS.length - 1} />
          ))}
        </SportCard>

        <SportCard className="p-0">
          <SectionHeader eyebrow="data" title="資料" />
          {DATA_ROWS.map((row, index) => (
            <UnavailableRow key={row.label} {...row} last={index === DATA_ROWS.length - 1} />
          ))}
        </SportCard>

        <section className="mt-1 flex items-center justify-between gap-3 px-1 py-2.5">
          <div className="sp-num text-[10px] text-[var(--sp-ink-3)]">營養教練 · v1.8.2</div>
          <div className="sp-num inline-flex items-center gap-1.5 text-[10px] text-[var(--sp-ink-3)]">
            <SportBoltIcon size={11} />
            sport · 04/30
          </div>
        </section>
      </main>
    </SportScreen>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-b border-[var(--sp-line)] px-4 py-3.5">
      <div className="sp-label">{eyebrow}</div>
      <h2 className="sp-zh mt-0.5 text-sm font-bold">{title}</h2>
    </div>
  );
}

function UnavailableRow({
  label,
  note,
  danger = false,
  last = false,
}: {
  label: string;
  note: string;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-4 px-4 py-3 opacity-60",
        last ? "" : "border-b border-dashed border-[var(--sp-line)]",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className={["sp-zh text-[13px]", danger ? "text-[#ffb3b3]" : "text-[var(--sp-ink)]"].join(" ")}>
          {label}
        </div>
        <div className="sp-label mt-0.5 text-[9px]">{note}</div>
      </div>
      <span className="sp-num shrink-0 text-[11px] text-[var(--sp-ink-3)]">尚未開放</span>
    </div>
  );
}
