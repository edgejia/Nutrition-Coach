import { useState } from "react";
import { useStore } from "../store.js";
import { recordHomeCtaIntentSelected } from "../api.js";
import { SketchButton, SketchPill } from "./SketchPrimitives.js";
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
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {intents.map((intent) => {
          const selected = intent.id === selectedIntentId;
          const optionsId = `coach-cta-options-${intent.id}`;
          return (
            <SketchButton
              key={intent.id}
              aria-pressed={selected}
              aria-expanded={selected}
              aria-controls={optionsId}
              disabled={disabled}
              onClick={() => onIntentSelect(intent.id)}
              className="min-h-10 px-3 py-2 text-sm leading-tight disabled:opacity-40"
              style={{
                background: selected ? "var(--sk-accent)" : "var(--sk-paper)",
                color: "var(--sk-ink)",
              }}
            >
              {intent.label}
            </SketchButton>
          );
        })}
      </div>

      {selectedIntent && (
        <div id={`coach-cta-options-${selectedIntent.id}`} className="flex flex-col gap-2">
          {selectedIntent.options.map((option) => (
            <SketchButton
              key={option.id}
              disabled={disabled}
              onClick={() => onTaskOptionClick(option, selectedIntent)}
              className="min-h-11 justify-start px-4 py-2 text-left text-sm leading-relaxed disabled:opacity-40"
              style={{
                background: "var(--sk-paper)",
                color: "var(--sk-ink)",
              }}
            >
              {option.label}
            </SketchButton>
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
      <div
        className="sk-box-soft animate-pulse p-4"
        style={{ background: "var(--sk-accent-soft)", borderColor: "var(--sk-accent)" }}
      >
        <div className="mb-2 h-5 w-3/4 rounded" style={{ background: "var(--sk-paper-warm)" }} />
        <div className="h-4 w-full rounded" style={{ background: "var(--sk-paper-warm)" }} />
        <div className="mt-1 h-4 w-2/3 rounded" style={{ background: "var(--sk-paper-warm)" }} />
      </div>
    );
  }

  if (presentation.state === "empty") {
    return (
      <div
        className="sk-box-soft p-4"
        style={{ background: "var(--sk-accent-soft)", borderColor: "var(--sk-accent)" }}
      >
        <p className="sk-heading text-xl leading-snug" style={{ color: "var(--sk-ink)" }}>
          {presentation.message}
        </p>
        {ctaBlock}
      </div>
    );
  }

  return (
    <div className="sk-box-soft p-4" style={{ background: "var(--sk-accent-soft)", borderColor: "var(--sk-accent)" }}>
      {advice && (
        <>
          <p
            className="sk-heading mb-2 text-xl leading-snug"
            style={{
              color: "var(--sk-ink)",
            }}
          >
            {presentation.headline}
          </p>
          {presentation.body && (
            <p className="sk-body mb-3 text-sm leading-relaxed" style={{ color: "var(--sk-ink-soft)" }}>
              {presentation.body}
            </p>
          )}
        </>
      )}
      {presentation.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presentation.tags.map((tag) => (
            <SketchPill
              key={tag}
              className="text-xs"
              style={{
                background: "var(--sk-paper)",
                color: "var(--sk-ink)",
              }}
            >
              {tag}
            </SketchPill>
          ))}
        </div>
      )}
      {ctaBlock}
    </div>
  );
}
