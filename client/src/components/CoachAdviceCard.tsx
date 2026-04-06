import { useStore } from "../store.js";
import type { DailySummary, DailyTargets } from "../types.js";

export function splitAdvice(advice: string): { headline: string; body: string } {
  const dotIdx = advice.indexOf("。");
  const periodIdx = advice.indexOf(".");
  const breakIdx = advice.indexOf("\n");
  const splitAt = [dotIdx, periodIdx, breakIdx]
    .filter((i) => i > 0)
    .sort((a, b) => a - b)[0];

  if (!splitAt) return { headline: advice, body: "" };
  return {
    headline: advice.slice(0, splitAt + 1),
    body: advice.slice(splitAt + 1).trim(),
  };
}

export function getAdviceTags(summary: DailySummary, targets: DailyTargets | null): string[] {
  if (!targets) return [];

  const tags: string[] = [];
  const proteinRemaining = Math.max(0, Math.round(targets.protein - summary.totalProtein));
  const fatPct = targets.fat > 0 ? (summary.totalFat / targets.fat) * 100 : 0;
  const calRemaining = Math.max(0, Math.round(targets.calories - summary.totalCalories));

  if (proteinRemaining > 5) tags.push(`Need +${proteinRemaining}g protein`);
  if (fatPct >= 85) tags.push("Fat near limit");
  if (calRemaining > 0) tags.push("Dinner still fits");

  return tags;
}

export function getAdvicePresentation(
  summary: DailySummary | null,
  targets: DailyTargets | null,
  advice: string | null,
) {
  if (summary === null) {
    return { state: "loading" as const };
  }

  if (summary.mealCount === 0) {
    return {
      state: "empty" as const,
      message: "還沒有今天的紀錄，拍張照或打字告訴我你吃了什麼吧！",
    };
  }

  const { headline, body } = advice ? splitAdvice(advice) : { headline: "", body: "" };
  return {
    state: "ready" as const,
    headline,
    body,
    tags: getAdviceTags(summary, targets),
  };
}

export function CoachAdviceCard({ advice }: { advice: string | null }) {
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const presentation = getAdvicePresentation(summary, targets, advice);

  if (presentation.state === "loading") {
    return (
      <section>
        <div className="mb-2 text-sm font-semibold" style={{ color: "var(--text-2)" }}>
          Coach advice
        </div>
        <div
          className="animate-pulse rounded-2xl p-4"
          style={{ background: "var(--bg-teal)", border: "1px solid var(--teal-border)" }}
        >
          <div className="mb-2 h-5 w-3/4 rounded" style={{ background: "rgba(109,191,163,0.15)" }} />
          <div className="h-4 w-full rounded" style={{ background: "rgba(109,191,163,0.1)" }} />
          <div className="mt-1 h-4 w-2/3 rounded" style={{ background: "rgba(109,191,163,0.1)" }} />
        </div>
      </section>
    );
  }

  if (presentation.state === "empty") {
    return (
      <section>
        <div className="mb-2 text-sm font-semibold" style={{ color: "var(--text-2)" }}>
          Coach advice
        </div>
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--bg-teal)", border: "1px solid var(--teal-border)" }}
        >
          <p className="text-sm leading-relaxed" style={{ color: "var(--teal-text)" }}>
            {presentation.message}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2 text-sm font-semibold" style={{ color: "var(--text-2)" }}>
        Coach advice
      </div>
      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--bg-teal)",
          border: "1px solid var(--teal-border)",
        }}
      >
        {advice && (
          <>
            <p
              className="mb-2 leading-snug"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.015em",
              }}
            >
              {presentation.headline}
            </p>
            {presentation.body && (
              <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--teal-text)" }}>
                {presentation.body}
              </p>
            )}
          </>
        )}
        {presentation.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presentation.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{
                  background: "rgba(109,191,163,0.08)",
                  border: "1px solid rgba(109,191,163,0.2)",
                  color: "var(--teal-text)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
