import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHistoryDaySnapshot } from "../api.js";
import { getHistoryCalorieStatus, getHistorySportStatusMeta } from "../lib/history-week.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, MealEntry } from "../types.js";
import { formatMealRowTime, getDisplayMealLabel } from "./HomeScreen.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportChevronLeftIcon } from "./SportIcons.js";
import { SportCard, SportChip, SportIconButton, SportProgressBar, SportScreen } from "./SportPrimitives.js";

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

function macroPair(current: number, target: number | undefined) {
  return target && target > 0 ? `${Math.round(current)}/${Math.round(target)}` : `${Math.round(current)}`;
}

function getChipVariant(variant: ReturnType<typeof getHistorySportStatusMeta>["chipVariant"]) {
  if (variant === "good") return "good";
  if (variant === "warn" || variant === "danger") return "warn";
  return "default";
}

function getProgressVariant(tone: ReturnType<typeof getHistorySportStatusMeta>["barTone"]) {
  if (tone === "amber") return "amber";
  if (tone === "red") return "warn";
  if (tone === "muted") return "cyan";
  return "default";
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
      className={`sp-history-detail-meal${highlighted ? " sp-history-detail-highlight" : ""}`}
    >
      <div className="sp-history-detail-meal-main">
        <PersistedAssetImage
          src={meal.imageUrl}
          alt={`${meal.foodName} 縮圖`}
          imgClassName="sp-history-detail-meal-image"
          fallbackClassName="sp-history-detail-meal-image sp-history-detail-meal-fallback"
          fallbackStyle={{
            background: "var(--sp-surface-2)",
            borderColor: "var(--sp-line)",
            color: "var(--sp-ink-2)",
          }}
        />
        <div className="sp-history-detail-meal-copy">
          <h3>{meal.foodName}</h3>
          <div className="sp-history-detail-meal-time">
            {formatMealRowTime(meal.loggedAt)} · {getDisplayMealLabel(meal.mealPeriod, meal.loggedAt)}
          </div>
        </div>
        <div className="sp-history-detail-meal-energy">
          <span>{Math.round(meal.calories).toLocaleString("en-US")}</span>
          <small>kcal</small>
        </div>
      </div>
      <div className="sp-history-detail-meal-macros">
        <div>
          <span>蛋白質</span>
          <strong>{macroUnit(meal.protein)}</strong>
        </div>
        <div>
          <span>碳水</span>
          <strong>{macroUnit(meal.carbs)}</strong>
        </div>
        <div>
          <span>脂肪</span>
          <strong>{macroUnit(meal.fat)}</strong>
        </div>
      </div>
    </article>
  );
}

export function HistoryDayDetailScreen({ onBack }: { onBack: () => void }) {
  const secondaryScreen = useStore((s) => s.secondaryScreen);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const lastMealMutation = useStore((s) => s.lastMealMutation);
  const todayKey = useMemo(() => formatLocalDate(new Date()), []);
  const payload = secondaryScreen?.screen === "dayDetail" ? secondaryScreen.payload : undefined;
  const dateKey = payload?.dateKey ?? todayKey;
  const targetMealId = payload?.targetMealId;
  const payloadLabel = payload?.label;
  const [snapshot, setSnapshot] = useState<HistoryDaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedMealId, setHighlightedMealId] = useState<string | null>(targetMealId ?? null);
  const mealRefs = useRef(new Map<string, HTMLDivElement>());
  const loadTokenRef = useRef(0);
  const dailyTargets = useStore((s) => s.dailyTargets);
  const isToday = payloadLabel === "today-live" || dateKey === todayKey;

  const loadSnapshot = useCallback(
    (cancelledRef?: { current: boolean }) => {
      const requestDateKey = dateKey;
      const requestToken = loadTokenRef.current + 1;
      loadTokenRef.current = requestToken;
      const isCurrent = () => !cancelledRef?.current && loadTokenRef.current === requestToken;

      setLoading(true);
      setError(null);
      setSnapshot(null);

      return getHistoryDaySnapshot(requestDateKey)
        .then((nextSnapshot) => {
          if (isCurrent()) setSnapshot(nextSnapshot);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === "UNAUTHORIZED") {
            void recoverGuestSession();
          }
          if (isCurrent()) setError("當日詳情暫時載入失敗。請稍後再試。");
        })
        .finally(() => {
          if (isCurrent()) setLoading(false);
        });
    },
    [dateKey, recoverGuestSession],
  );

  useEffect(() => {
    const cancelledRef = { current: false };
    void loadSnapshot(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    if (!lastMealMutation || lastMealMutation?.affectedDate !== dateKey) {
      return;
    }

    const cancelledRef = { current: false };
    void loadSnapshot(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [dateKey, lastMealMutation?.affectedDate, lastMealMutation?.nonce, loadSnapshot]);

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
  const totalCalories = Math.round(summary?.totalCalories ?? 0);
  const targetCalories = dailyTargets?.calories ?? null;
  const calorieStatus = getHistoryCalorieStatus({
    calories: totalCalories,
    mealCount: summary?.mealCount ?? snapshot?.meals.length ?? 0,
    targetCalories,
  });
  const statusMeta = getHistorySportStatusMeta({
    status: calorieStatus.status,
    targetCalories,
  });

  return (
    <div className="absolute inset-0 z-40 flex flex-col">
      <SportScreen className="sp-history-detail-screen">
        <header className="sp-history-detail-header">
          <SportIconButton aria-label="返回歷史" className="sp-history-detail-back" onClick={onBack}>
            <SportChevronLeftIcon />
            <span>返回歷史</span>
          </SportIconButton>
          <div className="sp-history-detail-header-copy">
            <h1>{formatDetailDate(dateKey)}</h1>
            <div>{isToday ? "今天 · 即時" : "歷史快照"}</div>
          </div>
        </header>

        <main className="screen-scroll-safe sp-history-detail-scroll">
          <SportCard className="sp-history-detail-summary" variant="glow">
            <div className="sp-history-detail-summary-main">
              <div className="sp-history-detail-summary-copy">
                <div className="sp-history-detail-kicker">{isToday ? "今天 · 即時" : "歷史快照"}</div>
                <div className="sp-history-detail-calories">{totalCalories.toLocaleString("en-US")}</div>
                <p>
                  {targetCalories
                    ? `${totalCalories.toLocaleString("en-US")} / ${Math.round(targetCalories).toLocaleString("en-US")} kcal`
                    : "目標同步中，暫不顯示水位"}
                </p>
              </div>
              <div className="sp-history-detail-summary-status">
                {statusMeta.badge ? (
                  <SportChip variant={getChipVariant(statusMeta.chipVariant)} zh>
                    {statusMeta.badge}
                  </SportChip>
                ) : null}
              </div>
            </div>
            <SportProgressBar
              className="sp-history-detail-progress"
              value={calorieStatus.waterLevel}
              variant={getProgressVariant(statusMeta.barTone)}
            />
            <div className="sp-history-detail-macros">
              <div>
                <span>蛋白質</span>
                <strong>{macroPair(summary?.totalProtein ?? 0, dailyTargets?.protein)}</strong>
              </div>
              <div>
                <span>碳水</span>
                <strong>{macroPair(summary?.totalCarbs ?? 0, dailyTargets?.carbs)}</strong>
              </div>
              <div>
                <span>脂肪</span>
                <strong>{macroPair(summary?.totalFat ?? 0, dailyTargets?.fat)}</strong>
              </div>
            </div>
            <p className="sp-history-detail-note">
              {isToday
                ? "今天的資料會隨記錄更新；此頁仍維持只讀檢視。"
                : "這是當日營養快照；點選歷史中的餐點可修改內容。"}
            </p>
          </SportCard>

          <div className="sp-history-section-header">
            <h2>當日餐點</h2>
            <span>
              {snapshot ? `${snapshot.meals.length} 筆` : ""}
            </span>
          </div>

          {loading ? (
            <SportCard className="sp-history-detail-empty" variant="flat">
              載入這天餐點中...
            </SportCard>
          ) : null}
          {error ? (
            <SportCard className="sp-history-detail-error" variant="flat">
              {error}
            </SportCard>
          ) : null}
          {!loading && !error && snapshot?.meals.length === 0 ? (
            <SportCard className="sp-history-detail-empty" variant="flat">
              這天還沒有餐點
            </SportCard>
          ) : null}
          <div className="sp-history-detail-meal-list">
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
        </main>
      </SportScreen>
    </div>
  );
}
