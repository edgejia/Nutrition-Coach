import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { getHistoryDaySnapshot, getHistoryTrends } from "../api.js";
import {
  buildHistoryWeek,
  buildHistoryWeekStats,
  getHistorySportStatusMeta,
  getMondayWeekStart,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
  type HistorySportBarTone,
  type HistoryWeekDay,
} from "../lib/history-week.js";
import { formatLocalDate } from "../lib/time.js";
import { buildHistoryMealEditPayload } from "../meal-edit-payload.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, HistoryTrendResponse, MealEntry } from "../types.js";
import { formatMealRowTime, getMealMacroSummary } from "./HomeScreen.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportChevronLeftIcon, SportChevronRightIcon } from "./SportIcons.js";
import { SportCard, SportChip, SportIconButton, SportScreen } from "./SportPrimitives.js";

function addLocalDays(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + deltaDays);
  return formatLocalDate(date);
}

function formatHistoryDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatHistoryDateRange(fromKey: string, toKey: string): string {
  const formatPart = (dateKey: string) => {
    const [, month, day] = dateKey.split("-").map(Number);
    return `${month}/${day}`;
  };
  return `${formatPart(fromKey)} - ${formatPart(toKey)}`;
}

function historyErrorMessage(error: unknown): string {
  return error instanceof Error && error.message === "UNAUTHORIZED"
    ? "正在重新建立訪客狀態..."
    : "歷史資料暫時載入失敗。請稍後再試。";
}

function formatMetric(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function formatHistoryStatValue(value: number | null): string {
  return value === null ? "--" : formatMetric(value);
}

function getBarColor(tone: HistorySportBarTone): string {
  if (tone === "amber") return "var(--sp-amber)";
  if (tone === "lime") return "var(--sp-lime)";
  if (tone === "red") return "var(--sp-red)";
  return "var(--sp-ink-3)";
}

function getChipVariant(variant: ReturnType<typeof getHistorySportStatusMeta>["chipVariant"]) {
  if (variant === "good") return "good";
  if (variant === "warn" || variant === "danger") return "warn";
  return "default";
}

function HistoryWeekStrip({
  days,
  targetCalories,
  onSelect,
}: {
  days: HistoryWeekDay[];
  targetCalories: number | null;
  onSelect: (dateKey: string) => void;
}) {
  const hasTarget = Number(targetCalories) > 0;

  return (
    <div className="sp-history-week-strip" aria-label="週紀錄">
      {days.map((day) => {
        const meta = getHistorySportStatusMeta({ status: day.status, targetCalories });
        const fillHeight =
          day.calorieRatio === null || day.calories === null || day.waterLevel <= 0
            ? 0
            : Math.max(4, Math.round(Math.min(1, day.waterLevel) * 76));
        const showFill = fillHeight > 0 && !day.isFuture && day.status !== "targetMissing";

        return (
          <button
            key={day.dateKey}
            type="button"
            disabled={day.isFuture}
            onClick={() => onSelect(day.dateKey)}
            className="sp-history-week-day"
            data-bar-tone={meta.barTone}
            data-selected={day.isSelected ? "true" : "false"}
            data-today={day.isToday ? "true" : "false"}
            data-future={day.isFuture ? "true" : "false"}
          >
            <span className="sp-history-week-track">
              {hasTarget && !day.isFuture ? <span className="sp-history-target-marker" /> : null}
              {showFill ? (
                <span
                  className="sp-history-week-fill"
                  style={{
                    height: `${fillHeight}px`,
                    background: getBarColor(meta.barTone),
                  }}
                />
              ) : null}
            </span>
            <span className="sp-history-week-label">{day.weekday}</span>
            <span className="sp-history-week-number">{day.dayNumber}</span>
          </button>
        );
      })}
    </div>
  );
}

function HistoryStatGrid({ stats }: { stats: ReturnType<typeof buildHistoryWeekStats> }) {
  const items = [
    { label: "平均熱量", value: formatHistoryStatValue(stats.averageCalories), sublabel: "kcal/day" },
    {
      label: "達標天數",
      value: stats.inRangeDays === null || stats.loggedDays === null ? "--" : `${stats.inRangeDays}/${stats.loggedDays}`,
      sublabel: "days",
    },
    { label: "紀錄餐數", value: formatHistoryStatValue(stats.mealCount), sublabel: "entries" },
  ];

  return (
    <div className="sp-history-stat-grid">
      {items.map((item) => (
        <SportCard key={item.label} className="sp-history-stat-card" variant="flat">
          <div className="sp-history-stat-label">{item.label}</div>
          <div className="sp-history-stat-value">{item.value}</div>
          <div className="sp-history-stat-sublabel">{item.sublabel}</div>
        </SportCard>
      ))}
    </div>
  );
}

function SelectedDayHero({
  selectedDateKey,
  selectedDay,
  snapshot,
  targetCalories,
}: {
  selectedDateKey: string;
  selectedDay: HistoryWeekDay | undefined;
  snapshot: HistoryDaySnapshot | null;
  targetCalories: number | null;
}) {
  const pendingCalories = selectedDay?.calories === null;
  const consumedCalories = pendingCalories ? null : Math.max(0, Math.round(snapshot?.summary.totalCalories ?? 0));
  const meta = getHistorySportStatusMeta({
    status: selectedDay?.status ?? "empty",
    targetCalories,
  });
  const hasTarget = Number(targetCalories) > 0;
  const target = Math.max(0, Math.round(targetCalories ?? 0));
  const delta = consumedCalories === null ? null : consumedCalories - target;
  const deltaLabel =
    delta === null
      ? "--"
      : hasTarget
        ? `${delta >= 0 ? "+" : ""}${delta.toLocaleString("en-US")}`
        : "目標同步中";

  return (
    <SportCard className="sp-history-hero" variant="glow">
      <div className="sp-history-hero-main">
        <div className="sp-history-hero-copy">
          <div className="sp-history-hero-date">{formatHistoryDate(selectedDateKey)}</div>
          <div className="sp-history-hero-calories">
            {consumedCalories === null ? "--" : consumedCalories.toLocaleString("en-US")}
          </div>
          <div className="sp-history-hero-target">
            {hasTarget ? `/ ${target.toLocaleString("en-US")} kcal` : "目標同步中"}
          </div>
        </div>
        <div className="sp-history-hero-status">
          {meta.badge ? (
            <SportChip variant={getChipVariant(meta.chipVariant)} zh>
              {meta.badge}
            </SportChip>
          ) : null}
          <div className="sp-history-hero-delta" data-tone={meta.barTone}>
            {deltaLabel}
          </div>
          <div className="sp-history-hero-delta-label">vs target</div>
        </div>
      </div>
      {!hasTarget ? (
        <p className="sp-history-target-missing">目標同步中，暫不顯示目標比較。</p>
      ) : null}
    </SportCard>
  );
}

function TimelineRows({
  meals,
  selectedDateKey,
  todayKey,
  openDayDetail,
  openMealEdit,
}: {
  meals: MealEntry[];
  selectedDateKey: string;
  todayKey: string;
  openDayDetail: ReturnType<typeof useStore.getState>["openDayDetail"];
  openMealEdit: ReturnType<typeof useStore.getState>["openMealEdit"];
}) {
  const sortedMeals = [...meals].sort(
    (left, right) => new Date(left.loggedAt).getTime() - new Date(right.loggedAt).getTime(),
  );

  function onTimelineOpen(targetMealId?: string) {
    openDayDetail(
      {
        dateKey: selectedDateKey,
        targetMealId,
        label: selectedDateKey === todayKey ? "today-live" : "history-snapshot",
      },
      "history",
    );
  }

  function onMealOpen(meal: MealEntry) {
    openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history");
  }

  function handleTimelineKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onTimelineOpen();
    }
  }

  return (
    <div
      className="sp-history-timeline"
      role="button"
      tabIndex={0}
      aria-label="開啟當日詳情"
      onClick={() => onTimelineOpen()}
      onKeyDown={handleTimelineKeyDown}
    >
      {sortedMeals.map((meal) => (
        <div key={meal.id} className="sp-history-timeline-item">
          <span className="sp-history-timeline-node" aria-hidden="true" />
          <button
            type="button"
            className="sp-history-meal-row"
            aria-label={`編輯 ${meal.foodName}`}
            onClick={(event) => {
              event.stopPropagation();
              onMealOpen(meal);
            }}
          >
            <span className="sp-history-meal-media">
              {meal.imageUrl ? (
                <PersistedAssetImage
                  src={meal.imageUrl}
                  alt={`${meal.foodName} 縮圖`}
                  imgClassName="sp-history-meal-image"
                  fallbackClassName="sp-history-meal-fallback"
                />
              ) : (
                <span role="img" aria-label={`${meal.foodName} 無照片`} className="sp-history-meal-fallback">
                  無照片
                </span>
              )}
            </span>
            <span className="sp-history-meal-copy">
              <span className="sp-history-meal-meta">
                {formatMealRowTime(meal.loggedAt)}
              </span>
              <span className="sp-history-meal-name">{meal.foodName}</span>
              <span className="sp-history-meal-macros">{getMealMacroSummary(meal)}</span>
            </span>
            <span className="sp-history-meal-energy">
              <span>{Math.max(0, Math.round(meal.calories)).toLocaleString("en-US")}</span>
              <small>kcal</small>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function TimelinePanel({
  selectedDateKey,
  todayKey,
  snapshot,
  loadingDay,
  dayError,
  openDayDetail,
  openMealEdit,
}: {
  selectedDateKey: string;
  todayKey: string;
  snapshot: HistoryDaySnapshot | null;
  loadingDay: boolean;
  dayError: string | null;
  openDayDetail: ReturnType<typeof useStore.getState>["openDayDetail"];
  openMealEdit: ReturnType<typeof useStore.getState>["openMealEdit"];
}) {
  const meals = snapshot?.meals ?? [];

  return (
    <section>
      <div className="sp-history-section-header">
        <h2>當日餐點</h2>
        <span>{meals.length}筆</span>
      </div>

      {loadingDay ? (
        <SportCard className="sp-history-state-card" variant="flat">
          載入這天餐點中...
        </SportCard>
      ) : null}
      {dayError ? (
        <SportCard className="sp-history-state-card sp-history-state-error" variant="flat">
          {dayError}
        </SportCard>
      ) : null}
      {!loadingDay && !dayError && meals.length === 0 ? (
        <SportCard className="sp-history-empty" variant="flat">
          <h3>這天還沒有餐點</h3>
          <p>選擇其他日期，或到「對話」記錄今天吃了什麼。</p>
        </SportCard>
      ) : null}
      {!loadingDay && !dayError && meals.length > 0 ? (
        <TimelineRows
          meals={meals}
          selectedDateKey={selectedDateKey}
          todayKey={todayKey}
          openDayDetail={openDayDetail}
          openMealEdit={openMealEdit}
        />
      ) : null}
    </section>
  );
}

export function HistoryScreen() {
  const dailyTargets = useStore((s) => s.dailyTargets);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const openDayDetail = useStore((s) => s.openDayDetail);
  const openMealEdit = useStore((s) => s.openMealEdit);
  const lastMealMutation = useStore((s) => s.lastMealMutation);
  const todayKey = useMemo(() => formatLocalDate(new Date()), []);
  const [weekStartKey, setWeekStartKey] = useState(() => getMondayWeekStart(todayKey));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [trends, setTrends] = useState<HistoryTrendResponse | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<HistoryDaySnapshot | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);

  const weekEndKey = addLocalDays(weekStartKey, 6);
  const targetCalories = dailyTargets?.calories ?? null;
  const weekDays = buildHistoryWeek({
    weekStartKey,
    selectedDateKey,
    todayKey,
    trends: trends?.daily ?? [],
    targets: dailyTargets,
  });
  const selectedWeekDay = weekDays.find((day) => day.dateKey === selectedDateKey);
  const weekStats = buildHistoryWeekStats({
    days: weekDays,
    averageCalories: trends?.averages.calories ?? null,
  });
  const nextWeekStartKey = shiftHistoryWeek(weekStartKey, 1);
  const nextWeekIsFuture = nextWeekStartKey > todayKey;

  const loadTrends = useCallback(
    (cancelledRef?: { current: boolean }) => {
      setLoadingTrends(true);
      setTrendError(null);
      return getHistoryTrends(weekStartKey, weekEndKey)
        .then((response) => {
          if (!cancelledRef?.current) setTrends(response);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === "UNAUTHORIZED") {
            void recoverGuestSession();
          }
          if (!cancelledRef?.current) setTrendError(historyErrorMessage(error));
        })
        .finally(() => {
          if (!cancelledRef?.current) setLoadingTrends(false);
        });
    },
    [recoverGuestSession, weekEndKey, weekStartKey],
  );

  const loadSelectedDay = useCallback(
    (cancelledRef?: { current: boolean }) => {
      setLoadingDay(true);
      setDayError(null);
      setSelectedSnapshot(null);
      return getHistoryDaySnapshot(selectedDateKey)
        .then((response) => {
          if (!cancelledRef?.current) setSelectedSnapshot(response);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === "UNAUTHORIZED") {
            void recoverGuestSession();
          }
          if (!cancelledRef?.current) {
            setSelectedSnapshot(null);
            setDayError(historyErrorMessage(error));
          }
        })
        .finally(() => {
          if (!cancelledRef?.current) setLoadingDay(false);
        });
    },
    [recoverGuestSession, selectedDateKey],
  );

  useEffect(() => {
    const cancelledRef = { current: false };
    void loadTrends(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadTrends]);

  useEffect(() => {
    const cancelledRef = { current: false };
    void loadSelectedDay(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadSelectedDay]);

  useEffect(() => {
    if (!lastMealMutation || lastMealMutation.affectedDate !== selectedDateKey) {
      return;
    }

    const cancelledRef = { current: false };
    void Promise.all([loadSelectedDay(cancelledRef), loadTrends(cancelledRef)]);
    return () => {
      cancelledRef.current = true;
    };
  }, [lastMealMutation, loadSelectedDay, loadTrends, selectedDateKey]);

  function moveWeek(delta: -1 | 1) {
    const nextStart = shiftHistoryWeek(weekStartKey, delta);
    setWeekStartKey(nextStart);
    setSelectedDateKey(
      selectSameWeekdayOrClosestAvailable({
        nextWeekStartKey: nextStart,
        previousSelectedDateKey: selectedDateKey,
        todayKey,
      }),
    );
  }

  return (
    <div className="screen-shell">
      <SportScreen className="sp-history-screen">
        <header className="sp-history-header">
          <SportIconButton aria-label="查看上一週" onClick={() => moveWeek(-1)}>
            <SportChevronLeftIcon size={18} />
          </SportIconButton>
          <div className="sp-history-header-copy">
            <h1>本週</h1>
            <div>{formatHistoryDateRange(weekStartKey, weekEndKey)}</div>
          </div>
          <SportIconButton aria-label="查看下一週" onClick={() => moveWeek(1)} disabled={nextWeekIsFuture}>
            <SportChevronRightIcon size={18} />
          </SportIconButton>
        </header>

        <main className="screen-scroll-safe sp-history-scroll">
          {loadingTrends && !trends ? (
            <SportCard className="sp-history-state-card" variant="flat">
              載入這週紀錄中...
            </SportCard>
          ) : null}
          {trendError ? (
            <SportCard className="sp-history-state-card sp-history-state-error" variant="flat">
              {trendError}
            </SportCard>
          ) : null}

          <HistoryWeekStrip
            days={weekDays}
            targetCalories={targetCalories}
            onSelect={(dateKey) => {
              setSelectedDateKey(dateKey);
            }}
          />
          <HistoryStatGrid stats={weekStats} />
          <SelectedDayHero
            selectedDateKey={selectedDateKey}
            selectedDay={selectedWeekDay}
            snapshot={selectedSnapshot}
            targetCalories={targetCalories}
          />
          <TimelinePanel
            selectedDateKey={selectedDateKey}
            todayKey={todayKey}
            snapshot={selectedSnapshot}
            loadingDay={loadingDay}
            dayError={dayError}
            openDayDetail={openDayDetail}
            openMealEdit={openMealEdit}
          />
        </main>
      </SportScreen>
    </div>
  );
}
