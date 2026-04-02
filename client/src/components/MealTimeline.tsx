import type { MealEntry } from "../types.js";

export function MealTimeline(props: {
  meals: MealEntry[];
  deletingMealId: string | null;
  onDelete: (mealId: string) => void;
}) {
  if (props.meals.length === 0) {
    return <p className="rounded-2xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">今天還沒有餐點紀錄。</p>;
  }

  return (
    <div className="space-y-3">
      {props.meals.map((meal) => (
        <article key={meal.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm text-gray-500">
                {new Date(meal.loggedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
              </div>
              <div className="mt-1 font-semibold text-gray-900">{meal.foodName}</div>
              <div className="mt-1 text-sm text-gray-600">
                {Math.round(meal.calories)} kcal · P{Math.round(meal.protein)} / C{Math.round(meal.carbs)} / F{Math.round(meal.fat)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => props.onDelete(meal.id)}
              disabled={props.deletingMealId !== null}
              className="text-sm text-red-600 hover:underline disabled:opacity-50"
            >
              刪除
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
