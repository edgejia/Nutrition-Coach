import { useStore } from "../store.js";

function formatValue(value: number | undefined, unit = "") {
  return value === undefined ? `--${unit}` : `${Math.round(value)}${unit}`;
}

function MacroChip({ label, current, target }: { label: string; current?: number; target?: number }) {
  return (
    <span
      className="sk-pill flex shrink-0 items-center gap-1 px-2.5 py-1 text-[11px]"
      style={{ color: "var(--sk-ink)" }}
    >
      <span style={{ color: "var(--sk-ink-soft)" }}>{label}</span>
      <span className="sk-metric text-[11px]">
        {formatValue(current)} / {formatValue(target, "g")}
      </span>
    </span>
  );
}

export function DashboardMiniBar() {
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);

  const remainingCalories = summary && targets
    ? Math.max(0, Math.round(targets.calories - summary.totalCalories))
    : undefined;

  return (
    <div
      className="flex min-h-9 gap-1.5 overflow-x-auto py-1 scrollbar-none"
      aria-label="今日營養摘要"
    >
      <span
        className="sk-pill flex shrink-0 items-center gap-1 px-2.5 py-1 text-[11px]"
        style={{ color: "var(--sk-ink)" }}
      >
        <span style={{ color: "var(--sk-ink-soft)" }}>還能吃</span>
        <span className="sk-metric text-[11px]">{formatValue(remainingCalories, " kcal")}</span>
      </span>
      <MacroChip label="蛋白" current={summary?.totalProtein} target={targets?.protein} />
      <MacroChip label="碳水" current={summary?.totalCarbs} target={targets?.carbs} />
      <MacroChip label="脂肪" current={summary?.totalFat} target={targets?.fat} />
    </div>
  );
}
