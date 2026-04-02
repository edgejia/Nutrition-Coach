import { useStore } from "../store.js";

export function DashboardMiniBar() {
  const summary = useStore((s) => s.dailySummary);

  if (!summary) return null;

  return (
    <div className="border-b bg-white px-4 py-3 text-sm text-gray-700">
      今日 {Math.round(summary.totalCalories)} kcal · P{Math.round(summary.totalProtein)} · C{Math.round(summary.totalCarbs)} · F{Math.round(summary.totalFat)}
    </div>
  );
}
