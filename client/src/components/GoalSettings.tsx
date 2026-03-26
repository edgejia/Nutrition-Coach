import { useState } from "react";
import { useStore } from "../store.js";
import { updateGoals } from "../api.js";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6">
        <h2 className="text-xl font-bold">自訂每日目標</h2>
        {(["calories", "protein", "carbs", "fat"] as const).map((key) => (
          <label key={key} className="block">
            <span className="text-sm text-gray-600">
              {key === "calories" ? "熱量 (kcal)" : key === "protein" ? "蛋白質 (g)" : key === "carbs" ? "碳水 (g)" : "脂肪 (g)"}
            </span>
            <input
              type="number"
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
        ))}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border px-4 py-2">取消</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}
