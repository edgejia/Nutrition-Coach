import { useEffect } from "react";
import { useStore } from "../store.js";
import { recordHomeCtaOptionSent } from "../api.js";
import { getCoachAdvice, getCoachCTA } from "../coach-advice.js";
import { formatLocalDate } from "../lib/time.js";
import { Dashboard } from "./Dashboard.js";
import { CoachAdviceCard } from "./CoachAdviceCard.js";
import { ChatEntryBar } from "./ChatEntryBar.js";
import type { ActiveScreen, PendingHomeChatDraft, CoachCTAIntent, CoachCTATaskOption } from "../types.js";

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
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const openSecondaryScreen = useStore((s) => s.openSecondaryScreen);
  const sending = useStore((s) => s.sending);
  const dailySummary = useStore((s) => s.dailySummary);
  const dateKey = dailySummary?.date ?? formatLocalDate(new Date());
  const dateStr = formatHomeHeaderDate(dateKey);

  return (
    <div className="screen-bar flex items-center justify-between px-5 pb-2 pt-4">
      <div>
        <span
          className="text-sm font-bold"
          style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
        >
          ChatGPT-Gain ProTein
        </span>
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          {dateStr}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!sending) setActiveScreen("chat");
          }}
          disabled={sending}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-med)",
            color: "var(--text-2)",
          }}
        >
          聊天
        </button>
        <button
          type="button"
          onClick={() => {
            if (!sending) openSecondaryScreen("settings", "home");
          }}
          disabled={sending}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-sm disabled:opacity-40"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-med)",
            color: "var(--text-2)",
          }}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}

export function HomeScreen() {
  const dailySummary = useStore((s) => s.dailySummary);
  const dailyTargets = useStore((s) => s.dailyTargets);
  const storedCoachAdvice = useStore((s) => s.coachAdvice);
  const setCoachAdvice = useStore((s) => s.setCoachAdvice);
  const sending = useStore((s) => s.sending);
  const setPendingHomeChatDraft = useStore((s) => s.setPendingHomeChatDraft);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const openSecondaryScreen = useStore((s) => s.openSecondaryScreen);
  const coachAdvice = getDisplayedCoachAdvice(storedCoachAdvice, dailySummary, dailyTargets);
  const cta = getCoachCTA(dailySummary, dailyTargets);

  useEffect(() => {
    setCoachAdvice(coachAdvice);
  }, [coachAdvice, setCoachAdvice]);

  function handleSend(text: string, image?: File) {
    setPendingHomeChatDraft({ id: crypto.randomUUID(), text, image, status: "staged" });
    setActiveScreen("chat");
  }

  function handleTaskOptionClick(option: CoachCTATaskOption, intent: CoachCTAIntent) {
    sendHomeCtaTaskOption(option, intent, setPendingHomeChatDraft, setActiveScreen);
  }

  return (
    <div className="screen-shell">
      <HomeHeader />
      <main className="screen-scroll-with-input space-y-3 px-4 pt-2">
        <CoachAdviceCard advice={coachAdvice} cta={cta} onTaskOptionClick={handleTaskOptionClick} disabled={sending} />
        <Dashboard onTap={() => { if (!sending) openSecondaryScreen("dayDetail", "history"); }} />
      </main>
      <div className="screen-bottom-bar border-t px-3" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <ChatEntryBar onSend={handleSend} disabled={sending} />
      </div>
    </div>
  );
}
