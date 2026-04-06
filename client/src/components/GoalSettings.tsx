import { useState } from "react";
import { useStore } from "../store.js";
import { updateGoals } from "../api.js";

const FIELD_LABELS: Record<string, string> = {
  calories: "熱量 (kcal)",
  protein: "蛋白質 (g)",
  carbs: "碳水 (g)",
  fat: "脂肪 (g)",
};

export function GoalSettings({ onClose }: { onClose: () => void }) {
  const dailyTargets = useStore((s) => s.dailyTargets);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const clearDevice = useStore((s) => s.clearDevice);

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
        clearDevice();
      } else {
        alert("更新目標失敗，請稍後再試。");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div
        className="w-full max-w-sm space-y-5 rounded-2xl p-6"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-med)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.02em",
          }}
        >
          自訂每日目標
        </h2>

        {(["calories", "protein", "carbs", "fat"] as const).map((key) => (
          <label key={key} className="block">
            <span
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-2)" }}
            >
              {FIELD_LABELS[key]}
            </span>
            <input
              type="number"
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
              className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border-med)",
                color: "var(--text)",
                fontFamily: "var(--font-body)",
              }}
            />
          </label>
        ))}

        <div className="flex gap-2.5 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-med)",
              color: "var(--text-2)",
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{
              background: "var(--orange)",
              boxShadow: "0 4px 16px rgba(232,104,42,0.3)",
            }}
          >
            {saving ? "儲存中..." : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}
