import { useStore } from "../store.js";
import type { DailySummary, DailyTargets } from "../types.js";

export type DashboardCellData = {
  label: string;
  current: number;
  target: number;
  unit: string;
  barColor: string;
  valueColor: string;
  nearLimit?: boolean;
};

function MacroCell({
  label,
  current,
  target,
  unit,
  barColor,
  valueColor,
  nearLimit = false,
}: {
  label: string;
  current: number;
  target: number;
  unit: string;
  barColor: string;
  valueColor: string;
  nearLimit?: boolean;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;

  return (
    <div
      className="relative rounded-2xl p-4"
      style={{
        background: "var(--bg-card)",
        border: nearLimit ? "1px solid rgba(232,160,32,0.25)" : "1px solid var(--border)",
      }}
    >
      {nearLimit && <div className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full" style={{ background: "var(--amber)" }} />}
      <div className="mb-1.5 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
        {label}
      </div>
      <div
        className="mb-0.5 leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          fontWeight: 800,
          color: valueColor,
          letterSpacing: "-0.02em",
        }}
      >
        {Math.round(current)} / {target}
        {unit}
      </div>
      <div className="mb-2.5 text-xs" style={{ color: "var(--text-3)" }}>
        還差 {Math.max(0, Math.round(target - current))}
        {unit}
      </div>
      <div className="h-px overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)", height: 3 }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: barColor,
            borderRadius: 2,
            transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </div>
    </div>
  );
}

export function getDashboardCells(
  summary: DailySummary | null,
  targets: DailyTargets | null,
): DashboardCellData[] | null {
  if (!targets) return null;
  if (!summary) {
    return Array.from({ length: 4 }, (_, index) => ({
      label: `skeleton-${index}`,
      current: 0,
      target: 0,
      unit: "",
      barColor: "",
      valueColor: "",
    }));
  }

  const fatPct = targets.fat > 0 ? (summary.totalFat / targets.fat) * 100 : 0;

  return [
    {
      label: "熱量",
      current: summary.totalCalories,
      target: targets.calories,
      unit: "kcal",
      barColor: "var(--orange)",
      valueColor: "var(--orange)",
    },
    {
      label: "蛋白質",
      current: summary.totalProtein,
      target: targets.protein,
      unit: "g",
      barColor: "var(--red)",
      valueColor: "var(--red)",
    },
    {
      label: "碳水",
      current: summary.totalCarbs,
      target: targets.carbs,
      unit: "g",
      barColor: "var(--blue)",
      valueColor: "var(--blue)",
    },
    {
      label: "脂肪",
      current: summary.totalFat,
      target: targets.fat,
      unit: "g",
      barColor: "var(--amber)",
      valueColor: "var(--amber)",
      nearLimit: fatPct >= 85,
    },
  ];
}

export function Dashboard({ onTap }: { onTap?: () => void } = {}) {
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const cells = getDashboardCells(summary, targets);

  if (!cells) return null;

  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="animate-pulse rounded-2xl p-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
          >
            <div className="mb-2 h-3 w-16 rounded" style={{ background: "var(--bg-raised)" }} />
            <div className="mb-1 h-7 w-24 rounded" style={{ background: "var(--bg-raised)" }} />
            <div className="mt-3 h-px w-full" style={{ background: "var(--bg-raised)" }} />
          </div>
        ))}
      </div>
    );
  }

  const grid = (
    <div className="grid grid-cols-2 gap-2.5">
      {cells.map((cell) => (
        <MacroCell key={cell.label} {...cell} />
      ))}
    </div>
  );

  if (!onTap) return grid;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label="查看今日營養詳情"
      className="w-full cursor-pointer text-left"
    >
      {grid}
    </button>
  );
}
