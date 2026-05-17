import { useEffect, useState } from "react";
import { deleteMeal, getDaySnapshot, getMeals, MealRevisionConflictError } from "../api.js";
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
import { buildCalendarWeeks, getInitialSummaryDateKey, isHistoricalSummaryDate } from "../lib/summary-calendar.js";
import { getHistoryCalorieStatus, getHistorySportStatusMeta } from "../lib/history-week.js";
import { formatLocalDate } from "../lib/time.js";
import { refreshAfterMealMutation } from "../meal-edit-refresh.js";
import { useStore } from "../store.js";
import type { DailySummary, DailyTargets, MealEntry } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportCard, SportChip, SportIconButton, SportProgressBar, SportScreen } from "./SportPrimitives.js";
import { SportChevronLeftIcon } from "./SportIcons.js";

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
  onDeleteMeal: (meal: MealEntry) => void | Promise<void>;
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

function getChipVariant(variant: ReturnType<typeof getHistorySportStatusMeta>["chipVariant"]) {
  if (variant === "good") return "good";
  if (variant === "warn" || variant === "danger") return "warn";
  return "default";
}

function getProgressVariant(barTone: ReturnType<typeof getHistorySportStatusMeta>["barTone"]) {
  if (barTone === "amber") return "amber";
  if (barTone === "red") return "warn";
  return "default";
}

function formatSummaryTime(loggedAt: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(loggedAt));
}

function formatMacroLine(calories: number, protein: number, carbs: number, fat: number) {
  return `${Math.round(calories).toLocaleString("en-US")} kcal · P${Math.round(protein)} · C${Math.round(carbs)} · F${Math.round(fat)}`;
}

function SummaryDetailMealRow({
  meal,
  isReadOnly,
  onDelete,
  deletingMealId,
}: {
  meal: Awaited<ReturnType<typeof getDaySnapshot>>["meals"][number];
  isReadOnly: boolean;
  onDelete: (meal: MealEntry) => void | Promise<void>;
  deletingMealId: string | null;
}) {
  return (
    <article className="sp-summary-meal">
      <div className="sp-summary-meal-main">
        <PersistedAssetImage
          src={meal.imageUrl}
          alt={`${meal.foodName} 縮圖`}
          imgClassName="sp-summary-meal-image"
          fallbackClassName="sp-summary-meal-image sp-summary-meal-fallback"
          fallbackStyle={{
            background: "var(--sp-surface-2)",
            borderColor: "var(--sp-line)",
            color: "var(--sp-ink-2)",
          }}
        />
        <div className="sp-summary-meal-copy">
          <h3>{meal.foodName}</h3>
          <div className="sp-summary-meal-time">{formatSummaryTime(meal.loggedAt)}</div>
          <div className="sp-summary-meal-macro-line">{formatMacroLine(meal.calories, meal.protein, meal.carbs, meal.fat)}</div>
        </div>
      </div>
      {!isReadOnly && (
        <button
          type="button"
          onClick={() => onDelete(meal)}
          disabled={deletingMealId === meal.id}
          className="sp-summary-delete-btn"
        >
          刪除
        </button>
      )}
    </article>
  );
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
  const calRemaining = targets && displayedSummary ? Math.max(0, Math.round(targets.calories - displayedSummary.totalCalories)) : null;
  const statusLabel = getSummaryCalendarStatusLabel(isReadOnly);
  const toggleLabel = getSummaryCalendarToggleLabel(isCalendarOpen);
  const readOnlyHint = getSummaryCalendarReadOnlyHint(isReadOnly);
  const targetCalories = targets?.calories ?? null;
  const selectedDateLabel = formatSummaryDateLabel(selectedDateKey);
  const calendarWeeks = buildCalendarWeeks({ visibleMonthKey, selectedDateKey, todayKey });
  const calorieStatus = getHistoryCalorieStatus({
    calories: Math.max(0, Math.round(displayedSummary?.totalCalories ?? 0)),
    mealCount: displayedSummary?.mealCount ?? displayedMeals.length,
    targetCalories,
  });
  const statusMeta = getHistorySportStatusMeta({
    status: calorieStatus.status,
    targetCalories,
  });
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
    <div className="screen-shell">
      <SportScreen className="sp-summary-screen">
        <div className="screen-bar px-5 pb-3 pt-4">
          <header className="sp-summary-header">
            <SportIconButton onClick={onBack} disabled={sending} className="sp-summary-back" aria-label="返回主頁">
              <SportChevronLeftIcon size={18} stroke={2} />
              <span>返回主頁</span>
            </SportIconButton>
            <div className="sp-summary-header-copy">
              <h1>當日摘要</h1>
              <div>{statusLabel}</div>
            </div>
          </header>
        </div>

        <main className="screen-scroll-safe sp-summary-scroll">
        <SportCard className="sp-summary-calendar" variant="flat">
          <button
            type="button"
            className="sp-summary-calendar-trigger"
            onClick={onToggleCalendar}
            aria-controls="summary-calendar-panel"
            aria-expanded={isCalendarOpen}
          >
            <div className="sp-summary-calendar-status">
              <span>選擇日期</span>
              <span>{statusLabel}</span>
            </div>
            <div className="sp-summary-calendar-title">
              {selectedDateLabel}
            </div>
            {readOnlyHint ? <p className="sp-summary-calendar-hint">{readOnlyHint}</p> : null}
            <span aria-hidden="true" className={`sp-summary-calendar-chevron ${isCalendarOpen ? "is-open" : ""}`}>
              {toggleLabel}
            </span>
          </button>

          {isCalendarOpen ? (
            <div id="summary-calendar-panel" className="sp-summary-calendar-panel">
              <div className="sp-summary-calendar-month">
                <button type="button" onClick={() => onBrowseMonth(-1)} className="sp-summary-calendar-month-btn" aria-label="查看上個月">
                  ‹
                </button>
                <div>{formatSummaryMonthLabel(visibleMonthKey)}</div>
                <button
                  type="button"
                  onClick={() => onBrowseMonth(1)}
                  disabled={visibleMonthKey >= todayMonthKey}
                  className="sp-summary-calendar-month-btn"
                  aria-label="查看下個月"
                >
                  ›
                </button>
              </div>

              <div className="sp-summary-calendar-weekday">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>

              {calendarWeeks.map((week) => (
                <div key={week[0]!.dateKey} className="sp-summary-calendar-week">
                  {week.map((day) => (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => onSelectDate(day.dateKey)}
                      disabled={day.isFuture}
                      className="sp-summary-calendar-day"
                      data-selected={day.isSelected ? "true" : "false"}
                      data-today={day.isToday ? "true" : "false"}
                      aria-label={`選擇 ${formatSummaryDateLabel(day.dateKey)}`}
                    >
                      {day.dayNumber}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </SportCard>

        <section className="sp-summary-state-grid">
          <SportCard className="sp-summary-state-card" variant="flat">
            <div className="sp-summary-state-card-title">當日狀態</div>
            <p className="sp-summary-copy">
              {statusCopy}
              {displayedSummary ? <br /> : null}
              {displayedSummary
                ? isReadOnly
                  ? "這個畫面不會跟著今天的即時資料跳動。"
                  : "回到今天時會接回即時更新。"
                : null}
            </p>
          </SportCard>
          <SportCard className="sp-summary-state-card" variant="flat">
            <div className="sp-summary-state-card-title">當日備註</div>
            <p className="sp-summary-copy">{noteCopy}</p>
          </SportCard>
        </section>

        <SportCard className="sp-history-detail-summary sp-summary-overview" variant="glow">
          <div className="sp-history-detail-summary-main">
            <div className="sp-history-detail-summary-copy">
              <div className="sp-history-detail-kicker">{isReadOnly ? "歷史快照" : "今天 · 即時"}</div>
              <div className="sp-history-detail-calories">
                {Math.round(displayedSummary?.totalCalories ?? 0).toLocaleString("en-US")}
              </div>
              <p>
                {targetCalories
                  ? `${Math.round(displayedSummary?.totalCalories ?? 0).toLocaleString("en-US")} / ${Math.round(targets?.calories ?? 0).toLocaleString("en-US")} kcal`
                  : "目標同步中，暫不顯示水位"}
              </p>
            </div>
            <div className="sp-history-detail-summary-status">
              {statusMeta.badge ? <SportChip variant={getChipVariant(statusMeta.chipVariant)} zh>{statusMeta.badge}</SportChip> : null}
            </div>
          </div>
          <SportProgressBar
            className="sp-history-detail-progress"
            value={calorieStatus.waterLevel}
            variant={getProgressVariant(statusMeta.barTone)}
          />
          <div className="sp-history-detail-macros">
            <div>
              <span>protein</span>
              <strong>
                P {Math.round(displayedSummary?.totalProtein ?? 0).toLocaleString("en-US")}/{Math.round(targets?.protein ?? 0).toLocaleString("en-US")}
              </strong>
            </div>
            <div>
              <span>carbs</span>
              <strong>
                C {Math.round(displayedSummary?.totalCarbs ?? 0).toLocaleString("en-US")}/{Math.round(targets?.carbs ?? 0).toLocaleString("en-US")}
              </strong>
            </div>
            <div>
              <span>fat</span>
              <strong>
                F {Math.round(displayedSummary?.totalFat ?? 0).toLocaleString("en-US")}/{Math.round(targets?.fat ?? 0).toLocaleString("en-US")}
              </strong>
            </div>
          </div>
          <p className="sp-history-detail-note">
            {isReadOnly
              ? "這是當日營養快照；點選歷史中的餐點可修改內容。"
              : "今天的資料會隨記錄更新；此頁仍維持只讀檢視。"}
          </p>
        </SportCard>

        <section>
          <div className="sp-summary-section-header">
            <h2>當日餐點</h2>
            <span>{displayedMeals.length}筆</span>
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
          {!loading && !error && displayedMeals.length === 0 ? (
            <SportCard className="sp-history-detail-empty" variant="flat">
              {isReadOnly
                ? "這一天還沒有餐點紀錄。可以切回今天查看即時紀錄，或改看其他日期。"
                : "今天還沒有餐點紀錄。"}
            </SportCard>
          ) : null}
          {!loading && !error && displayedMeals.length > 0 ? (
            <div className="sp-summary-meal-list">
              {displayedMeals.map((meal) => (
                <SummaryDetailMealRow
                  key={meal.id}
                  meal={meal}
                  isReadOnly={isReadOnly}
                  onDelete={onDeleteMeal}
                  deletingMealId={deletingMealId}
                />
              ))}
            </div>
          ) : null}
        </section>
        </main>
      </SportScreen>
    </div>
  );
}

export function SummaryDetailScreen() {
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setMeals = useStore((s) => s.setMeals);
  const redactChatReceiptIdentity = useStore((s) => s.redactChatReceiptIdentity);
  const recordMealMutation = useStore((s) => s.recordMealMutation);
  const liveSummary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const sending = useStore((s) => s.sending);
  const lastMealMutation = useStore((s) => s.lastMealMutation);
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

  useEffect(() => {
    if (!lastMealMutation || lastMealMutation.affectedDate !== selectedDateKey) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

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
  }, [lastMealMutation?.affectedDate, lastMealMutation?.nonce, selectedDateKey, recoverGuestSession]);

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

  async function handleDelete(meal: MealEntry) {
    const mealId = meal.id;
    if (!meal.mealRevisionId) {
      alert("刪除失敗，請再試一次。");
      return;
    }
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
      const { affectedDate, dailySummary } = await deleteMeal(mealId, {
        expectedMealRevisionId: meal.mealRevisionId,
      });
      try {
        await refreshAfterMealMutation({
          redactChatReceiptIdentity,
          recordMealMutation,
          setDailySummary,
          getMeals,
          setMeals,
          todayKey: () => formatLocalDate(new Date()),
        }, {
          mealId,
          affectedDate,
          dailySummary,
        });
        const refreshedSnapshot = await getDaySnapshot(selectedDateKey);
        setSnapshot(refreshedSnapshot);
      } catch {
        recordMealMutation(affectedDate);
      }
    } catch (err) {
      if (err instanceof MealRevisionConflictError) {
        try {
          await refreshAfterMealMutation({
            redactChatReceiptIdentity,
            recordMealMutation,
            setDailySummary,
            getMeals,
            setMeals,
            todayKey: () => formatLocalDate(new Date()),
          }, {
            mealId: err.mealId,
            affectedDate: err.affectedDate,
          });
          const refreshedSnapshot = await getDaySnapshot(selectedDateKey);
          setSnapshot(refreshedSnapshot);
        } catch {
          recordMealMutation(err.affectedDate);
        }
        alert("餐點已被更新，未刪除。請重新載入最新餐點後再決定是否刪除。");
        return;
      }

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
    applyDisclosureState(currentState.isCalendarOpen ? closeSummaryCalendar(currentState) : openSummaryCalendar(currentState));
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
