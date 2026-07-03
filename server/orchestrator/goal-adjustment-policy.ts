import type { DailyTargets } from "../services/device.js";
import { stripToolLikeRegions } from "./source-text-guard.js";
import { NUTRITION_SAFETY_CALORIE_FLOOR } from "./nutrition-safety-policy.js";

export type RelativeLowerGoalProposalValidationReason =
  | "not_relative_lower"
  | "active_at_floor"
  | "below_floor"
  | "rebound_or_not_lower"
  | "macro_calorie_inconsistent"
  | "ok";

export type RelativeLowerGoalProposalValidationResult =
  | { ok: true; reason: "not_relative_lower" | "ok" }
  | {
      ok: false;
      reason: Exclude<RelativeLowerGoalProposalValidationReason, "not_relative_lower" | "ok">;
    };

interface RelativeLowerIntentInput {
  userMessage: string;
  previousAssistantMessage?: string;
  activeProposalTargets?: DailyTargets;
  hasActiveGoalProposal?: boolean;
}

interface RelativeLowerValidationInput extends RelativeLowerIntentInput {
  activeProposalTargets?: DailyTargets;
  proposedTargets: DailyTargets;
}

function normalizeProposalDecisionText(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeGoalIntentText(message: string): string {
  return stripToolLikeRegions(message).trim().toLowerCase().replace(/\s+/g, "");
}

function hasExplicitNumericGoalValue(message: string): boolean {
  return /[0-9０-９]/.test(message);
}

function hasCalorieGoalTargetContext(message: string): boolean {
  const action = "(?:改成|設定|調(?:成|整|低)|降低|降到|目標|每日目標|熱量目標|卡路里目標|goal)";
  const calorie = "(?:卡路里|熱量|kcal|calorie)";
  return new RegExp(`${action}.{0,16}${calorie}|${calorie}.{0,16}${action}`, "i").test(message)
    || /(每日)?目標|\bgoal\b|改成|設定|調(?:成|整|低)|降低|降到/i.test(message);
}

function hasGoalTargetContext(input: RelativeLowerIntentInput): boolean {
  return Boolean(input.activeProposalTargets)
    || input.hasActiveGoalProposal === true
    || hasCalorieGoalTargetContext(input.userMessage)
    || /每日目標|安全下限|卡路里[^\n]*kcal|熱量目標/.test(input.previousAssistantMessage ?? "");
}

function mentionsNonCalorieMacro(message: string): boolean {
  return /(蛋白質|protein|碳水|carb|脂肪|fat)/i.test(message);
}

function mentionsCalories(message: string): boolean {
  return /(卡路里|熱量|kcal|calorie)/i.test(message);
}

export function isRelativeLowerGoalAdjustmentIntent(input: RelativeLowerIntentInput): boolean {
  const conversationalMessage = stripToolLikeRegions(input.userMessage);
  const normalized = normalizeProposalDecisionText(conversationalMessage);
  if (!normalized || hasExplicitNumericGoalValue(normalized)) {
    return false;
  }

  if (/(建議|提案|推薦).*(目標)|目標.*(建議|提案|推薦)/i.test(normalized)) {
    return false;
  }

  const hasLowerIntent = /(再?低一點|低一些|再?降一點|降低一點|調低一點|熱量少一點|卡路里少一點|目標少一點|再低|更低|還是太高|仍然太高|還太高|太高了?|正常一點|正常一些)/i.test(normalized);
  if (!hasLowerIntent) {
    return false;
  }

  if (mentionsNonCalorieMacro(conversationalMessage) && !mentionsCalories(conversationalMessage)) {
    return false;
  }

  return hasGoalTargetContext({
    ...input,
    userMessage: conversationalMessage,
  });
}

export function hasReasonableGoalMacroCalories(targets: DailyTargets): boolean {
  if (targets.calories <= 0) {
    return false;
  }
  const macroCalories = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
  return Math.abs(macroCalories - targets.calories) / targets.calories <= 0.1;
}

const EQUIVALENT_CALORIE_TOLERANCE = 10;
const EQUIVALENT_MACRO_TOLERANCE = 2;

export function areGoalTargetsEquivalent(a: DailyTargets, b: DailyTargets): boolean {
  return Math.abs(a.calories - b.calories) <= EQUIVALENT_CALORIE_TOLERANCE
    && Math.abs(a.protein - b.protein) <= EQUIVALENT_MACRO_TOLERANCE
    && Math.abs(a.carbs - b.carbs) <= EQUIVALENT_MACRO_TOLERANCE
    && Math.abs(a.fat - b.fat) <= EQUIVALENT_MACRO_TOLERANCE;
}

export function isGoalMacroCaloriesOverAllocated(targets: DailyTargets): boolean {
  if (targets.calories <= 0) {
    return true;
  }
  const macroCalories = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
  return macroCalories > targets.calories * 1.1;
}

export function isGoalExplanationQuestion(message: string): boolean {
  const normalized = normalizeGoalIntentText(message);
  if (!normalized || isExplicitGoalApplyIntent(normalized)) {
    return false;
  }
  return /(?:為什麼|為何|怎麼來|依據|原因|why|how).*(?:數值|數字|目標|卡路里|熱量|kcal|goal|target)|(?:數值|數字|目標|卡路里|熱量|kcal|goal|target).*(?:為什麼|為何|怎麼來|依據|原因|why|how)/i
    .test(normalized)
    || /(?:為什麼|為何|why).*[0-9０-９]/i.test(normalized);
}

export function isGoalConfirmationQuestion(message: string): boolean {
  const normalized = normalizeGoalIntentText(message);
  if (!normalized || isExplicitGoalApplyIntent(normalized) || /^(?:取消|不要|不用|先不用|no|nope)$/i.test(normalized)) {
    return false;
  }
  const hasQuestionMarker = /[?？]|嗎|么|可不可以|行不行|可以嗎|行嗎|ok嗎|okay嗎/i.test(normalized);
  if (!hasQuestionMarker) {
    return false;
  }
  return /[0-9０-９]|這樣|這組|目標|每日目標|卡路里|熱量|kcal|calorie|goal|target|改成|設定|調低|降低|再低/i
    .test(normalized);
}

export function isExplicitGoalApplyIntent(message: string): boolean {
  const normalized = normalizeGoalIntentText(message);
  if (!normalized || /[?？]|嗎|么|可不可以|行不行|可以嗎|行嗎|為什麼|為何|怎麼來|依據|why|how/i.test(normalized)) {
    return false;
  }
  return /^(?:套用|apply)(?:每日)?(?:目標)?/i.test(normalized)
    || /(?:請把|幫我|直接|就|那|改|設定|更新|套用).{0,8}(?:每日目標|目標|卡路里|熱量)?.{0,8}(?:改成|設成|設定|更新|套用|用)/i.test(normalized)
    || /(?:每日目標|目標|卡路里|熱量).{0,8}(?:改成|設成|設定|更新|套用|用)/i.test(normalized);
}

export function validateRelativeLowerGoalProposal(
  input: RelativeLowerValidationInput,
): RelativeLowerGoalProposalValidationResult {
  if (!input.activeProposalTargets || !isRelativeLowerGoalAdjustmentIntent(input)) {
    return { ok: true, reason: "not_relative_lower" };
  }

  if (input.activeProposalTargets.calories <= NUTRITION_SAFETY_CALORIE_FLOOR) {
    return { ok: false, reason: "active_at_floor" };
  }

  if (input.proposedTargets.calories < NUTRITION_SAFETY_CALORIE_FLOOR) {
    return { ok: false, reason: "below_floor" };
  }

  if (input.proposedTargets.calories >= input.activeProposalTargets.calories) {
    return { ok: false, reason: "rebound_or_not_lower" };
  }

  if (!hasReasonableGoalMacroCalories(input.proposedTargets)) {
    return { ok: false, reason: "macro_calorie_inconsistent" };
  }

  return { ok: true, reason: "ok" };
}
