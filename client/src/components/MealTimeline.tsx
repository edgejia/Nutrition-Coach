import type { MealEntry } from "../types.js";

export function MealTimeline(props: {
  meals: MealEntry[];
  deletingMealId: string | null;
  onDelete: (mealId: string) => void;
}) {
  if (props.meals.length === 0) {
    return (
      <p
        className="rounded-2xl p-4 text-sm"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-med)",
          color: "var(--text-2)",
        }}
      >
        今天還沒有餐點紀錄。
      </p>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-med)",
      }}
    >
      {props.meals.map((meal, i) => (
        <article
          key={meal.id}
          className="flex items-center gap-3 px-4 py-3.5"
          style={{
            borderBottom: i < props.meals.length - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <div className="w-10 shrink-0 text-xs font-semibold tabular-nums" style={{ color: "var(--text-3)" }}>
            {new Date(meal.loggedAt).toLocaleTimeString("zh-TW", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold" style={{ color: "var(--text)" }}>
              {meal.foodName}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--text-2)" }}>
              {Math.round(meal.calories)} kcal · P{Math.round(meal.protein)} · C{Math.round(meal.carbs)} · F{Math.round(meal.fat)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => props.onDelete(meal.id)}
            disabled={props.deletingMealId !== null}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-med)",
              color: "var(--text-2)",
            }}
          >
            刪除
          </button>
        </article>
      ))}
    </div>
  );
}
