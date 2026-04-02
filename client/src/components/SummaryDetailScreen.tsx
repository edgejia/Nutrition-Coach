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
            setError("載入餐點失敗，請重試。");
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <main className="flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <div className="mb-3 text-sm font-semibold text-gray-900">今日營養狀態</div>
          <Dashboard />
        </section>
        {loading ? (
          <p className="text-sm text-gray-500">載入餐點中...</p>
        ) : error ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-red-600 ring-1 ring-gray-200">{error}</p>
        ) : (
          <MealTimeline meals={meals} deletingMealId={deletingMealId} onDelete={handleDelete} />
        )}
      </main>
      <div className="border-t bg-white p-3">
        <button
          type="button"
          onClick={() => setActiveScreen("home")}
          className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white"
        >
          返回 Dashboard
        </button>
      </div>
    </div>
  );
}
