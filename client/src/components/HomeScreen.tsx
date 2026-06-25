import { Fragment, useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { recordHomeCtaOptionSent } from "../api.js";
import { getCoachAdvice, getCoachCTA } from "../coach-advice.js";
import { createClientId } from "../lib/clientId.js";
import { formatLocalDate } from "../lib/time.js";
import { buildMealEditPayloadIfComplete } from "../meal-edit-payload.js";
import { CoachAdviceCard } from "./CoachAdviceCard.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { PullToRefreshSurface } from "./PullToRefreshSurface.js";
import { SportFlameIcon, SportSettingsIcon } from "./SportIcons.js";
import { SportCard, SportIconButton, SportProgressBar, SportRing, SportScreen } from "./SportPrimitives.js";
import type {
  ActiveScreen,
  PendingHomeChatDraft,
  CoachCTAIntent,
  CoachCTATaskOption,
  DailySummary,
  DailyTargets,
  MealEntry,
  MealPeriod,
} from "../types.js";

export function getDisplayedCoachAdvice(
  storedAdvice: string | null,
  dailySummary: ReturnType<typeof useStore.getState>["dailySummary"],
  dailyTargets: ReturnType<typeof useStore.getState>["dailyTargets"],
  goal: string | null = null,
) {
  return getCoachAdvice(dailySummary, dailyTargets, goal) ?? storedAdvice;
}

export function formatHomeHeaderDate(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const fallbackDateKey = formatLocalDate(new Date());
  const [, yearText, monthText, dayText] = match ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(fallbackDateKey)!;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return new Date(year, month - 1, day).toLocaleDateString("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function getHomeGreeting(now: Date = new Date()): "早安" | "午安" | "晚安" {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return "早安";
  if (hour >= 11 && hour < 17) return "午安";
  return "晚安";
}

export function getDisplayMealLabel(
  mealPeriod?: MealPeriod | null,
  loggedAt?: string | null,
): "早餐" | "午餐" | "點心" | "晚餐" | "宵夜" | "餐點" {
  switch (mealPeriod) {
    case "breakfast":
      return "早餐";
    case "lunch":
      return "午餐";
    case "dinner":
      return "晚餐";
    case "late_night":
      return "宵夜";
  }

  if (!loggedAt) return "餐點";
  const date = new Date(loggedAt);
  if (Number.isNaN(date.getTime())) return "餐點";

  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "早餐";
  if (hour >= 11 && hour < 14) return "午餐";
  if (hour >= 14 && hour < 17) return "點心";
  if (hour >= 17 && hour < 23) return "晚餐";
  return "餐點";
}

export function formatMealRowTime(loggedAt: string): string {
  const date = new Date(loggedAt);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function getHomeCalorieDisplay(
  summary: Pick<DailySummary, "totalCalories"> | null,
  targets: Pick<DailyTargets, "calories"> | null,
) {
  const consumed = Math.max(0, Math.round(summary?.totalCalories ?? 0));
  const target = Math.max(0, Math.round(targets?.calories ?? 0));
  const remaining = Math.max(0, target - consumed);
  const ringValue = target > 0 ? Math.min(1, Math.round((consumed / target) * 100) / 100) : 0;
  const percent = Math.round(ringValue * 100);

  return { consumed, target, remaining, ringValue, percent };
}

function macroValue(value: number | undefined, target: number | undefined) {
  const current = Math.max(0, Math.round(value ?? 0));
  const safeTarget = Math.max(0, Math.round(target ?? 0));
  return {
    current,
    target: safeTarget,
    progress: safeTarget > 0 ? Math.min(1, current / safeTarget) : 0,
    percent: safeTarget > 0 ? Math.round(Math.min(1, current / safeTarget) * 100) : 0,
  };
}

export function getHomeMacroDisplays(
  summary: Pick<DailySummary, "totalProtein" | "totalCarbs" | "totalFat"> | null,
  targets: Pick<DailyTargets, "protein" | "carbs" | "fat"> | null,
) {
  return [
    {
      id: "protein" as const,
      label: "蛋白" as const,
      metric: "PROTEIN" as const,
      variant: "default" as const,
      ...macroValue(summary?.totalProtein, targets?.protein),
    },
    {
      id: "carbs" as const,
      label: "碳水" as const,
      metric: "CARBS" as const,
      variant: "cyan" as const,
      ...macroValue(summary?.totalCarbs, targets?.carbs),
    },
    {
      id: "fat" as const,
      label: "脂肪" as const,
      metric: "FAT" as const,
      variant: "amber" as const,
      ...macroValue(summary?.totalFat, targets?.fat),
    },
  ];
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useCountUpNumber(targetValue: number, options: { durationMs?: number; animate?: boolean; replayKey?: number } = {}) {
  const previousValueRef = useRef<number | null>(null);
  const previousReplayKeyRef = useRef<number | undefined>(options.replayKey);
  const frameRef = useRef<number | null>(null);
  const activeAnimationTargetRef = useRef<number | null>(null);
  const [displayValue, setDisplayValue] = useState(targetValue);
  const durationMs = options.durationMs ?? 450;
  const animate = options.animate === true;
  const replayChanged =
    options.replayKey !== undefined &&
    previousReplayKeyRef.current !== undefined &&
    previousReplayKeyRef.current !== options.replayKey;

  useEffect(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const previousValue = previousValueRef.current;
    if ((animate !== true && !replayChanged) || prefersReducedMotion() === true || previousValue === null) {
      activeAnimationTargetRef.current = null;
      previousValueRef.current = targetValue;
      previousReplayKeyRef.current = options.replayKey;
      setDisplayValue(targetValue);
      return;
    }

    const replayOffset = Math.max(1, Math.round(Math.abs(targetValue) * 0.08));
    const startValue = replayChanged && previousValue === targetValue
      ? Math.max(0, targetValue - replayOffset)
      : previousValue;
    let startTime: number | null = null;
    activeAnimationTargetRef.current = targetValue;

    const step = (timestamp: number) => {
      if (activeAnimationTargetRef.current !== targetValue) {
        return;
      }
      startTime ??= timestamp;
      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      setDisplayValue(Math.round(startValue + (targetValue - startValue) * progress));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
        return;
      }

      frameRef.current = null;
      activeAnimationTargetRef.current = null;
      previousValueRef.current = targetValue;
      previousReplayKeyRef.current = options.replayKey;
      setDisplayValue(targetValue);
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (activeAnimationTargetRef.current === targetValue) {
        activeAnimationTargetRef.current = null;
      }
    };
  }, [durationMs, options.replayKey, replayChanged, targetValue, animate]);

  return displayValue;
}

export function getMealMacroSummary(meal: Pick<MealEntry, "protein" | "carbs" | "fat">): string {
  return `P ${Math.max(0, Math.round(meal.protein ?? 0))} · C ${Math.max(0, Math.round(meal.carbs ?? 0))} · F ${Math.max(0, Math.round(meal.fat ?? 0))}`;
}

export function getMealBadge(mealPeriod?: MealPeriod | null, loggedAt?: string | null): "B" | "L" | "S" | "D" | "N" | "M" {
  switch (getDisplayMealLabel(mealPeriod, loggedAt)) {
    case "早餐":
      return "B";
    case "午餐":
      return "L";
    case "點心":
      return "S";
    case "晚餐":
      return "D";
    case "宵夜":
      return "N";
    default:
      return "M";
  }
}

export function getHomeEmptyCoachCopy() {
  return {
    headline: "還沒有紀錄",
    body: "到「對話」描述你吃了什麼，AI 會幫你整理今天第一餐。",
    actions: [{ label: "去對話記錄", prompt: "我想記錄今天第一餐，請一步步引導我。" }],
  };
}

export function stageHomeTaskOptionPrompt(
  prompt: string,
  setPendingHomeChatDraft: (draft: PendingHomeChatDraft | null) => void,
  setActiveScreen: (screen: ActiveScreen) => void,
  createId: () => string = () => createClientId("draft"),
) {
  setPendingHomeChatDraft({ id: createId(), text: prompt, status: "staged" });
  setActiveScreen("chat");
}

export function sendHomeCtaTaskOption(
  option: CoachCTATaskOption,
  intent: CoachCTAIntent,
  setPendingHomeChatDraft: (draft: PendingHomeChatDraft | null) => void,
  setActiveScreen: (screen: ActiveScreen) => void,
  createId: () => string = () => createClientId("cta"),
) {
  void recordHomeCtaOptionSent(intent.id, option.id);
  stageHomeTaskOptionPrompt(option.prompt, setPendingHomeChatDraft, setActiveScreen, createId);
}

export interface HomeScreenProps {
  onRefreshToday: () => void | Promise<void>;
  refreshingToday: boolean;
  refreshTodayError: string | null;
  refreshCueToken: number;
}

function HomeHeader() {
  const openSecondaryScreen = useStore((s) => s.openSecondaryScreen);
  const sending = useStore((s) => s.sending);
  const dailySummary = useStore((s) => s.dailySummary);
  const dateKey = dailySummary?.date ?? formatLocalDate(new Date());
  const dateStr = formatHomeHeaderDate(dateKey);
  const greeting = getHomeGreeting();
  const statusText =
    dailySummary === null
      ? "正在同步今天狀態"
      : dailySummary.mealCount > 0
        ? `今日已記錄 ${dailySummary.mealCount} 筆`
        : "準備記錄第一餐";

  return (
    <header className="screen-bar home-sport-header">
      <div>
        <div className="home-sport-title-row">
          <h1>嗨，{greeting}</h1>
          <span className="home-sport-streak">
            <SportFlameIcon size={12} /> {dailySummary?.mealCount ?? 0} 筆
          </span>
        </div>
        <div className="home-sport-subtitle">
          {dateStr} · {statusText}
        </div>
      </div>
      <div className="home-sport-header-actions">
        <SportIconButton
          onClick={() => {
            if (!sending) openSecondaryScreen("settings", "home");
          }}
          disabled={sending}
          aria-label="設定"
        >
          <SportSettingsIcon size={19} />
        </SportIconButton>
      </div>
    </header>
  );
}

function MacroCard({
  macro,
  refreshCueToken,
}: {
  macro: ReturnType<typeof getHomeMacroDisplays>[number];
  refreshCueToken: number;
}) {
  // Reuse the hero's count-up mechanism so each macro number replays on every refresh, even when the
  // value is unchanged (replayKey: refreshCueToken). The hook is called once per card at the top of
  // MacroCard so it stays at a stable position (never inside `.map`).
  const animatedCurrent = useCountUpNumber(macro.current, {
    durationMs: 450,
    animate: false,
    replayKey: refreshCueToken,
  });
  const animatedPercent = useCountUpNumber(macro.percent, {
    durationMs: 450,
    animate: false,
    replayKey: refreshCueToken,
  });

  return (
    <SportCard className="home-sport-macro-card" variant="flat">
      <div>
        <div className="home-sport-macro-label">{macro.label}</div>
        <div className="home-sport-macro-metric">{macro.metric}</div>
      </div>
      <div className="home-sport-macro-value">
        <span>{animatedCurrent}</span>
        <small>/{macro.target}</small>
      </div>
      <SportProgressBar value={macro.progress} variant={macro.variant} replayKey={refreshCueToken} />
      <div className="home-sport-macro-percent">{animatedPercent}%</div>
    </SportCard>
  );
}

function CalorieHero({
  dailySummary,
  dailyTargets,
  refreshCueToken,
}: {
  dailySummary: DailySummary | null;
  dailyTargets: DailyTargets | null;
  refreshCueToken: number;
}) {
  const display = getHomeCalorieDisplay(dailySummary, dailyTargets);
  const macros = getHomeMacroDisplays(dailySummary, dailyTargets);
  const previousConsumedRef = useRef<number | null>(null);
  const shouldAnimateConsumedChange =
    previousConsumedRef.current !== null && previousConsumedRef.current !== display.consumed;
  const animatedConsumed = useCountUpNumber(display.consumed, {
    durationMs: 450,
    animate: shouldAnimateConsumedChange,
    replayKey: refreshCueToken,
  });
  const animatedPercent = useCountUpNumber(display.percent, {
    durationMs: 450,
    animate: shouldAnimateConsumedChange,
    replayKey: refreshCueToken,
  });
  // Derive the ring from the animated percent so the arc replays together with the kcal number.
  const animatedRingValue = display.target > 0 ? Math.min(1, animatedPercent / 100) : display.ringValue;

  useEffect(() => {
    previousConsumedRef.current = display.consumed;
  }, [display.consumed]);

  const refreshCueClass = refreshCueToken > 0 ? " home-sport-refresh-cue" : "";

  return (
    <>
      <SportCard key={`home-hero-${refreshCueToken}`} className={`home-sport-hero${refreshCueClass}`} variant="glow">
        <div className="home-sport-hero-main">
          <div className="home-sport-calorie-copy">
            <div className="sp-label" style={{ marginBottom: 8 }}>
              今日熱量 · kcal
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="sp-display" style={{ fontSize: 72, color: "var(--sp-ink)" }}>
                {animatedConsumed.toLocaleString("en-US")}
              </span>
              <span className="sp-num" style={{ fontSize: 13, color: "var(--sp-ink-3)" }}>
                / {display.target.toLocaleString("en-US")}
              </span>
            </div>
            <div className="sp-label" style={{ marginTop: 4, fontSize: 9 }}>
              kcal
            </div>
            <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
              <span className="sp-num" style={{ fontSize: 13, color: "var(--sp-lime)" }}>
                {display.remaining.toLocaleString("en-US")}
              </span>
              <span className="sp-zh" style={{ fontSize: 12, color: "var(--sp-ink-2)" }}>
                kcal · 還能吃
              </span>
            </div>
          </div>
          <SportRing
            className="home-sport-ring"
            value={animatedRingValue}
            accentTick
            label={
              <span className="home-sport-ring-label">
                <strong className="sp-display">{animatedPercent}</strong>
                <span className="sp-label">完成率</span>
              </span>
            }
            size={120}
            stroke={9}
          />
        </div>
      </SportCard>
      <div className={`home-sport-macro-grid${refreshCueClass}`}>
        {macros.map((macro) => (
          <MacroCard key={macro.id} macro={macro} refreshCueToken={refreshCueToken} />
        ))}
      </div>
    </>
  );
}

function MealRowContent({ meal }: { meal: MealEntry }) {
  return (
    <>
      <span className="home-sport-meal-media">
        {meal.imageUrl ? (
          <PersistedAssetImage
            src={meal.imageUrl}
            alt={`${meal.foodName} 縮圖`}
            imgClassName="home-sport-meal-image"
            fallbackClassName="home-sport-meal-fallback"
          />
        ) : (
          <span role="img" aria-label={`${meal.foodName} 無照片`} className="home-sport-meal-fallback">
            無照片
          </span>
        )}
      </span>
      <span className="home-sport-meal-main">
        <span className="home-sport-meal-meta">
          <span>{formatMealRowTime(meal.loggedAt)}</span>
          <span>{getDisplayMealLabel(meal.mealPeriod, meal.loggedAt)}</span>
          <span>{getMealBadge(meal.mealPeriod, meal.loggedAt)}</span>
        </span>
        <span className="home-sport-meal-title">{meal.foodName}</span>
        <span className="home-sport-meal-macros">{getMealMacroSummary(meal)}</span>
      </span>
      <span className="home-sport-meal-calories">
        <span>{Math.max(0, Math.round(meal.calories)).toLocaleString("en-US")}</span>
        <small>kcal</small>
      </span>
    </>
  );
}

function MealRows({
  meals,
  todayDateKey,
  openMealEdit,
  onEmptyChatClick,
}: {
  meals: MealEntry[];
  todayDateKey: string;
  openMealEdit: ReturnType<typeof useStore.getState>["openMealEdit"];
  onEmptyChatClick: () => void;
}) {
  const emptyCopy = getHomeEmptyCoachCopy();

  return (
    <section className="home-sport-meal-section">
      <div className="home-sport-section-header">
        <h2>今日紀錄</h2>
        <span>{meals.length}筆</span>
      </div>
      {meals.length === 0 ? (
        <SportCard className="home-sport-empty">
          <h3>{emptyCopy.headline}</h3>
          <p>{emptyCopy.body}</p>
          <button type="button" className="home-sport-empty-action" onClick={onEmptyChatClick}>
            {emptyCopy.actions[0]?.label}
          </button>
        </SportCard>
      ) : (
        <div className="home-sport-meal-list">
          {meals.map((meal) => {
            const editPayload = buildMealEditPayloadIfComplete(meal, todayDateKey);

            return (
              <Fragment key={meal.id}>
                {editPayload ? (
                  <button
                    type="button"
                    className="home-sport-meal-row"
                    aria-label={`編輯 ${getDisplayMealLabel(meal.mealPeriod, meal.loggedAt)} ${meal.foodName}`}
                    onClick={() => {
                      openMealEdit(editPayload, "home");
                    }}
                  >
                    <MealRowContent meal={meal} />
                  </button>
                ) : (
                  <article key={meal.id} className="home-sport-meal-row">
                    <MealRowContent meal={meal} />
                  </article>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function HomeScreen({ onRefreshToday, refreshingToday, refreshTodayError, refreshCueToken }: HomeScreenProps) {
  const dailySummary = useStore((s) => s.dailySummary);
  const dailyTargets = useStore((s) => s.dailyTargets);
  const goal = useStore((s) => s.goal);
  const storedCoachAdvice = useStore((s) => s.coachAdvice);
  const setCoachAdvice = useStore((s) => s.setCoachAdvice);
  const sending = useStore((s) => s.sending);
  const meals = useStore((s) => s.meals);
  const openMealEdit = useStore((s) => s.openMealEdit);
  const setPendingHomeChatDraft = useStore((s) => s.setPendingHomeChatDraft);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const coachAdvice = getDisplayedCoachAdvice(storedCoachAdvice, dailySummary, dailyTargets, goal);
  const cta = getCoachCTA(dailySummary, dailyTargets, undefined, goal);
  const emptyCopy = getHomeEmptyCoachCopy();
  const todayDateKey = dailySummary?.date ?? formatLocalDate(new Date());

  useEffect(() => {
    setCoachAdvice(coachAdvice);
  }, [coachAdvice, setCoachAdvice]);

  function handleTaskOptionClick(option: CoachCTATaskOption, intent: CoachCTAIntent) {
    sendHomeCtaTaskOption(option, intent, setPendingHomeChatDraft, setActiveScreen);
  }

  function handleEmptyChatClick() {
    const prompt = emptyCopy.actions[0]?.prompt ?? "我想記錄今天第一餐，請一步步引導我。";
    stageHomeTaskOptionPrompt(prompt, setPendingHomeChatDraft, setActiveScreen);
  }

  return (
    <div className="screen-shell sk-screen">
      <SportScreen className="home-sport-screen">
        <HomeHeader />
        {refreshTodayError ? (
          <p className="home-sport-refresh-error" role="status">
            {refreshTodayError}
          </p>
        ) : null}
        <PullToRefreshSurface
          className="home-sport-pull-refresh"
          onRefresh={onRefreshToday}
          refreshing={refreshingToday}
          surfaceId="home"
          completionLabel="今日資料已更新"
          ariaLabel="下拉重新整理今日資料"
        >
          <main className="screen-scroll home-sport-scroll">
            <CalorieHero dailySummary={dailySummary} dailyTargets={dailyTargets} refreshCueToken={refreshCueToken} />
            <CoachAdviceCard advice={coachAdvice} cta={cta} onTaskOptionClick={handleTaskOptionClick} disabled={sending} />
            <MealRows meals={meals} todayDateKey={todayDateKey} openMealEdit={openMealEdit} onEmptyChatClick={handleEmptyChatClick} />
          </main>
        </PullToRefreshSurface>
      </SportScreen>
    </div>
  );
}
