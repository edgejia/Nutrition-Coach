import { useEffect } from "react";
import { useStore } from "../store.js";
import { recordHomeCtaOptionSent } from "../api.js";
import { getCoachAdvice, getCoachCTA } from "../coach-advice.js";
import { formatLocalDate } from "../lib/time.js";
import { CoachAdviceCard } from "./CoachAdviceCard.js";
import { SettingsIcon } from "./SketchIcons.js";
import { SketchDivider, SketchProgressBar, SketchRing, SketchSoftBox } from "./SketchPrimitives.js";
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

  return { consumed, remaining, ringValue };
}

export function getHomeEmptyCoachCopy() {
  return {
    headline: "先用對話記下第一餐",
    body: "今天還沒有紀錄。到「對話」描述你吃了什麼。",
    actions: [
      { label: "記錄早餐", prompt: "我想記錄早餐，請一步步引導我。" },
      { label: "估算剛吃的", prompt: "幫我估算剛剛這餐的熱量與營養。" },
      { label: "問晚餐建議", prompt: "如果今天還沒記錄，晚餐可以怎麼安排？" },
    ],
  };
}

export function stageHomeTaskOptionPrompt(
  prompt: string,
  setPendingHomeChatDraft: (draft: PendingHomeChatDraft | null) => void,
  setActiveScreen: (screen: ActiveScreen) => void,
  createId: () => string = () => crypto.randomUUID(),
) {
  setPendingHomeChatDraft({ id: createId(), text: prompt, status: "staged" });
  setActiveScreen("chat");
}

export function sendHomeCtaTaskOption(
  option: CoachCTATaskOption,
  intent: CoachCTAIntent,
  setPendingHomeChatDraft: (draft: PendingHomeChatDraft | null) => void,
  setActiveScreen: (screen: ActiveScreen) => void,
  createId: () => string = () => crypto.randomUUID(),
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
  const statusText =
    dailySummary === null
      ? "正在同步今天狀態"
      : dailySummary.mealCount > 0
        ? `今日已記錄 ${dailySummary.mealCount} 筆`
        : "準備記錄第一餐";

  return (
    <div className="screen-bar flex items-center justify-between px-7 pb-3 pt-6">
      <div>
        <span
          className="sk-heading text-3xl"
          style={{ color: "var(--sk-ink)" }}
        >
          嗨，早安
        </span>
        <div className="sk-body mt-1 text-sm" style={{ color: "var(--sk-ink-soft)" }}>
          {dateStr} · {statusText}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          if (!sending) openSecondaryScreen("settings", "home");
        }}
        disabled={sending}
        className="grid h-12 w-12 place-items-center rounded-full disabled:opacity-40"
        style={{
          background: "var(--sk-paper)",
          border: "2px solid var(--sk-ink)",
          color: "var(--sk-ink)",
          boxShadow: "1px 2px 0 var(--sk-ink)",
        }}
        aria-label="設定"
      >
        <SettingsIcon size={19} />
      </button>
    </div>
  );
}

function macroValue(value: number | undefined, target: number | undefined) {
  const current = Math.max(0, Math.round(value ?? 0));
  const safeTarget = Math.max(0, Math.round(target ?? 0));
  return {
    current,
    target: safeTarget,
    progress: safeTarget > 0 ? Math.min(1, current / safeTarget) : 0,
  };
}

function CalorieHero({
  dailySummary,
  dailyTargets,
}: {
  dailySummary: DailySummary | null;
  dailyTargets: DailyTargets | null;
}) {
  const display = getHomeCalorieDisplay(dailySummary, dailyTargets);
  const macros = [
    { label: "蛋白", ...macroValue(dailySummary?.totalProtein, dailyTargets?.protein) },
    { label: "碳水", ...macroValue(dailySummary?.totalCarbs, dailyTargets?.carbs) },
    { label: "脂肪", ...macroValue(dailySummary?.totalFat, dailyTargets?.fat) },
  ];

  return (
    <SketchSoftBox className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="sk-heading text-5xl leading-none">{display.consumed.toLocaleString("en-US")}</div>
          <div className="sk-body mt-2 text-sm" style={{ color: "var(--sk-ink-soft)" }}>
            還能吃 {display.remaining} kcal
          </div>
        </div>
        <SketchRing
          value={display.ringValue}
          label={`${Math.round(display.ringValue * 100)}%`}
          size={104}
          stroke={10}
        />
      </div>
      <SketchDivider dashed className="my-5" />
      <div className="grid grid-cols-3 gap-3">
        {macros.map((macro) => (
          <div key={macro.label} className="min-w-0">
            <div className="sk-body mb-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
              {macro.label}
            </div>
            <SketchProgressBar value={macro.progress} />
            <div className="sk-body mt-1 text-xs">
              {macro.current}/{macro.target}g
            </div>
          </div>
        ))}
      </div>
    </SketchSoftBox>
  );
}

function MealRows({ meals }: { meals: MealEntry[] }) {
  if (meals.length === 0) {
    return (
      <SketchSoftBox className="p-4">
        <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
          今天還沒有紀錄。到「對話」描述你吃了什麼。
        </p>
      </SketchSoftBox>
    );
  }

  return (
    <div className="space-y-3">
      {meals.map((meal) => (
        <article
          key={meal.id}
          className="flex items-center justify-between gap-3 rounded-lg px-4 py-3"
          style={{
            background: "var(--sk-paper)",
            border: "2px solid var(--sk-ink)",
            boxShadow: "1px 2px 0 var(--sk-ink)",
          }}
        >
          <div className="min-w-0">
            <div className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
              {formatMealRowTime(meal.loggedAt)} · {getDisplayMealLabel(meal.loggedAt)}
            </div>
            <div className="sk-heading truncate text-xl">{meal.foodName}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="sk-heading text-2xl">{Math.round(meal.calories)}</span>
            <span aria-hidden="true" className="text-sm" style={{ color: "var(--sk-ink-faint)" }}>
              &gt;
            </span>
          </div>
        </article>
      ))}
    </div>
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

  useEffect(() => {
    setCoachAdvice(coachAdvice);
  }, [coachAdvice, setCoachAdvice]);

  function handleTaskOptionClick(option: CoachCTATaskOption, intent: CoachCTAIntent) {
    sendHomeCtaTaskOption(option, intent, setPendingHomeChatDraft, setActiveScreen);
  }

  return (
    <div className="screen-shell sk-screen">
      <HomeHeader />
      <main className="screen-scroll space-y-4 px-5 pt-2">
        <CalorieHero dailySummary={dailySummary} dailyTargets={dailyTargets} />
        <div className="flex items-baseline justify-between px-1">
          <h2 className="sk-heading text-2xl">今日餐點</h2>
          <span className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
            {meals.length > 0 ? `${meals.length} 筆` : "還沒有晚餐"}
          </span>
        </div>
        <CoachAdviceCard advice={coachAdvice} cta={cta} onTaskOptionClick={handleTaskOptionClick} disabled={sending} />
        <MealRows meals={meals} />
      </main>
    </div>
  );
}
