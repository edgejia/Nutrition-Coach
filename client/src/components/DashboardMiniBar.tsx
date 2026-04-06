import { useStore } from "../store.js";

export function DashboardMiniBar() {
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);

  if (!summary) return null;

  const fatPct = targets && targets.fat > 0 ? (summary.totalFat / targets.fat) * 100 : 0;
  const isFatHigh = fatPct >= 85;

  return (
    <div
      className="flex gap-2 overflow-x-auto px-4 py-2.5 scrollbar-none"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <span
        className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{
          background: "rgba(76,184,122,0.08)",
          border: "1px solid rgba(76,184,122,0.25)",
          color: "var(--green)",
        }}
      >
        Synced to today
      </span>
      <span
        className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-med)",
          color: "var(--text-2)",
        }}
      >
        {Math.round(summary.totalCalories)} / {targets?.calories ?? "—"} kcal
      </span>
      <span
        className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-med)",
          color: "var(--text-2)",
        }}
      >
        P {Math.round(summary.totalProtein)} / {targets?.protein ?? "—"}g
      </span>
      {isFatHigh && (
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            background: "rgba(232,160,32,0.08)",
            border: "1px solid rgba(232,160,32,0.3)",
            color: "var(--amber)",
          }}
        >
          Fat near limit
        </span>
      )}
    </div>
  );
}
