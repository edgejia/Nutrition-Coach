import { useEffect } from "react";
import { useStore } from "../store.js";
import { getCoachAdvice } from "../coach-advice.js";
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

function CalorieHeroCard() {
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const sending = useStore((s) => s.sending);

  if (summary === null) {
    return (
      <div
        className="animate-pulse rounded-2xl p-5"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-med)" }}
      >
        <div className="mb-2 h-12 w-32 rounded-xl" style={{ background: "var(--bg-raised)" }} />
        <div className="mb-4 h-5 w-24 rounded" style={{ background: "var(--bg-raised)" }} />
        <div className="h-1 w-full rounded-full" style={{ background: "var(--bg-raised)" }} />
      </div>
    );
  }

  const current = Math.round(summary.totalCalories);
  const target = targets?.calories ?? 0;
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;

  return (
    <button
      type="button"
      onClick={() => {
        if (!sending) setActiveScreen("summary");
      }}
      disabled={sending}
      className="w-full text-left disabled:opacity-70"
    >
      <div
        className="rounded-2xl p-5"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-med)",
        }}
      >
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div
              className="leading-none"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 52,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.03em",
              }}
            >
              {current.toLocaleString()}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 30,
                  fontWeight: 800,
                  color: "var(--text-3)",
                  letterSpacing: "-0.02em",
                }}
              >
                /
              </span>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 30,
                  fontWeight: 700,
                  color: "var(--text-2)",
                  letterSpacing: "-0.02em",
                }}
              >
                {target.toLocaleString()}
              </span>
              <span className="text-base font-bold" style={{ color: "var(--text-2)" }}>
                kcal
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase leading-tight" style={{ color: "var(--orange)", letterSpacing: "0.1em" }}>
              TAP FOR
              <br />
              DETAIL
            </div>
            <div className="mt-1 text-right text-lg" style={{ color: "var(--orange)" }}>
              ↗
            </div>
          </div>
        </div>

        <p className="mb-3 text-sm" style={{ color: "var(--text-2)" }}>
          剩餘 {remaining.toLocaleString()} kcal，
          {remaining > 300 ? "今天整體還在控制範圍內，晚餐仍有正常用餐空間。" : "今日熱量即將達標，晚餐注意份量。"}
        </p>

        <div className="overflow-hidden rounded-full" style={{ height: 4, background: "rgba(255,255,255,0.08)" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "var(--orange)",
              borderRadius: 2,
              transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)",
            }}
          />
        </div>
      </div>
    </button>
  );
}

function HomeHeader() {
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const sending = useStore((s) => s.sending);

  const proteinPct = targets && summary ? (summary.totalProtein / targets.protein) * 100 : 100;
  const showProteinLow = proteinPct < 60;

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex items-start justify-between px-5 pb-2 pt-4">
      <div>
        <div className="mb-1 text-xs font-semibold" style={{ color: "var(--text-2)" }}>
          {dateStr}&nbsp;·&nbsp;
          <span style={{ color: "var(--orange)", fontWeight: 600 }}>Nutrition Coach</span>
        </div>
        <h1
          className="leading-tight"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.025em",
          }}
        >
          Today at
          <br />a glance
        </h1>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-2)", maxWidth: 200 }}>
          先看今天吃得如何，再決定接下來怎麼吃。
        </p>
      </div>
      <div className="flex flex-col items-end gap-2 pt-1">
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
        {showProteinLow && (
          <div
            className="rounded-full px-3 py-1.5 text-xs font-bold"
            style={{
              border: "1.5px solid var(--orange)",
              color: "var(--orange)",
              whiteSpace: "nowrap",
            }}
          >
            Protein low
          </div>
        )}
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

  useEffect(() => {
    setCoachAdvice(coachAdvice);
  }, [coachAdvice, setCoachAdvice]);

  function handleSend(text: string, image?: File) {
    setPendingHomeChatDraft({ id: crypto.randomUUID(), text, image, status: "staged" });
    setActiveScreen("chat");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <main className="flex-1 space-y-3 overflow-y-auto px-4 pb-24 pt-2">
        <HomeHeader />
        <CalorieHeroCard />
        <Dashboard />
        <CoachAdviceCard advice={coachAdvice} />
      </main>
      <div className="shrink-0 border-t px-3 pb-safe" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <ChatEntryBar onSend={handleSend} disabled={sending} />
      </div>
    </div>
  );
}
