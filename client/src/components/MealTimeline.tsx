import type { MealEntry } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";

export function getMealRowPresentation(meal: MealEntry) {
  return {
    timeLabel: new Date(meal.loggedAt).toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    thumbnailSrc: meal.imageUrl ?? undefined,
    macroSummary: `${Math.round(meal.calories)} kcal · P${Math.round(meal.protein)} · C${Math.round(meal.carbs)} · F${Math.round(meal.fat)}`,
  };
}

export function getMealTimelineEmptyStateCopy(isReadOnly: boolean) {
  return isReadOnly
    ? "這一天還沒有餐點紀錄。可以切回今天查看即時紀錄，或改看其他日期。"
    : "今天還沒有餐點紀錄。";
}

export function MealTimeline(props: {
  meals: MealEntry[];
  deletingMealId: string | null;
  isReadOnly?: boolean;
  onDelete?: (mealId: string) => void;
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
        {getMealTimelineEmptyStateCopy(Boolean(props.isReadOnly))}
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
          {(() => {
            const presentation = getMealRowPresentation(meal);

            return (
              <>
                <div className="w-10 shrink-0 text-xs font-semibold tabular-nums" style={{ color: "var(--text-3)" }}>
                  {presentation.timeLabel}
                </div>
                {presentation.thumbnailSrc && (
                  <PersistedAssetImage
                    src={presentation.thumbnailSrc}
                    alt={`${meal.foodName} 縮圖`}
                    imgClassName="h-10 w-10 shrink-0 rounded-xl object-cover"
                    fallbackClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[10px] font-semibold leading-tight"
                    fallbackStyle={{
                      background: "var(--bg-raised)",
                      borderColor: "var(--border-med)",
                      color: "var(--text-2)",
                    }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold" style={{ color: "var(--text)" }}>
                    {meal.foodName}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: "var(--text-2)" }}>
                    {presentation.macroSummary}
                  </div>
                </div>
              </>
            );
          })()}
          {!props.isReadOnly && props.onDelete && (
            <button
              type="button"
              onClick={() => props.onDelete?.(meal.id)}
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
          )}
        </article>
      ))}
    </div>
  );
}
