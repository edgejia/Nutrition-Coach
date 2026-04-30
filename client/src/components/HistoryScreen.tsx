import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { getHistoryDaySnapshot, getHistoryTrends } from "../api.js";
import {
  buildHistoryWeek,
  getMondayWeekStart,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
  type HistoryWeekDay,
} from "../lib/history-week.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { HistoryDaySnapshot, HistoryTrendResponse, MealEntry } from "../types.js";
import { getDisplayMealLabel, formatMealRowTime } from "./HomeScreen.js";
import { SketchDivider, SketchSoftBox } from "./SketchPrimitives.js";

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

function historyErrorMessage(error: unknown): string {
  return error instanceof Error && error.message === "UNAUTHORIZED"
    ? "正在重新建立訪客狀態..."
    : "歷史資料暫時載入失敗。請稍後再試。";
}

function HistoryWeekStrip({
  days,
  onSelect,
}: {
  days: HistoryWeekDay[];
  onSelect: (dateKey: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1" aria-label="週紀錄">
      {days.map((day) => {
        const calorieStatus = day.status;
        const fillHeight = `${Math.round(day.waterLevel * 100)}%`;
        const showFill = day.waterLevel > 0 && !day.isFuture && calorieStatus !== "targetMissing";
        return (
          <button
            key={day.dateKey}
            type="button"
            disabled={day.isFuture}
            onClick={() => onSelect(day.dateKey)}
            className="history-week-day min-w-0 text-center disabled:cursor-not-allowed"
            data-calorie-status={calorieStatus}
            data-over-tolerance={day.isOverTolerance ? "true" : "false"}
            data-selected={day.isSelected ? "true" : "false"}
            data-today={day.isToday ? "true" : "false"}
            data-future={day.isFuture ? "true" : "false"}
          >
            <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
              {day.weekday}
            </div>
            <div className="history-week-water-box mt-1" aria-hidden="true">
              {showFill ? (
                <span
                  className="history-week-water-fill"
                  style={{
                    height: fillHeight,
                    background: day.isOverTolerance ? "var(--sk-accent)" : "var(--sk-ink)",
                  }}
                />
              ) : null}
            </div>
            <div className="sk-metric mt-1 text-sm">{day.dayNumber}</div>
            {day.isToday ? (
              <div className="sk-body mt-0.5 text-[10px]" style={{ color: "var(--sk-accent)" }}>
                今天
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function calorieStatusCopy(status: HistoryWeekDay["status"], total: number, targetCalories: number | null) {
  if (!targetCalories || targetCalories <= 0) return "目標同步中，暫不顯示水位";
  const delta = Math.round(total - targetCalories);
  if (status === "low") return `偏低 -${Math.abs(delta).toLocaleString("en-US")}`;
  if (status === "slightlyLow") return `略低 -${Math.abs(delta).toLocaleString("en-US")}`;
  if (status === "over") return `超標 +${Math.max(0, delta).toLocaleString("en-US")}`;
  if (status === "highOver") return `明顯超標 +${Math.max(0, delta).toLocaleString("en-US")}`;
  return "達標範圍";
}

function SelectedDaySummary({
  selectedDateKey,
  todayKey,
  snapshot,
  targetCalories,
  selectedDay,
}: {
  selectedDateKey: string;
  todayKey: string;
  snapshot: HistoryDaySnapshot | null;
  targetCalories: number | null;
  selectedDay: HistoryWeekDay | undefined;
}) {
  const isToday = selectedDateKey === todayKey;
  const total = Math.round(snapshot?.summary.totalCalories ?? 0);
  const status = selectedDay?.status ?? "empty";
  return (
    <SketchSoftBox className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="sk-heading text-2xl">{formatHistoryDate(selectedDateKey)}</h2>
          <p className="sk-body mt-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
            {targetCalories
              ? `${total.toLocaleString("en-US")} / ${Math.round(targetCalories).toLocaleString("en-US")} kcal`
              : "目標同步中，暫不顯示水位"}
          </p>
        </div>
        <span
          className="sk-pill shrink-0 px-3 py-1 text-xs"
          style={{ background: isToday ? "var(--sk-paper-warm)" : "var(--sk-accent-soft)" }}
        >
          {isToday ? "今天 · 即時" : "歷史快照"}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="sk-heading text-4xl leading-none">{total.toLocaleString("en-US")}</div>
          <div className="sk-body mt-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
            {calorieStatusCopy(status, total, targetCalories)}
          </div>
        </div>
        <div className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
          {snapshot ? `${snapshot.summary.mealCount} 筆` : "同步中"}
        </div>
      </div>
    </SketchSoftBox>
  );
}

function TimelineRows({
  meals,
  selectedDateKey,
  todayKey,
  openDayDetail,
}: {
  meals: MealEntry[];
  selectedDateKey: string;
  todayKey: string;
  openDayDetail: ReturnType<typeof useStore.getState>["openDayDetail"];
}) {
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
    openDayDetail(
      {
        dateKey: selectedDateKey,
        targetMealId: meal.id,
        label: selectedDateKey === todayKey ? "today-live" : "history-snapshot",
      },
      "history",
    );
  }

  function handleTimelineKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onTimelineOpen();
    }
  }

  return (
    <div
      className="history-timeline"
      role="button"
      tabIndex={0}
      aria-label="開啟當日詳情"
      onClick={() => onTimelineOpen()}
      onKeyDown={handleTimelineKeyDown}
    >
      {meals.map((meal, index) => (
        <div
          key={meal.id}
          className="history-timeline-row"
          data-first={index === 0 ? "true" : "false"}
          data-last={index === meals.length - 1 ? "true" : "false"}
        >
          <div className="history-timeline-time sk-metric">{formatMealRowTime(meal.loggedAt)}</div>
          <div className="history-timeline-track" aria-hidden="true">
            <span className="history-timeline-rail" />
            <span className="history-timeline-node" />
          </div>
          <button
            type="button"
            className="history-timeline-meal"
            onClick={(event) => {
              event.stopPropagation();
              onMealOpen(meal);
            }}
          >
            <span className="min-w-0">
              <span className="sk-body block text-[11px]" style={{ color: "var(--sk-ink-soft)" }}>
                {getDisplayMealLabel(meal.loggedAt)}
              </span>
              <span className="sk-heading block truncate text-xl">{meal.foodName}</span>
            </span>
            <span className="sk-heading shrink-0 text-2xl">{Math.round(meal.calories)}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function HistoryScreen() {
  const dailyTargets = useStore((s) => s.dailyTargets);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const openDayDetail = useStore((s) => s.openDayDetail);
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
  const weekDays = buildHistoryWeek({
    weekStartKey,
    selectedDateKey,
    todayKey,
    trends: trends?.daily ?? [],
    targets: dailyTargets,
  });
  const selectedWeekDay = weekDays.find((day) => day.dateKey === selectedDateKey);
  const nextWeekStartKey = shiftHistoryWeek(weekStartKey, 1);
  const nextWeekIsFuture = nextWeekStartKey > todayKey;

  useEffect(() => {
    let cancelled = false;
    setLoadingTrends(true);
    setTrendError(null);
    getHistoryTrends(weekStartKey, weekEndKey)
      .then((response) => {
        if (!cancelled) setTrends(response);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          void recoverGuestSession();
        }
        if (!cancelled) setTrendError(historyErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingTrends(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recoverGuestSession, weekEndKey, weekStartKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDay(true);
    setDayError(null);
    getHistoryDaySnapshot(selectedDateKey)
      .then((response) => {
        if (!cancelled) setSelectedSnapshot(response);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          void recoverGuestSession();
        }
        if (!cancelled) {
          setSelectedSnapshot(null);
          setDayError(historyErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDay(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recoverGuestSession, selectedDateKey]);

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
    <div className="screen-shell sk-screen">
      <header className="sk-screen-header">
        <button type="button" aria-label="查看上一週" onClick={() => moveWeek(-1)} className="sk-heading text-xl">
          ‹
        </button>
        <h1 className="sk-heading text-xl">歷史</h1>
        <button
          type="button"
          aria-label="查看下一週"
          onClick={() => moveWeek(1)}
          disabled={nextWeekIsFuture}
          className="sk-heading text-xl disabled:opacity-30"
        >
          ›
        </button>
      </header>
      <main className="screen-scroll-safe space-y-4 px-5 pt-2">
        {loadingTrends ? (
          <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
            載入這週紀錄中...
          </p>
        ) : null}
        {trendError ? (
          <SketchSoftBox className="p-3">
            <p className="sk-body text-sm">{trendError}</p>
          </SketchSoftBox>
        ) : null}
        <HistoryWeekStrip
          days={weekDays}
          onSelect={(dateKey) => {
            setSelectedDateKey(dateKey);
          }}
        />
        <SketchDivider dashed />
        <SelectedDaySummary
          selectedDateKey={selectedDateKey}
          todayKey={todayKey}
          snapshot={selectedSnapshot}
          targetCalories={dailyTargets?.calories ?? null}
          selectedDay={selectedWeekDay}
        />
        <div className="flex items-baseline justify-between px-1">
          <h2 className="sk-heading text-2xl">當日餐點</h2>
          <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
            {selectedSnapshot ? `${selectedSnapshot.meals.length} 筆` : ""}
          </span>
        </div>
        {loadingDay ? (
          <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
            載入這天餐點中...
          </p>
        ) : null}
        {dayError ? (
          <SketchSoftBox className="p-3">
            <p className="sk-body text-sm">{dayError}</p>
          </SketchSoftBox>
        ) : null}
        {!loadingDay && !dayError && selectedSnapshot?.meals.length === 0 ? (
          <SketchSoftBox className="p-4">
            <h3 className="sk-heading text-xl">這天還沒有餐點</h3>
            <p className="sk-body mt-2 text-sm" style={{ color: "var(--sk-ink-soft)" }}>
              到「對話」描述你吃了什麼，AI 會幫你記錄。
            </p>
          </SketchSoftBox>
        ) : null}
        {selectedSnapshot && selectedSnapshot.meals.length > 0 ? (
          <TimelineRows
            meals={selectedSnapshot.meals}
            selectedDateKey={selectedDateKey}
            todayKey={todayKey}
            openDayDetail={openDayDetail}
          />
        ) : null}
      </main>
    </div>
  );
}
