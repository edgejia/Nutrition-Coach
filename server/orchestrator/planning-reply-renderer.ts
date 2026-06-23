import type { DailyTargets } from "../services/device.js";
import type { DailySummary } from "../services/summary.js";

export const MAX_COACH_REPLY_BULLETS = 5;

const FORBIDDEN_INTERNAL_TERMS = [
  "plan_next_meal",
  "planningFacts",
  "remainingCalories",
  "macroGap",
] as const;

type PlanningAdviceGuardStatus = "accepted" | "clamped" | "needs_repair" | "fallback";
type CoachAdviceMode = "coach_planning" | "coach_compact";

export interface PlanningMacroFacts {
  protein: number;
  carbs: number;
  fat: number;
}

export interface PlanningFacts {
  date: string;
  consumed: DailyTargets;
  target: DailyTargets;
  remaining: DailyTargets;
  macroGap: PlanningMacroFacts;
  mealCount: number;
  hasLoggedMeals: boolean;
  isOverBudget: boolean;
}

export interface PlanningAdviceGuardResult {
  status: PlanningAdviceGuardStatus;
  advice: string;
  reasons: string[];
}

export interface PlanningReplyRenderOptions {
  mode?: CoachAdviceMode;
  repairAttempted?: boolean;
}

function clampRemaining(target: number, consumed: number): number {
  return Math.max(0, target - consumed);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatMacros(macros: PlanningMacroFacts): string {
  return [
    `蛋白質 ${formatNumber(macros.protein)} g`,
    `碳水 ${formatNumber(macros.carbs)} g`,
    `脂肪 ${formatNumber(macros.fat)} g`,
  ].join("、");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function internalTermPattern(): RegExp {
  return new RegExp(FORBIDDEN_INTERNAL_TERMS.map(escapeRegExp).join("|"), "g");
}

function stripInternalTerms(text: string): string {
  return text.replace(internalTermPattern(), "").replace(/[ \t]{2,}/g, " ").trim();
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed) ||
    (trimmed.includes("|") && trimmed.split("|").length >= 3)
  );
}

function normalizeBulletPrefix(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "- ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function capBulletsPreservingNextStep(lines: string[]): string[] {
  const bulletLines = lines.filter((line) => line.trim().startsWith("- "));
  if (bulletLines.length <= MAX_COACH_REPLY_BULLETS) {
    return lines;
  }

  const nonBulletLines = lines.filter((line) => !line.trim().startsWith("- "));
  const nextStep = [...bulletLines].reverse().find((line) => line.includes("下一步"));
  const nonNextStepBullets = bulletLines.filter((line) => line !== nextStep);
  const cappedBullets = nextStep
    ? [...nonNextStepBullets.slice(0, MAX_COACH_REPLY_BULLETS - 1), nextStep]
    : nonNextStepBullets.slice(0, MAX_COACH_REPLY_BULLETS);

  return [...nonBulletLines, ...cappedBullets];
}

function collapseDuplicateNextSteps(lines: string[]): string[] {
  let seenNextStep = false;
  const reversed = [...lines].reverse().filter((line) => {
    if (!line.includes("下一步")) {
      return true;
    }
    if (seenNextStep) {
      return false;
    }
    seenNextStep = true;
    return true;
  });
  return reversed.reverse();
}

function normalizeRangeSeparator(text: string): string {
  return text.replace(
    /(\d+(?:\.\d+)?)\s*[–—~～至到]\s*(\d+(?:\.\d+)?)/g,
    "$1-$2",
  );
}

function rangePattern(unitPattern: string): RegExp {
  return new RegExp(`(\\d+(?:\\.\\d+)?)\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})`, "gi");
}

function clampAdviceRanges(advice: string, facts: PlanningFacts): { advice: string; clamped: boolean } {
  let clamped = false;
  const normalized = normalizeRangeSeparator(advice);
  const kcalLimit = facts.remaining.calories;
  const macroLimits: Record<string, number> = {
    "蛋白質": facts.macroGap.protein,
    protein: facts.macroGap.protein,
    "碳水": facts.macroGap.carbs,
    "碳水化合物": facts.macroGap.carbs,
    carbs: facts.macroGap.carbs,
    carb: facts.macroGap.carbs,
    "脂肪": facts.macroGap.fat,
    fat: facts.macroGap.fat,
  };

  let next = normalized.replace(rangePattern("kcal|大卡|卡路里"), (match, lowRaw, highRaw, unit) => {
    const low = Number(lowRaw);
    const high = Number(highRaw);
    if (Number.isFinite(high) && high > kcalLimit && low <= kcalLimit) {
      clamped = true;
      return `${formatNumber(low)}-${formatNumber(kcalLimit)} ${unit}`;
    }
    return match;
  });

  next = next.replace(
    rangePattern("g|克"),
    (match, lowRaw, highRaw, unit, offset, fullText) => {
      const preceding = fullText.slice(Math.max(0, offset - 12), offset);
      const macroKey = Object.keys(macroLimits).find((key) => preceding.includes(key));
      if (!macroKey) {
        return match;
      }
      const low = Number(lowRaw);
      const high = Number(highRaw);
      const limit = macroLimits[macroKey];
      if (Number.isFinite(high) && high > limit && low <= limit) {
        clamped = true;
        return `${formatNumber(low)}-${formatNumber(limit)} ${unit}`;
      }
      return match;
    },
  );

  return { advice: next, clamped };
}

function hasWrongFactClaim(advice: string, facts: PlanningFacts): string[] {
  const reasons: string[] = [];
  const exactConsumed = formatNumber(facts.consumed.calories);
  const exactRemaining = formatNumber(facts.remaining.calories);
  const exactTarget = formatNumber(facts.target.calories);
  const exactProteinGap = formatNumber(facts.macroGap.protein);

  const consumedMatches = [...advice.matchAll(/(?:已經吃了|今日攝取|今天吃了)\s*(\d+(?:\.\d+)?)\s*(?:kcal|大卡|卡路里)/g)];
  if (consumedMatches.some((match) => formatNumber(Number(match[1])) !== exactConsumed)) {
    reasons.push("consumed_fact_conflict");
  }

  const remainingMatches = [...advice.matchAll(/(?:還剩|剩下)\s*(\d+(?:\.\d+)?)\s*(?:kcal|大卡|卡路里)/g)];
  if (remainingMatches.some((match) => formatNumber(Number(match[1])) !== exactRemaining)) {
    reasons.push("remaining_fact_conflict");
  }

  const targetMatches = [...advice.matchAll(/(?:目標是|目標為|每日目標)\s*(\d+(?:\.\d+)?)\s*(?:kcal|大卡|卡路里)/g)];
  if (targetMatches.some((match) => formatNumber(Number(match[1])) !== exactTarget)) {
    reasons.push("target_fact_conflict");
  }

  const proteinGapMatches = [...advice.matchAll(/蛋白質(?:缺口|還缺|剩)\s*(?:剩)?\s*(\d+(?:\.\d+)?)\s*g/g)];
  if (proteinGapMatches.some((match) => formatNumber(Number(match[1])) !== exactProteinGap)) {
    reasons.push("macro_gap_conflict");
  }

  return reasons;
}

export function derivePlanningFacts(
  dailySummary: DailySummary,
  dailyTargets: DailyTargets,
): PlanningFacts {
  const consumed = {
    calories: dailySummary.totalCalories,
    protein: dailySummary.totalProtein,
    carbs: dailySummary.totalCarbs,
    fat: dailySummary.totalFat,
  };
  const remaining = {
    calories: clampRemaining(dailyTargets.calories, consumed.calories),
    protein: clampRemaining(dailyTargets.protein, consumed.protein),
    carbs: clampRemaining(dailyTargets.carbs, consumed.carbs),
    fat: clampRemaining(dailyTargets.fat, consumed.fat),
  };

  return {
    date: dailySummary.date,
    consumed,
    target: { ...dailyTargets },
    remaining,
    macroGap: {
      protein: remaining.protein,
      carbs: remaining.carbs,
      fat: remaining.fat,
    },
    mealCount: dailySummary.mealCount,
    hasLoggedMeals: dailySummary.mealCount > 0,
    isOverBudget: consumed.calories > dailyTargets.calories,
  };
}

export function renderPlanningFacts(facts: PlanningFacts): string {
  const mealSegment = facts.hasLoggedMeals
    ? `今日攝取 ${facts.mealCount} 餐，共 ${formatNumber(facts.consumed.calories)} kcal。`
    : "今日尚未有餐點攝取。";
  const calorieSegment = facts.isOverBudget
    ? `目標 ${formatNumber(facts.target.calories)} kcal，熱量已超過目標 ${formatNumber(facts.consumed.calories - facts.target.calories)} kcal，還剩 0 kcal。`
    : `目標 ${formatNumber(facts.target.calories)} kcal，還剩 ${formatNumber(facts.remaining.calories)} kcal。`;

  return `${mealSegment}${calorieSegment}營養缺口：${formatMacros(facts.macroGap)}。`;
}

export function normalizeCoachAdvice(
  advice: string | undefined,
  _options: PlanningReplyRenderOptions = {},
): string {
  const trimmed = advice?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => stripInternalTerms(line))
    .filter((line) => line && !isMarkdownTableLine(line))
    .map((line) => (/^\s*(?:[-*•]|\d+[.)])\s*/.test(line) ? normalizeBulletPrefix(line) : line));

  return capBulletsPreservingNextStep(collapseDuplicateNextSteps(lines)).join("\n").trim();
}

export function guardPlanningAdvice(
  advice: string | undefined,
  facts: PlanningFacts,
  options: PlanningReplyRenderOptions = {},
): PlanningAdviceGuardResult {
  const normalized = normalizeCoachAdvice(advice, options);
  if (!normalized) {
    return { status: "accepted", advice: "", reasons: [] };
  }

  const contradictionReasons = hasWrongFactClaim(normalized, facts);
  if (contradictionReasons.length > 0) {
    return {
      status: options.repairAttempted ? "fallback" : "needs_repair",
      advice: "",
      reasons: contradictionReasons,
    };
  }

  const rangeResult = clampAdviceRanges(normalized, facts);
  return {
    status: rangeResult.clamped ? "clamped" : "accepted",
    advice: rangeResult.advice,
    reasons: rangeResult.clamped ? ["range_clamped"] : [],
  };
}

export function composePlanningReply(
  facts: PlanningFacts,
  advice?: string,
  options: PlanningReplyRenderOptions = {},
): string {
  const deterministicFacts = renderPlanningFacts(facts);
  const guarded = guardPlanningAdvice(advice, facts, options);
  if (guarded.status === "needs_repair" || guarded.status === "fallback" || !guarded.advice) {
    return deterministicFacts;
  }
  return `${deterministicFacts}\n\n${guarded.advice}`;
}

export function renderPlanningFallbackReply(facts: PlanningFacts): string {
  return `${renderPlanningFacts(facts)}\n\n先依照後端計算的剩餘量調整這一餐；如果你想吃的餐點會超出剩餘量，請降低份量或改成更清淡的選項。`;
}
