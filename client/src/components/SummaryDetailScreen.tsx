import { useEffect, useState } from "react";
import { getMeals, deleteMeal } from "../api.js";
import { useStore } from "../store.js";
import { Dashboard } from "./Dashboard.js";
import { MealTimeline } from "./MealTimeline.js";

export function SummaryDetailScreen() {
  const meals = useStore((s) => s.meals);
  const setMeals = useStore((s) => s.setMeals);
  const removeMeal = useStore((s) => s.removeMeal);
  const clearDevice = useStore((s) => s.clearDevice);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const sending = useStore((s) => s.sending);
  const [loading, setLoading] = useState(true);
  const [deletingMealId, setDeletingMealId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMeals()
      .then(({ meals }) => {
        if (!cancelled) setMeals(meals);
      })
        .catch((err) => {
        if (!cancelled) {
          if (err instanceof Error && err.message === "UNAUTHORIZED") {
            clearDevice();
          } else {
            setError("內容載入失敗，請重新整理後再試一次。");
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setMeals, clearDevice]);

  async function handleDelete(mealId: string) {
    const previousMeals = useStore.getState().meals;
    setDeletingMealId(mealId);
    removeMeal(mealId);
    try {
      await deleteMeal(mealId);
    } catch (err) {
      setMeals(previousMeals);
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        clearDevice();
        return;
      }
      alert("刪除失敗，請再試一次。");
    } finally {
      setDeletingMealId(null);
    }
  }

  const calRemaining =
    targets && summary ? Math.max(0, Math.round(targets.calories - summary.totalCalories)) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <div className="shrink-0 px-5 pb-3 pt-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => setActiveScreen("home")}
          disabled={sending}
          className="mb-3 flex items-center gap-2 text-xs font-semibold disabled:opacity-40"
          style={{ color: "var(--text-2)" }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg text-xs"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-med)",
            }}
          >
            ‹
          </span>
          返回主頁
        </button>
        <h2
          className="mb-1"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.025em",
          }}
        >
          今日摘要
        </h2>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
          這裡才展開今日餐點、來源與更正操作，讓首頁保持乾淨。
        </p>
      </div>

      <main className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <div
            className="rounded-2xl p-3.5"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-med)",
            }}
          >
            <div className="mb-1.5 text-xs font-bold" style={{ color: "var(--text)" }}>
              今日狀態
            </div>
            <div className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
              {calRemaining !== null ? `剩餘 ${calRemaining} kcal` : "計算中..."}
              <br />
              {targets && summary && summary.totalProtein < targets.protein * 0.8
                ? "蛋白質攝取仍需加強。"
                : "蛋白質攝取達標。"}
            </div>
          </div>
          <div
            className="rounded-2xl p-3.5"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-med)",
            }}
          >
            <div className="mb-1.5 text-xs font-bold" style={{ color: "var(--text)" }}>
              教練備注
            </div>
            <div className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
              {calRemaining !== null && calRemaining > 200
                ? "晚餐可正常份量，但留意脂肪攝取。"
                : "今日晚餐建議清淡。"}
            </div>
          </div>
        </div>

        <Dashboard />

        <div>
          <div
            className="mb-2 px-1 text-base font-bold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 800,
              color: "var(--text)",
              letterSpacing: "-0.015em",
            }}
          >
            今日餐點
          </div>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>
              載入餐點中...
            </p>
          ) : error ? (
            <p
              className="rounded-2xl p-4 text-sm"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-med)",
                color: "var(--red)",
              }}
            >
              {error}
            </p>
          ) : (
            <MealTimeline meals={meals} deletingMealId={deletingMealId} onDelete={handleDelete} />
          )}
        </div>
      </main>
    </div>
  );
}
