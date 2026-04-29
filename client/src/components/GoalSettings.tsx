import { useState } from "react";
import { useStore } from "../store.js";
import { updateGoals } from "../api.js";
import { SecondaryHeader } from "./SketchPrimitives.js";

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
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const { dailyTargets: updated } = await updateGoals(form);
      setDailyTargets(updated);
      onClose();
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
        className="screen-scroll-safe w-full space-y-5 p-5"
        style={{
          background: "var(--sk-paper)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--sk-font-hand)",
            fontSize: 22,
            fontWeight: 800,
            color: "var(--sk-ink)",
          }}
        >
          自訂每日目標
        </h2>

        {(["calories", "protein", "carbs", "fat"] as const).map((key) => (
          <label key={key} className="block">
            <span
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--sk-ink-soft)" }}
            >
              {FIELD_LABELS[key]}
            </span>
            <input
              type="number"
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
              className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
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
          <button
            onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{
              background: "var(--sk-paper)",
              border: "1.25px solid var(--sk-ink)",
              color: "var(--sk-ink-soft)",
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{
              background: "var(--sk-accent)",
              border: "1.25px solid var(--sk-ink)",
              boxShadow: "1px 1.5px 0 var(--sk-ink)",
            }}
          >
            {saving ? "儲存中..." : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}
