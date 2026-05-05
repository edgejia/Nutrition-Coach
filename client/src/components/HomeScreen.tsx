import { useEffect } from "react";
import { useStore } from "../store.js";
import { recordHomeCtaOptionSent } from "../api.js";
import { getCoachAdvice, getCoachCTA } from "../coach-advice.js";
import { createClientId } from "../lib/clientId.js";
import { formatLocalDate } from "../lib/time.js";
import { CoachAdviceCard } from "./CoachAdviceCard.js";
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
} from "../types.js";

export function getDisplayedCoachAdvice(
  storedAdvice: string | null,
  dailySummary: ReturnType<typeof useStore.getState>["dailySummary"],
  dailyTargets: ReturnType<typeof useStore.getState>["dailyTargets"],
) {
  return getCoachAdvice(dailySummary, dailyTargets) ?? storedAdvice;
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

export function getDisplayMealLabel(loggedAt?: string | null): "早餐" | "午餐" | "點心" | "晚餐" | "餐點" {
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

export function getMealMacroSummary(meal: Pick<MealEntry, "protein" | "carbs" | "fat">): string {
  return `P ${Math.max(0, Math.round(meal.protein ?? 0))} · C ${Math.max(0, Math.round(meal.carbs ?? 0))} · F ${Math.max(0, Math.round(meal.fat ?? 0))}`;
}

export function getMealBadge(loggedAt?: string | null): "B" | "L" | "S" | "D" | "M" {
  switch (getDisplayMealLabel(loggedAt)) {
    case "早餐":
      return "B";
    case "午餐":
      return "L";
    case "點心":
      return "S";
    case "晚餐":
      return "D";
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
      <SportIconButton
        onClick={() => {
          if (!sending) openSecondaryScreen("settings", "home");
        }}
        disabled={sending}
        aria-label="設定"
      >
        <SportSettingsIcon size={19} />
      </SportIconButton>
    </header>
  );
}

function CalorieHero({
  dailySummary,
  dailyTargets,
}: {
  dailySummary: DailySummary | null;
  dailyTargets: DailyTargets | null;
}) {
  const display = getHomeCalorieDisplay(dailySummary, dailyTargets);
  const macros = getHomeMacroDisplays(dailySummary, dailyTargets);

  return (
    <>
      <SportCard className="home-sport-hero" variant="glow">
        <div className="home-sport-hero-main">
          <div className="home-sport-calorie-copy">
            <div className="sp-label" style={{ marginBottom: 8 }}>
              今日熱量 · kcal
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="sp-display" style={{ fontSize: 72, color: "var(--sp-ink)" }}>
                {display.consumed.toLocaleString("en-US")}
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
            value={display.ringValue}
            accentTick
            label={
              <span className="home-sport-ring-label">
                <strong className="sp-display">{display.percent}</strong>
                <span className="sp-label">完成率</span>
              </span>
            }
            size={120}
            stroke={9}
          />
        </div>
      </SportCard>
      <div className="home-sport-macro-grid">
        {macros.map((macro) => (
          <SportCard key={macro.id} className="home-sport-macro-card" variant="flat">
            <div>
              <div className="home-sport-macro-label">{macro.label}</div>
              <div className="home-sport-macro-metric">{macro.metric}</div>
            </div>
            <div className="home-sport-macro-value">
              <span>{macro.current}</span>
              <small>/{macro.target}</small>
            </div>
            <SportProgressBar value={macro.progress} variant={macro.variant} />
            <div className="home-sport-macro-percent">{macro.percent}%</div>
          </SportCard>
        ))}
      </div>
    </>
  );
}

function MealRows({ meals, onEmptyChatClick }: { meals: MealEntry[]; onEmptyChatClick: () => void }) {
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
          {meals.map((meal) => (
            <article key={meal.id} className="home-sport-meal-row">
              <div className="home-sport-meal-badge">{getMealBadge(meal.loggedAt)}</div>
              <div className="home-sport-meal-main">
                <div className="home-sport-meal-meta">
                  <span>{formatMealRowTime(meal.loggedAt)}</span>
                  <span>{getDisplayMealLabel(meal.loggedAt)}</span>
                </div>
                <div className="home-sport-meal-title">{meal.foodName}</div>
                <div className="home-sport-meal-macros">{getMealMacroSummary(meal)}</div>
              </div>
              <div className="home-sport-meal-calories">
                <span>{Math.max(0, Math.round(meal.calories)).toLocaleString("en-US")}</span>
                <small>kcal</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function HomeScreen() {
  const dailySummary = useStore((s) => s.dailySummary);
  const dailyTargets = useStore((s) => s.dailyTargets);
  const storedCoachAdvice = useStore((s) => s.coachAdvice);
  const setCoachAdvice = useStore((s) => s.setCoachAdvice);
  const sending = useStore((s) => s.sending);
  const meals = useStore((s) => s.meals);
  const setPendingHomeChatDraft = useStore((s) => s.setPendingHomeChatDraft);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const coachAdvice = getDisplayedCoachAdvice(storedCoachAdvice, dailySummary, dailyTargets);
  const cta = getCoachCTA(dailySummary, dailyTargets);
  const emptyCopy = getHomeEmptyCoachCopy();

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
        <main className="screen-scroll home-sport-scroll">
          <CalorieHero dailySummary={dailySummary} dailyTargets={dailyTargets} />
          <CoachAdviceCard advice={coachAdvice} cta={cta} onTaskOptionClick={handleTaskOptionClick} disabled={sending} />
          <MealRows meals={meals} onEmptyChatClick={handleEmptyChatClick} />
        </main>
      </SportScreen>
    </div>
  );
}
