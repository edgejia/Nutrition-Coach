import { useStore } from "../store.js";

function ProgressBar({ label, current, target, unit, color }: {
  label: string;
  current: number;
  target: number;
  unit: string;
  color: string;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const remaining = Math.max(target - current, 0);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">
          {Math.round(current)} / {target} {unit}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400">剩餘 {Math.round(remaining)} {unit}</p>
    </div>
  );
}

export function Dashboard() {
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);

  if (!targets) return null;

  const s = summary ?? { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0 };

  return (
    <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <h2 className="font-bold text-gray-900">今日攝取</h2>
      <ProgressBar label="熱量" current={s.totalCalories} target={targets.calories} unit="kcal" color="bg-orange-500" />
      <ProgressBar label="蛋白質" current={s.totalProtein} target={targets.protein} unit="g" color="bg-red-500" />
      <ProgressBar label="碳水" current={s.totalCarbs} target={targets.carbs} unit="g" color="bg-blue-500" />
      <ProgressBar label="脂肪" current={s.totalFat} target={targets.fat} unit="g" color="bg-yellow-500" />
    </div>
  );
}
