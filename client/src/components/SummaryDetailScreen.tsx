import { useEffect, useState } from "react";
import { deleteMeal, getDaySnapshot } from "../api.js";
import {
  browseSummaryCalendarMonth,
  closeSummaryCalendar,
  getSummaryCalendarReadOnlyHint,
  getSummaryCalendarStatusLabel,
  getSummaryCalendarToggleLabel,
  openSummaryCalendar,
  selectSummaryCalendarDate,
  type SummaryCalendarDisclosureState,
} from "../lib/summary-calendar-disclosure.js";
import {
  buildCalendarWeeks,
  getInitialSummaryDateKey,
  isHistoricalSummaryDate,
} from "../lib/summary-calendar.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { DailySummary, DailyTargets } from "../types.js";
import { Dashboard } from "./Dashboard.js";
import { MealTimeline } from "./MealTimeline.js";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

interface SummaryDetailScreenPresentationProps {
  todayKey: string;
  selectedDateKey: string;
  visibleMonthKey: string;
  isCalendarOpen: boolean;
  liveSummary: DailySummary | null;
  targets: DailyTargets | null;
  snapshot: Awaited<ReturnType<typeof getDaySnapshot>> | null;
  loading: boolean;
  deletingMealId: string | null;
  error: string | null;
  sending: boolean;
  onBack: () => void;
  onToggleCalendar: () => void;
  onBrowseMonth: (delta: -1 | 1) => void;
  onSelectDate: (dateKey: string) => void;
  onDeleteMeal: (mealId: string) => void | Promise<void>;
}

function formatSummaryDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

function formatSummaryMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year!, month! - 1, 1).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
  });
}

export function SummaryDetailScreenPresentation(props: SummaryDetailScreenPresentationProps) {
  const {
    todayKey,
    selectedDateKey,
    visibleMonthKey,
    isCalendarOpen,
    liveSummary,
    targets,
    snapshot,
    loading,
    deletingMealId,
    error,
    sending,
    onBack,
    onToggleCalendar,
    onBrowseMonth,
    onSelectDate,
    onDeleteMeal,
  } = props;

  const todayMonthKey = todayKey.slice(0, 7);
  const isReadOnly = isHistoricalSummaryDate(selectedDateKey, todayKey);
  const displayedSummary = isReadOnly
    ? snapshot?.summary ?? null
    : liveSummary?.date === todayKey
      ? liveSummary
      : snapshot?.summary ?? null;
  const displayedMeals = snapshot?.meals ?? [];
  const calRemaining =
    targets && displayedSummary
      ? Math.max(0, Math.round(targets.calories - displayedSummary.totalCalories))
      : null;
  const selectedDateLabel = formatSummaryDateLabel(selectedDateKey);
  const calendarWeeks = buildCalendarWeeks({ visibleMonthKey, selectedDateKey, todayKey });
  const statusLabel = getSummaryCalendarStatusLabel(isReadOnly);
  const toggleLabel = getSummaryCalendarToggleLabel(isCalendarOpen);
  const readOnlyHint = getSummaryCalendarReadOnlyHint(isReadOnly);
  const statusCopy = displayedSummary
    ? isReadOnly
      ? `已記錄 ${displayedSummary.mealCount} 餐，總熱量 ${Math.round(displayedSummary.totalCalories)} kcal。`
      : calRemaining !== null
        ? `剩餘 ${calRemaining} kcal`
        : "計算中..."
    : "載入中...";
  const noteCopy = displayedSummary && targets
    ? isReadOnly
      ? displayedSummary.totalProtein < targets.protein * 0.8
        ? "這一天的蛋白質略低於目標，畫面維持只讀快照。"
        : "這一天的蛋白質達標，畫面維持只讀快照。"
      : displayedSummary.totalProtein < targets.protein * 0.8
        ? "蛋白質攝取仍需加強。"
        : "蛋白質攝取達標。"
    : "載入中...";

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <div className="shrink-0 px-5 pb-3 pt-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={onBack}
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
          當日摘要
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-2)" }}>
          <span
            className="rounded-full px-2.5 py-1 font-semibold"
            style={{
              background: isReadOnly ? "var(--bg-teal)" : "var(--bg-raised)",
              border: `1px solid ${isReadOnly ? "var(--teal-border)" : "var(--border-med)"}`,
              color: isReadOnly ? "var(--teal-text)" : "var(--text-2)",
            }}
          >
            {statusLabel}
          </span>
          <span>{selectedDateLabel}</span>
        </div>
      </div>

      <main className="flex-1 space-y-3 overflow-y-auto p-4">
        <section
          className="rounded-2xl p-3.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-med)",
          }}
        >
          <button
            type="button"
            onClick={onToggleCalendar}
            className="flex min-h-11 w-full items-start justify-between gap-3 text-left"
            aria-controls="summary-calendar-panel"
            aria-expanded={isCalendarOpen}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold" style={{ color: "var(--text-2)" }}>
                <span>選擇日期</span>
                <span
                  className="rounded-full px-2.5 py-1 font-semibold"
                  style={{
                    background: isReadOnly ? "var(--bg-teal)" : "var(--bg-raised)",
                    border: `1px solid ${isReadOnly ? "var(--teal-border)" : "var(--border-med)"}`,
                    color: isReadOnly ? "var(--teal-text)" : "var(--text-2)",
                  }}
                >
                  {statusLabel}
                </span>
              </div>
              <div
                className="mt-2 text-[20px] font-extrabold"
                style={{
                  color: "var(--text)",
                  fontFamily: "var(--font-display)",
                  lineHeight: 1.25,
                  letterSpacing: "-0.02em",
                }}
              >
                {selectedDateLabel}
              </div>
              {readOnlyHint && (
                <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
                  {readOnlyHint}
                </p>
              )}
            </div>
            <span
              className="ml-2 flex shrink-0 items-center gap-1 text-xs font-extrabold"
              style={{ color: "var(--text-2)" }}
            >
              <span>{toggleLabel}</span>
              <span
                aria-hidden="true"
                className={`transition-transform duration-150 motion-reduce:transition-none ${isCalendarOpen ? "rotate-180" : ""}`}
              >
                ⌄
              </span>
            </span>
          </button>

          {isCalendarOpen && (
            <div id="summary-calendar-panel" className="mt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onBrowseMonth(-1)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold"
                  style={{
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-med)",
                    color: "var(--text)",
                  }}
                  aria-label="查看上個月"
                >
                  ‹
                </button>
                <div
                  className="text-sm font-bold"
                  style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}
                >
                  {formatSummaryMonthLabel(visibleMonthKey)}
                </div>
                <button
                  type="button"
                  onClick={() => onBrowseMonth(1)}
                  disabled={visibleMonthKey >= todayMonthKey}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold disabled:opacity-40"
                  style={{
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-med)",
                    color: "var(--text)",
                  }}
                  aria-label="查看下個月"
                >
                  ›
                </button>
              </div>

              <div
                className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold"
                style={{ color: "var(--text-3)" }}
              >
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>

              <div className="space-y-1.5">
                {calendarWeeks.map((week) => (
                  <div key={week[0]!.dateKey} className="grid grid-cols-7 gap-1.5">
                    {week.map((day) => (
                      <button
                        key={day.dateKey}
                        type="button"
                        onClick={() => onSelectDate(day.dateKey)}
                        disabled={day.isFuture}
                        className="flex h-10 items-center justify-center rounded-xl text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35"
                        style={{
                          background: day.isSelected ? "var(--orange)" : "var(--bg-raised)",
                          border: day.isToday
                            ? "1px solid rgba(232,104,42,0.45)"
                            : "1px solid var(--border-med)",
                          color: day.isSelected ? "#fff" : day.isCurrentMonth ? "var(--text)" : "var(--text-3)",
                        }}
                        aria-label={`選擇 ${formatSummaryDateLabel(day.dateKey)}`}
                      >
                        {day.dayNumber}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-2 gap-2.5">
          <div
            className="rounded-2xl p-3.5"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-med)",
            }}
          >
            <div className="mb-1.5 text-xs font-bold" style={{ color: "var(--text)" }}>
              當日狀態
            </div>
            <div className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
              {statusCopy}
              {displayedSummary && (
                <>
                  <br />
                  {isReadOnly ? "這個畫面不會跟著今天的即時資料跳動。" : "回到今天時會接回即時更新。"}
                </>
              )}
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
              當日備註
            </div>
            <div className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
              {noteCopy}
            </div>
          </div>
        </div>

        <Dashboard
          summary={displayedSummary}
          targets={targets}
          ariaLabel={`查看 ${selectedDateLabel} 的營養詳情`}
        />

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
            當日餐點
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
            <MealTimeline
              meals={displayedMeals}
              deletingMealId={deletingMealId}
              isReadOnly={isReadOnly}
              onDelete={onDeleteMeal}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export function SummaryDetailScreen() {
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const liveSummary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const sending = useStore((s) => s.sending);
  const todayKey = formatLocalDate(new Date());
  const [selectedDateKey, setSelectedDateKey] = useState(() =>
    getInitialSummaryDateKey(formatLocalDate(new Date())),
  );
  const [visibleMonthKey, setVisibleMonthKey] = useState(() =>
    getInitialSummaryDateKey(formatLocalDate(new Date())).slice(0, 7),
  );
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof getDaySnapshot>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingMealId, setDeletingMealId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setSnapshot(null);

    getDaySnapshot(selectedDateKey)
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }

        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          void recoverGuestSession();
          return;
        }

        setError("這一天的摘要暫時載入失敗。請重新整理，或切回今天後再試一次。");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDateKey, recoverGuestSession]);

  function getDisclosureState(): SummaryCalendarDisclosureState {
    return {
      todayKey,
      selectedDateKey,
      visibleMonthKey,
      isCalendarOpen,
    };
  }

  function applyDisclosureState(nextState: SummaryCalendarDisclosureState) {
    setSelectedDateKey(nextState.selectedDateKey);
    setVisibleMonthKey(nextState.visibleMonthKey);
    setIsCalendarOpen(nextState.isCalendarOpen);
  }

  async function handleDelete(mealId: string) {
    const previousSnapshot = snapshot;
    setDeletingMealId(mealId);
    setSnapshot((currentSnapshot) =>
      currentSnapshot
        ? {
          ...currentSnapshot,
          meals: currentSnapshot.meals.filter((meal) => meal.id !== mealId),
        }
        : currentSnapshot,
    );

    try {
      await deleteMeal(mealId);
      const refreshedSnapshot = await getDaySnapshot(selectedDateKey);
      setSnapshot(refreshedSnapshot);
    } catch (err) {
      setSnapshot(previousSnapshot);
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
        return;
      }
      alert("刪除失敗，請再試一次。");
    } finally {
      setDeletingMealId(null);
    }
  }

  function handleToggleCalendar() {
    const currentState = getDisclosureState();
    applyDisclosureState(
      currentState.isCalendarOpen
        ? closeSummaryCalendar(currentState)
        : openSummaryCalendar(currentState),
    );
  }

  function handleBrowseMonth(delta: -1 | 1) {
    applyDisclosureState(browseSummaryCalendarMonth(getDisclosureState(), delta));
  }

  function handleSelectDate(dateKey: string) {
    const currentState = getDisclosureState();
    const nextState = selectSummaryCalendarDate(currentState, dateKey);

    if (nextState === currentState) {
      return;
    }

    applyDisclosureState(nextState);
  }

  return (
    <SummaryDetailScreenPresentation
      todayKey={todayKey}
      selectedDateKey={selectedDateKey}
      visibleMonthKey={visibleMonthKey}
      isCalendarOpen={isCalendarOpen}
      liveSummary={liveSummary}
      targets={targets}
      snapshot={snapshot}
      loading={loading}
      deletingMealId={deletingMealId}
      error={error}
      sending={sending}
      onBack={() => setActiveScreen("home")}
      onToggleCalendar={handleToggleCalendar}
      onBrowseMonth={handleBrowseMonth}
      onSelectDate={handleSelectDate}
      onDeleteMeal={handleDelete}
    />
  );
}
