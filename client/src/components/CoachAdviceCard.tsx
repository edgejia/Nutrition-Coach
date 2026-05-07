import { useState } from "react";
import { useStore } from "../store.js";
import { recordHomeCtaIntentSelected } from "../api.js";
import { SportBoltIcon } from "./SportIcons.js";
import type {
  CoachCTA,
  CoachCTAIntent,
  CoachCTAIntentId,
  CoachCTATaskOption,
  DailySummary,
  DailyTargets,
} from "../types.js";

export function recordAndSelectHomeCtaIntent(
  intentId: CoachCTAIntentId,
  setSelectedIntentId: (intentId: CoachCTAIntentId) => void,
) {
  void recordHomeCtaIntentSelected(intentId);
  setSelectedIntentId(intentId);
}

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

  if (proteinRemaining > 5) tags.push(`蛋白質差 ${proteinRemaining}g`);
  if (fatPct >= 85) tags.push("脂肪接近上限");
  if (calRemaining > 0) tags.push("晚餐還有空間");

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
      message: "先用對話記下第一餐。今天還沒有紀錄。到「對話」描述你吃了什麼。",
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

export function CoachCTAControls({
  intents,
  selectedIntentId,
  onIntentSelect,
  onTaskOptionClick,
  disabled = false,
}: {
  intents: readonly CoachCTAIntent[];
  selectedIntentId: CoachCTAIntentId | null;
  onIntentSelect: (intentId: CoachCTAIntentId) => void;
  onTaskOptionClick: (option: CoachCTATaskOption, intent: CoachCTAIntent) => void;
  disabled?: boolean;
}) {
  const selectedIntent = intents.find((intent) => intent.id === selectedIntentId) ?? null;

  if (intents.length === 0) {
    return null;
  }

  return (
    <div className="sp-coach-cta-controls">
      <div className="sp-coach-cta-intents">
        {intents.map((intent) => {
          const selected = intent.id === selectedIntentId;
          const optionsId = `coach-cta-options-${intent.id}`;
          return (
            <button
              key={intent.id}
              type="button"
              aria-pressed={selected}
              aria-expanded={selected}
              aria-controls={optionsId}
              data-selected={selected}
              disabled={disabled}
              onClick={() => onIntentSelect(intent.id)}
              className="sp-coach-cta-intent"
            >
              {intent.label}
            </button>
          );
        })}
      </div>

      {selectedIntent && (
        <div id={`coach-cta-options-${selectedIntent.id}`} className="sp-coach-cta-options">
          {selectedIntent.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => onTaskOptionClick(option, selectedIntent)}
              className="sp-coach-cta-option"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CoachAdviceCard({
  advice,
  cta = null,
  onTaskOptionClick,
  disabled = false,
}: {
  advice: string | null;
  cta?: CoachCTA | null;
  onTaskOptionClick?: (option: CoachCTATaskOption, intent: CoachCTAIntent) => void;
  disabled?: boolean;
}) {
  const [selectedIntentId, setSelectedIntentId] = useState<CoachCTAIntentId | null>(null);
  const summary = useStore((s) => s.dailySummary);
  const targets = useStore((s) => s.dailyTargets);
  const presentation = getAdvicePresentation(summary, targets, advice);

  const ctaBlock = cta && presentation.state !== "loading" && (
    <CoachCTAControls
      intents={cta}
      selectedIntentId={selectedIntentId}
      onIntentSelect={(intentId) => recordAndSelectHomeCtaIntent(intentId, setSelectedIntentId)}
      onTaskOptionClick={(option, intent) => onTaskOptionClick?.(option, intent)}
      disabled={disabled}
    />
  );

  if (presentation.state === "loading") {
    return (
      <div className="sp-coach-cta sp-coach-cta-loading" aria-busy="true">
        <div className="sp-coach-cta-skeleton sp-coach-cta-skeleton-label" />
        <div className="sp-coach-cta-skeleton sp-coach-cta-skeleton-headline" />
        <div className="sp-coach-cta-skeleton sp-coach-cta-skeleton-body" />
      </div>
    );
  }

  if (presentation.state === "empty") {
    return (
      <section className="sp-coach-cta" aria-label="Coach live">
        <div className="sp-coach-cta-label">
          <SportBoltIcon size={14} stroke={2} />
          <span>教練建議 · 即時</span>
        </div>
        <p className="sp-coach-cta-headline">
          {presentation.message}
        </p>
        {ctaBlock}
      </section>
    );
  }

  return (
    <section className="sp-coach-cta" aria-label="Coach live">
      <div className="sp-coach-cta-label">
        <SportBoltIcon size={14} stroke={2} />
        <span>教練建議 · 即時</span>
      </div>
      {advice && (
        <>
          <p className="sp-coach-cta-headline">
            {presentation.headline}
          </p>
          {presentation.body && (
            <p className="sp-coach-cta-body">
              {presentation.body}
            </p>
          )}
        </>
      )}
      {presentation.tags.length > 0 && (
        <div className="sp-coach-cta-tags">
          {presentation.tags.map((tag) => (
            <span key={tag} className="sp-coach-cta-tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      {ctaBlock}
    </section>
  );
}
