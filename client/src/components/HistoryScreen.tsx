import { useEffect, useMemo, useState } from "react";
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
        const statusHeight = day.status === "empty" ? "12px" : `${Math.max(14, Math.min(44, day.calories / 55))}px`;
        return (
          <button
            key={day.dateKey}
            type="button"
            disabled={day.isFuture}
            onClick={() => onSelect(day.dateKey)}
            className="min-w-0 rounded-md px-1 py-2 text-center disabled:cursor-not-allowed"
            data-status={day.status}
            data-selected={day.isSelected ? "true" : "false"}
            style={{
              minHeight: 90,
              opacity: day.isFuture ? 0.34 : 1,
              background: day.isSelected
                ? "var(--sk-accent-soft)"
                : day.isToday
                  ? "var(--sk-paper-warm)"
                  : "transparent",
              border: day.isSelected ? "2px solid var(--sk-ink)" : "1px solid var(--sk-ink-faint)",
              boxShadow: day.isSelected ? "1px 2px 0 var(--sk-ink)" : "none",
            }}
          >
            <div className="sk-body text-[10px]" style={{ color: "var(--sk-ink-soft)" }}>
              {day.weekday}
            </div>
            <div className="mt-1 flex h-11 items-end justify-center">
              <span
                aria-hidden="true"
                className="block w-5 rounded-sm"
                style={{
                  height: statusHeight,
                  minHeight: day.status === "empty" ? 10 : undefined,
                  background:
                    day.status === "overTarget"
                      ? "var(--sk-accent)"
                      : day.status === "normal"
                        ? "var(--sk-ink)"
                        : "transparent",
                  border: day.status === "empty" ? "1px dashed var(--sk-ink-faint)" : "none",
                }}
              />
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

function SelectedDaySummary({
  selectedDateKey,
  todayKey,
  snapshot,
  targetCalories,
}: {
  selectedDateKey: string;
  todayKey: string;
  snapshot: HistoryDaySnapshot | null;
  targetCalories: number | null;
}) {
  const isToday = selectedDateKey === todayKey;
  const total = Math.round(snapshot?.summary.totalCalories ?? 0);
  return (
    <SketchSoftBox className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="sk-heading text-2xl">{formatHistoryDate(selectedDateKey)}</h2>
          <p className="sk-body mt-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
            {isToday ? "今天的資料會隨記錄更新；此畫面只讀檢視。" : "這是歷史快照，不會覆蓋今天的即時狀態。"}
          </p>
        </div>
        <span
          className="sk-pill shrink-0 px-3 py-1 text-xs"
          style={{ background: isToday ? "var(--sk-paper-warm)" : "var(--sk-accent-soft)" }}
        >
          {isToday ? "今天 · 即時" : "歷史快照"}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="sk-heading text-4xl leading-none">{total.toLocaleString("en-US")}</div>
          <div className="sk-body mt-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
            {targetCalories ? `目標 ${Math.round(targetCalories)} kcal` : "尚未設定目標"}
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
  return (
    <div className="space-y-3">
      {meals.map((meal) => (
        <button
          key={meal.id}
          type="button"
          onClick={() =>
            openDayDetail(
              {
                dateKey: selectedDateKey,
                targetMealId: meal.id,
                label: selectedDateKey === todayKey ? "today-live" : "history-snapshot",
              },
              "history",
            )
          }
          className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left"
          style={{
            background: "var(--sk-paper)",
            border: "2px solid var(--sk-ink)",
            boxShadow: "1px 2px 0 var(--sk-ink)",
          }}
        >
          <span className="min-w-0">
            <span className="sk-body block text-xs" style={{ color: "var(--sk-ink-soft)" }}>
              {formatMealRowTime(meal.loggedAt)} · {getDisplayMealLabel(meal.loggedAt)}
            </span>
            <span className="sk-heading block truncate text-xl">{meal.foodName}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="sk-heading text-2xl">{Math.round(meal.calories)}</span>
            <span aria-hidden="true" className="text-sm" style={{ color: "var(--sk-ink-faint)" }}>
              &gt;
            </span>
          </span>
        </button>
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
