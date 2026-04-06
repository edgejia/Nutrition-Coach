import { useEffect } from "react";
import { useStore } from "../store.js";
import { getCoachAdvice, getCoachCTA } from "../coach-advice.js";
import { Dashboard } from "./Dashboard.js";
import { CoachAdviceCard } from "./CoachAdviceCard.js";
import { ChatEntryBar } from "./ChatEntryBar.js";

export function getDisplayedCoachAdvice(
  storedAdvice: string | null,
  dailySummary: ReturnType<typeof useStore.getState>["dailySummary"],
  dailyTargets: ReturnType<typeof useStore.getState>["dailyTargets"],
) {
  return getCoachAdvice(dailySummary, dailyTargets) ?? storedAdvice;
}

function HomeHeader() {
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const sending = useStore((s) => s.sending);

  const now = new Date();
  const dateStr = now.toLocaleDateString("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  return (
    <div className="flex items-center justify-between px-5 pb-2 pt-4">
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
            if (!sending) setShowSettings(true);
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
  const coachAdvice = getDisplayedCoachAdvice(storedCoachAdvice, dailySummary, dailyTargets);
  const cta = getCoachCTA(dailySummary, dailyTargets);

  useEffect(() => {
    setCoachAdvice(coachAdvice);
  }, [coachAdvice, setCoachAdvice]);

  function handleSend(text: string, image?: File) {
    setPendingHomeChatDraft({ id: crypto.randomUUID(), text, image, status: "staged" });
    setActiveScreen("chat");
  }

  function handleCtaClick(text: string) {
    setPendingHomeChatDraft({ id: crypto.randomUUID(), text, status: "staged" });
    setActiveScreen("chat");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <main className="flex-1 space-y-3 overflow-y-auto px-4 pb-24 pt-2">
        <HomeHeader />
        <CoachAdviceCard advice={coachAdvice} cta={cta} onCtaClick={handleCtaClick} />
        <Dashboard onTap={() => { if (!sending) setActiveScreen("summary"); }} />
      </main>
      <div className="shrink-0 border-t px-3 pb-safe" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <ChatEntryBar onSend={handleSend} disabled={sending} />
      </div>
    </div>
  );
}
