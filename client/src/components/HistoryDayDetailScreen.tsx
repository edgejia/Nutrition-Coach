import { useEffect, useMemo, useRef, useState } from "react";
import { getHistoryDaySnapshot } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, MealEntry } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SecondaryHeader, SketchDivider, SketchSoftBox } from "./SketchPrimitives.js";

function formatDetailDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  if (Number.isNaN(date.getTime())) {
    return "當日詳情";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function macroUnit(value: number) {
  return `${Math.round(value)}g`;
}

function MealDetailRow({
  meal,
  registerRef,
  highlighted,
}: {
  meal: MealEntry;
  registerRef: (node: HTMLDivElement | null) => void;
  highlighted: boolean;
}) {
  return (
    <article
      ref={registerRef}
      data-target-highlight={highlighted ? "true" : "false"}
      className="rounded-lg px-4 py-3 transition-colors duration-500"
      style={{
        background: highlighted ? "var(--sk-accent-soft)" : "var(--sk-paper)",
        border: "2px solid var(--sk-ink)",
        boxShadow: "1px 2px 0 var(--sk-ink)",
      }}
    >
      <div className="flex items-start gap-3">
        <PersistedAssetImage
          src={meal.imageUrl}
          alt={`${meal.foodName} 縮圖`}
          imgClassName="h-12 w-12 shrink-0 rounded-md object-cover"
          fallbackClassName="grid h-12 w-12 shrink-0 place-items-center rounded-md border text-[10px]"
          fallbackStyle={{
            background: "var(--sk-paper-warm)",
            borderColor: "var(--sk-ink-faint)",
            color: "var(--sk-ink-soft)",
          }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="sk-heading truncate text-xl">{meal.foodName}</h3>
          <div className="sk-body mt-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
            {new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
              new Date(meal.loggedAt),
            )}
          </div>
        </div>
        <div className="sk-heading shrink-0 text-2xl">{Math.round(meal.calories)}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
            protein
          </div>
          <div className="sk-metric text-sm">{macroUnit(meal.protein)}</div>
        </div>
        <div>
          <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
            carbs
          </div>
          <div className="sk-metric text-sm">{macroUnit(meal.carbs)}</div>
        </div>
        <div>
          <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
            fat
          </div>
          <div className="sk-metric text-sm">{macroUnit(meal.fat)}</div>
        </div>
      </div>
    </article>
  );
}

export function HistoryDayDetailScreen({ onBack }: { onBack: () => void }) {
  const secondaryScreen = useStore((s) => s.secondaryScreen);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const todayKey = useMemo(() => formatLocalDate(new Date()), []);
  const payload = secondaryScreen?.screen === "dayDetail" ? secondaryScreen.payload : undefined;
  const dateKey = payload?.dateKey ?? todayKey;
  const targetMealId = payload?.targetMealId;
  const [snapshot, setSnapshot] = useState<HistoryDaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedMealId, setHighlightedMealId] = useState<string | null>(targetMealId ?? null);
  const mealRefs = useRef(new Map<string, HTMLDivElement>());
  const dailyTargets = useStore((s) => s.dailyTargets);
  const isToday = dateKey === todayKey;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSnapshot(null);

    getHistoryDaySnapshot(dateKey)
      .then((nextSnapshot) => {
        if (!cancelled) setSnapshot(nextSnapshot);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          void recoverGuestSession();
        }
        if (!cancelled) setError("當日詳情暫時載入失敗。請稍後再試。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateKey, recoverGuestSession]);

  useEffect(() => {
    if (!snapshot || !targetMealId) return;
    const node = mealRefs.current.get(targetMealId);
    if (!node) return;

    node.scrollIntoView({ block: "center" });
    setHighlightedMealId(targetMealId);
    const timer = window.setTimeout(() => setHighlightedMealId(null), 1400);
    return () => window.clearTimeout(timer);
  }, [snapshot, targetMealId]);

  const summary = snapshot?.summary;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[var(--sk-paper)]">
      <section className="sk-screen flex min-h-0 flex-1 flex-col">
        <SecondaryHeader title={formatDetailDate(dateKey)} backLabel="‹ 歷史" onBack={onBack} />
        <main className="screen-scroll-safe space-y-4 px-5 pt-2">
          <SketchSoftBox className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
                  {isToday ? "今天 · 即時" : "歷史快照"}
                </div>
                <h1 className="sk-heading mt-1 text-4xl leading-none">
                  {Math.round(summary?.totalCalories ?? 0).toLocaleString("en-US")}
                </h1>
                <p className="sk-body mt-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
                  {dailyTargets?.calories ? `目標 ${Math.round(dailyTargets.calories)} kcal` : "目標尚未設定"}
                </p>
              </div>
              <span className="sk-pill px-3 py-1 text-xs">{isToday ? "今天 · 即時" : "歷史快照"}</span>
            </div>
            <SketchDivider dashed className="my-4" />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
                  protein
                </div>
                <div className="sk-metric">{macroUnit(summary?.totalProtein ?? 0)}</div>
              </div>
              <div>
                <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
                  carbs
                </div>
                <div className="sk-metric">{macroUnit(summary?.totalCarbs ?? 0)}</div>
              </div>
              <div>
                <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
                  fat
                </div>
                <div className="sk-metric">{macroUnit(summary?.totalFat ?? 0)}</div>
              </div>
            </div>
            <p className="sk-body mt-4 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
              {isToday ? "今天的資料會隨記錄更新；此畫面只讀檢視。" : "這是歷史快照，不會覆蓋今天的即時狀態。"}
            </p>
          </SketchSoftBox>

          <div className="flex items-baseline justify-between px-1">
            <h2 className="sk-heading text-2xl">當日餐點</h2>
            <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
              {snapshot ? `${snapshot.meals.length} 筆` : ""}
            </span>
          </div>

          {loading ? (
            <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
              載入這天餐點中...
            </p>
          ) : null}
          {error ? (
            <SketchSoftBox className="p-4">
              <p className="sk-body text-sm">{error}</p>
            </SketchSoftBox>
          ) : null}
          {!loading && !error && snapshot?.meals.length === 0 ? (
            <SketchSoftBox className="p-4">
              <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
                這天還沒有餐點
              </p>
            </SketchSoftBox>
          ) : null}
          <div className="space-y-3">
            {snapshot?.meals.map((meal) => (
              <MealDetailRow
                key={meal.id}
                meal={meal}
                highlighted={highlightedMealId === meal.id}
                registerRef={(node) => {
                  if (node) mealRefs.current.set(meal.id, node);
                  else mealRefs.current.delete(meal.id);
                }}
              />
            ))}
          </div>
          <div className="sk-box-dashed p-4">
            <p className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
              {isToday ? "今天 · 即時；此頁仍維持只讀。" : "歷史日 read-only；要修改請回到對話用自然語言描述。"}
            </p>
          </div>
        </main>
      </section>
    </div>
  );
}
