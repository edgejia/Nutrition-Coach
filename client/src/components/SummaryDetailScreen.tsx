import { useEffect, useState } from "react";
import { deleteMeal, getDaySnapshot } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import {
  buildCalendarWeeks,
  getInitialSummaryDateKey,
  isHistoricalSummaryDate,
} from "../lib/summary-calendar.js";
import { useStore } from "../store.js";
import { Dashboard } from "./Dashboard.js";
import { MealTimeline } from "./MealTimeline.js";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

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

function shiftMonthKey(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  return formatLocalDate(new Date(year!, month! - 1 + delta, 1)).slice(0, 7);
}

export function SummaryDetailScreen() {
  const clearDevice = useStore((s) => s.clearDevice);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const liveSummary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const sending = useStore((s) => s.sending);
  const todayKey = formatLocalDate(new Date());
  const todayMonthKey = todayKey.slice(0, 7);
  const [selectedDateKey, setSelectedDateKey] = useState(() =>
    getInitialSummaryDateKey(formatLocalDate(new Date())),
  );
  const [visibleMonthKey, setVisibleMonthKey] = useState(() =>
    getInitialSummaryDateKey(formatLocalDate(new Date())).slice(0, 7),
  );
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof getDaySnapshot>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingMealId, setDeletingMealId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isReadOnly = isHistoricalSummaryDate(selectedDateKey, todayKey);

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
          clearDevice();
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
  }, [selectedDateKey, clearDevice]);

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
        clearDevice();
        return;
      }
      alert("刪除失敗，請再試一次。");
    } finally {
      setDeletingMealId(null);
    }
  }

  function handleSelectDate(dateKey: string) {
    if (dateKey > todayKey) {
      return;
    }

    setSelectedDateKey(dateKey);
    setVisibleMonthKey(dateKey.slice(0, 7));
  }

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
          onClick={() => setActiveScreen("home")}
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
            {isReadOnly ? "歷史快照" : "今天 · 即時"}
          </span>
          <span>{selectedDateLabel}</span>
        </div>
        {isReadOnly && (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
            {`你正在查看 ${selectedDateLabel}，今天的即時更新不會覆蓋這個畫面。`}
          </p>
        )}
      </div>

      <main className="flex-1 space-y-3 overflow-y-auto p-4">
        <section
          className="rounded-2xl p-3.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-med)",
          }}
        >
          <div className="mb-3 text-xs font-bold" style={{ color: "var(--text-2)" }}>
            選擇日期
          </div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setVisibleMonthKey((monthKey) => shiftMonthKey(monthKey, -1))}
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
              onClick={() => setVisibleMonthKey((monthKey) => shiftMonthKey(monthKey, 1))}
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
                    onClick={() => handleSelectDate(day.dateKey)}
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
              onDelete={handleDelete}
            />
          )}
        </div>
      </main>
    </div>
  );
}
