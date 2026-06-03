import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { formatMealRowTime, getDisplayMealLabel, getMealMacroSummary } from "./HomeScreen.js";
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

const DAY_PENDING_COPY_DELAY_MS = 200;

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
      sublabel: "天",
    },
    { label: "紀錄餐數", value: formatHistoryStatValue(stats.mealCount), sublabel: "筆紀錄" },
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
  pending,
  cacheMiss,
}: {
  selectedDateKey: string;
  selectedDay: HistoryWeekDay | undefined;
  snapshot: HistoryDaySnapshot | null;
  targetCalories: number | null;
  pending: boolean;
  cacheMiss: boolean;
}) {
  const selectedDayCalories = selectedDay?.calories ?? null;
  const displayCalories = snapshot?.summary.totalCalories ?? selectedDayCalories;
  const pendingCalories = cacheMiss || displayCalories === null;
  const consumedCalories = pendingCalories ? null : Math.max(0, Math.round(displayCalories));
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
    <SportCard className={pending ? "sp-history-hero sp-history-pending" : "sp-history-hero"} variant="glow">
      <div className="sp-history-hero-main">
        <div className="sp-history-hero-copy">
          <div className="sp-history-hero-date">{formatHistoryDate(selectedDateKey)}</div>
          <div className="sp-history-hero-calories">
            <span className={cacheMiss ? "sp-history-value-placeholder" : undefined}>
              {consumedCalories === null ? "--" : consumedCalories.toLocaleString("en-US")}
            </span>
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
            aria-label={`編輯 ${getDisplayMealLabel(meal.mealPeriod, meal.loggedAt)} ${meal.foodName}`}
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
                {formatMealRowTime(meal.loggedAt)} · {getDisplayMealLabel(meal.mealPeriod, meal.loggedAt)}
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
  dayError,
  pending,
  confirmedEmptyDay,
  showInlineDayPending,
  openDayDetail,
  openConfirmedEmptyDayDetail,
  openMealEdit,
}: {
  selectedDateKey: string;
  todayKey: string;
  snapshot: HistoryDaySnapshot | null;
  dayError: string | null;
  pending: boolean;
  confirmedEmptyDay: boolean;
  showInlineDayPending: boolean;
  openDayDetail: ReturnType<typeof useStore.getState>["openDayDetail"];
  openConfirmedEmptyDayDetail: () => void;
  openMealEdit: ReturnType<typeof useStore.getState>["openMealEdit"];
}) {
  const meals = snapshot?.meals ?? [];
  const displayMealCount = snapshot === null ? null : meals.length;

  function handleConfirmedEmptyKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openConfirmedEmptyDayDetail();
    }
  }

  return (
    <section className={pending ? "sp-history-pending" : undefined}>
      <div className="sp-history-section-header">
        <h2>當日餐點</h2>
        <span>{displayMealCount === null ? "--" : displayMealCount}筆</span>
      </div>

      {showInlineDayPending ? (
        <SportCard className="sp-history-state-card" variant="flat">
          同步這天紀錄中...
        </SportCard>
      ) : null}
      {dayError ? (
        <SportCard className="sp-history-state-card sp-history-state-error" variant="flat">
          {dayError}
        </SportCard>
      ) : null}
      {!dayError && confirmedEmptyDay ? (
        <SportCard
          className="sp-history-empty"
          variant="flat"
          role="button"
          tabIndex={0}
          aria-label="開啟當日詳情"
          onClick={openConfirmedEmptyDayDetail}
          onKeyDown={handleConfirmedEmptyKeyDown}
          style={{ cursor: "pointer" }}
        >
          <h3>這天還沒有餐點</h3>
          <p>選擇其他日期，或到「對話」記錄今天吃了什麼。</p>
        </SportCard>
      ) : null}
      {!dayError && snapshot !== null && meals.length > 0 ? (
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
  const [trendsCache, setTrendsCache] = useState<Map<string, HistoryTrendResponse>>(() => new Map());
  const [dayCache, setDayCache] = useState<Map<string, HistoryDaySnapshot>>(() => new Map());
  const [trendError, setTrendError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);
  const [delayedInlineDayPending, setDelayedInlineDayPending] = useState(false);
  const inlineDayPendingTimerRef = useRef<number | null>(null);

  const weekEndKey = addLocalDays(weekStartKey, 6);
  const targetCalories = dailyTargets?.calories ?? null;
  const currentTrends = trendsCache.get(weekStartKey) ?? null;
  const hasCurrentWeekCache = currentTrends !== null;
  const selectedSnapshot = dayCache.get(selectedDateKey) ?? null;
  const hasSelectedDaySnapshot = selectedSnapshot !== null;
  const selectedDaySnapshotPending = selectedSnapshot === null && !dayError;
  const confirmedEmptyDay = selectedSnapshot !== null && selectedSnapshot.meals.length === 0;
  const showInlineDayPending = selectedDaySnapshotPending && loadingDay && !dayError && delayedInlineDayPending;
  const isWeekPending = loadingTrends && hasCurrentWeekCache;
  const weekDays = buildHistoryWeek({
    weekStartKey,
    selectedDateKey,
    todayKey,
    trends: currentTrends?.daily ?? [],
    targets: dailyTargets,
    pending: !hasCurrentWeekCache,
  });
  const selectedWeekDay = weekDays.find((day) => day.dateKey === selectedDateKey);
  const hasSelectedWeekDayDisplay =
    selectedWeekDay?.status !== "pending" && selectedWeekDay?.calories !== null && selectedWeekDay?.mealCount !== null;
  const hasSelectedDayDisplay = hasSelectedDaySnapshot || hasSelectedWeekDayDisplay;
  const isSelectedDayPending = loadingDay && hasSelectedDayDisplay;
  const isSelectedDayCacheMiss = !hasSelectedDayDisplay;
  const weekStats = buildHistoryWeekStats({
    days: weekDays,
    averageCalories: currentTrends?.averages.calories ?? null,
    pending: !hasCurrentWeekCache,
  });
  const nextWeekStartKey = shiftHistoryWeek(weekStartKey, 1);
  const nextWeekIsFuture = nextWeekStartKey > todayKey;
  const openConfirmedEmptyDayDetail = useCallback(() => {
    if (!confirmedEmptyDay) {
      return;
    }
    openDayDetail(
      {
        dateKey: selectedDateKey,
        label: selectedDateKey === todayKey ? "today-live" : "history-snapshot",
      },
      "history",
    );
  }, [confirmedEmptyDay, openDayDetail, selectedDateKey, todayKey]);

  const loadTrends = useCallback(
    (cancelledRef?: { current: boolean }) => {
      const requestWeekStartKey = weekStartKey;
      const requestWeekEndKey = weekEndKey;
      setLoadingTrends(true);
      setTrendError(null);
      return getHistoryTrends(requestWeekStartKey, requestWeekEndKey)
        .then((response) => {
          if (!cancelledRef?.current) {
            setTrendsCache((cache) => {
              const next = new Map(cache);
              next.set(requestWeekStartKey, response);
              return next;
            });
          }
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
      const requestDateKey = selectedDateKey;
      setLoadingDay(true);
      setDayError(null);
      return getHistoryDaySnapshot(requestDateKey)
        .then((response) => {
          if (!cancelledRef?.current) {
            setDayCache((cache) => {
              const next = new Map(cache);
              next.set(requestDateKey, response);
              return next;
            });
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === "UNAUTHORIZED") {
            void recoverGuestSession();
          }
          if (!cancelledRef?.current) {
            setDayCache((cache) => {
              const next = new Map(cache);
              next.delete(requestDateKey);
              return next;
            });
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
    if (inlineDayPendingTimerRef.current !== null) {
      window.clearTimeout(inlineDayPendingTimerRef.current);
      inlineDayPendingTimerRef.current = null;
    }

    if (!selectedDaySnapshotPending || !loadingDay || dayError) {
      setDelayedInlineDayPending(false);
      return;
    }

    setDelayedInlineDayPending(false);
    inlineDayPendingTimerRef.current = window.setTimeout(() => {
      inlineDayPendingTimerRef.current = null;
      setDelayedInlineDayPending(true);
    }, DAY_PENDING_COPY_DELAY_MS);

    return () => {
      if (inlineDayPendingTimerRef.current !== null) {
        window.clearTimeout(inlineDayPendingTimerRef.current);
        inlineDayPendingTimerRef.current = null;
      }
    };
  }, [dayError, loadingDay, selectedDateKey, selectedDaySnapshotPending]);

  useEffect(() => {
    if (!lastMealMutation) {
      return;
    }

    const affectedDate = lastMealMutation.affectedDate;
    const affectedWeekStartKey = getMondayWeekStart(affectedDate);
    setDayCache((cache) => {
      const next = new Map(cache);
      if (affectedDate !== selectedDateKey) {
        next.delete(affectedDate);
      }
      return next;
    });
    setTrendsCache((cache) => {
      const next = new Map(cache);
      if (affectedWeekStartKey !== weekStartKey) {
        next.delete(affectedWeekStartKey);
      }
      return next;
    });

    const shouldRefreshDay = affectedDate === selectedDateKey;
    const shouldRefreshWeek = affectedWeekStartKey === weekStartKey;
    if (!shouldRefreshDay && !shouldRefreshWeek) {
      return;
    }

    const cancelledRef = { current: false };
    void Promise.all([
      shouldRefreshDay ? loadSelectedDay(cancelledRef) : Promise.resolve(),
      shouldRefreshWeek ? loadTrends(cancelledRef) : Promise.resolve(),
    ]);
    return () => {
      cancelledRef.current = true;
    };
  }, [lastMealMutation, loadSelectedDay, loadTrends, selectedDateKey, weekStartKey]);

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
          {trendError ? (
            <SportCard className="sp-history-state-card sp-history-state-error" variant="flat">
              {trendError}
            </SportCard>
          ) : null}

          <div className={isWeekPending ? "sp-history-weekly sp-history-pending" : "sp-history-weekly"}>
            <HistoryWeekStrip
              days={weekDays}
              targetCalories={targetCalories}
              onSelect={(dateKey) => {
                setSelectedDateKey(dateKey);
              }}
            />
            <HistoryStatGrid stats={weekStats} />
          </div>
          <SelectedDayHero
            selectedDateKey={selectedDateKey}
            selectedDay={selectedWeekDay}
            snapshot={selectedSnapshot}
            targetCalories={targetCalories}
            pending={isSelectedDayPending}
            cacheMiss={isSelectedDayCacheMiss}
          />
          <TimelinePanel
            selectedDateKey={selectedDateKey}
            todayKey={todayKey}
            snapshot={selectedSnapshot}
            dayError={dayError}
            pending={isSelectedDayPending || showInlineDayPending}
            confirmedEmptyDay={confirmedEmptyDay}
            showInlineDayPending={showInlineDayPending}
            openDayDetail={openDayDetail}
            openConfirmedEmptyDayDetail={openConfirmedEmptyDayDetail}
            openMealEdit={openMealEdit}
          />
        </main>
      </SportScreen>
    </div>
  );
}
