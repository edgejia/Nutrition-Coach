import { useEffect } from "react";
import { useStore } from "../store.js";
import { getCoachAdvice } from "../coach-advice.js";
import { Dashboard } from "./Dashboard.js";
import { CoachAdviceCard } from "./CoachAdviceCard.js";
import { ChatEntryBar } from "./ChatEntryBar.js";

export function HomeScreen() {
  const dailySummary = useStore((s) => s.dailySummary);
  const dailyTargets = useStore((s) => s.dailyTargets);
  const coachAdvice = useStore((s) => s.coachAdvice);
  const setCoachAdvice = useStore((s) => s.setCoachAdvice);
  const sending = useStore((s) => s.sending);
  const setPendingHomeChatDraft = useStore((s) => s.setPendingHomeChatDraft);
  const setActiveScreen = useStore((s) => s.setActiveScreen);

  useEffect(() => {
    setCoachAdvice(getCoachAdvice(dailySummary, dailyTargets));
  }, [dailySummary, dailyTargets, setCoachAdvice]);

  function handleSend(text: string, image?: File) {
    setPendingHomeChatDraft({
      id: crypto.randomUUID(),
      text,
      image,
      status: "staged",
    });
    setActiveScreen("chat");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <main className="flex-1 space-y-4 overflow-y-auto p-4 pb-28">
        <button type="button" onClick={() => setActiveScreen("summary")} className="block w-full text-left">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <div className="mb-3 text-sm font-semibold text-gray-900">Today's Summary</div>
            <Dashboard />
          </section>
        </button>
        <CoachAdviceCard advice={coachAdvice} />
      </main>
      <div className="border-t bg-white p-3">
        <ChatEntryBar onSend={handleSend} disabled={sending} />
      </div>
    </div>
  );
}
