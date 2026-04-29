import { useState } from "react";
import { useStore } from "../store.js";
import { updateGoals } from "../api.js";
import { SecondaryHeader, SketchButton, SketchSoftBox } from "./SketchPrimitives.js";

const FIELD_LABELS: Record<string, string> = {
  calories: "熱量 (kcal)",
  protein: "蛋白質 (g)",
  carbs: "碳水 (g)",
  fat: "脂肪 (g)",
};

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
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: "var(--sk-paper)" }}>
      <SecondaryHeader title="設定" backLabel="‹ 首頁" onBack={onClose} />
      <div
        className="screen-scroll-safe w-full space-y-4 p-5"
        style={{
          background: "var(--sk-paper)",
        }}
      >
        <SketchSoftBox className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="sk-heading text-2xl">每日目標</h2>
            {!editing ? (
              <SketchButton onClick={() => setEditing(true)} className="px-3 py-1.5 text-sm">
                編輯
              </SketchButton>
            ) : null}
          </div>

          {!editing ? (
            <div className="space-y-2">
              {(["calories", "protein", "carbs", "fat"] as const).map((key) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
                    {FIELD_LABELS[key].replace(" (kcal)", "").replace(" (g)", "")}
                  </span>
                  <span className="sk-heading text-lg">
                    {dailyTargets?.[key] ?? 0} {key === "calories" ? "kcal" : "g"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <>
              {(["calories", "protein", "carbs", "fat"] as const).map((key) => (
                <label key={key} className="block">
                  <span
                    className="mb-1.5 block text-xs font-semibold uppercase"
                    style={{ color: "var(--sk-ink-soft)" }}
                  >
                    {FIELD_LABELS[key]}
                  </span>
                  <input
                    type="number"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                    style={{
                      background: "var(--sk-paper)",
                      border: "1.25px solid var(--sk-ink)",
                      color: "var(--sk-ink)",
                      fontFamily: "var(--sk-font-mono)",
                    }}
                  />
                </label>
              ))}

              <div className="flex gap-2.5 pt-1">
                <SketchButton onClick={handleCancel} className="flex-1 py-2.5 text-sm">
                  取消
                </SketchButton>
                <SketchButton
                  onClick={handleSave}
                  disabled={saving}
                  variant="accent"
                  className="flex-1 py-2.5 text-sm"
                >
                  {saving ? "儲存中..." : "儲存"}
                </SketchButton>
              </div>
            </>
          )}
        </SketchSoftBox>

        <SketchSoftBox className="space-y-3 p-4">
          <h2 className="sk-heading text-2xl">偏好</h2>
          <StatusRow label="時區" value="Asia/Taipei" />
          <StatusRow label="語言" value="繁體中文" />
          <StatusRow label="提醒" value="尚未開放" />
        </SketchSoftBox>

        <SketchSoftBox className="space-y-3 p-4">
          <h2 className="sk-heading text-2xl">資料</h2>
          <StatusRow label="匯出資料" value="尚未開放" muted />
          <StatusRow label="清除資料" value="尚未開放" muted />
        </SketchSoftBox>

        <SketchSoftBox className="p-4">
          <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
            訪客模式 · cookie-backed session
          </p>
        </SketchSoftBox>
      </div>
    </div>
  );
}

function StatusRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
        {label}
      </span>
      <span className="sk-heading text-base" style={{ color: muted ? "var(--sk-ink-faint)" : "var(--sk-ink)" }}>
        {value}
      </span>
    </div>
  );
}
