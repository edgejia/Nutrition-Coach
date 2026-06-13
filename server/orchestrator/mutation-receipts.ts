import { currentAppDate, formatLocalDate } from "../lib/time.js";
import type {
  MealNumericAffectedField,
  MealNumericField,
} from "../services/meal-numeric-proposals.js";
import type { MealDeleteProposalSnapshot } from "../services/meal-delete-proposals.js";
import type { MealCorrectionCandidate } from "../services/meal-correction.js";
import type { DailyTargets } from "../services/device.js";
import type { MutationEffects } from "./mutation-effects.js";

export const FORBIDDEN_RECEIPT_TERMS = [
  "headline",
  "先抓低",
  "保守估算",
  "log_food",
  "update_meal",
  "delete_meal",
  "update_goals",
  "revision",
  "deviceId",
  "mealMutationKind",
  "summaryOutcome",
  "dailySummary",
  "recompute_failed",
  "publish_failed",
  "dailyTargets",
  "contractResult",
  "daily_summary",
  "provider",
  "debug",
  "tool",
  "API",
  "endpoint",
  "route",
  "payload",
  "field",
  "request",
  "response",
  "JSON",
  "PATCH",
  "POST",
  "DELETE",
  "/api",
  "body",
  "status code",
] as const;

export function assertNoForbiddenReceiptTerms(text: string): string[] {
  return FORBIDDEN_RECEIPT_TERMS.filter((term) => text.includes(term));
}

function formatReceiptDateLabel(dateKey: string, currentDate = currentAppDate()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return dateKey;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year === currentDate.getFullYear()
    ? `${month}/${day}`
    : `${year}/${month}/${day}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

const MEAL_NUMERIC_FIELD_COPY: Record<MealNumericField, { label: string; unit: string }> = {
  calories: { label: "卡路里", unit: "kcal" },
  protein: { label: "蛋白質", unit: "g" },
  carbs: { label: "碳水", unit: "g" },
  fat: { label: "脂肪", unit: "g" },
};

const MEAL_NUMERIC_OPERATOR_COPY: Record<string, string> = {
  half: "減半",
  set: "指定目標數字",
  reduce_percent: "按比例減少",
  add: "增加固定數值",
  subtract: "減少固定數值",
};

type CorrectionTargetAction = "update" | "delete";

export interface CorrectionTargetClarificationCopyInput {
  action: CorrectionTargetAction;
  candidates: MealCorrectionCandidate[];
  matchedLabel?: string;
}

export interface CorrectionTargetSameDateRecoveryCopyInput {
  action: CorrectionTargetAction;
  dateKey: string;
  candidates: MealCorrectionCandidate[];
}

export interface CorrectionTargetNoMealsForDateCopyInput {
  action: CorrectionTargetAction;
  dateKey: string;
}

export interface HistoricalClarificationCopyInput {
  prompt: string;
}

export interface HistoricalSummaryMultipleTargetsCopyInput {
  dateKeys: string[];
}

export interface MealNumericProposalCopyInput {
  mealLabel?: string;
  items?: Array<{ foodName: string }>;
  affectedFields: MealNumericAffectedField[];
  sourceOperator?: string;
  otherProposalKindActive?: boolean;
}

export interface MealNumericFieldAwareCopyInput {
  field?: MealNumericField;
}

export interface MealDeleteProposalCopyInput {
  snapshot: MealDeleteProposalSnapshot;
  otherProposalKindActive?: boolean;
}

function formatMealNumericValue(field: MealNumericField, value: number): string {
  const copy = MEAL_NUMERIC_FIELD_COPY[field];
  return `${formatNumber(value)} ${copy.unit}`;
}

function mealNumericFieldLabel(field: MealNumericField): string {
  return MEAL_NUMERIC_FIELD_COPY[field].label;
}

function correctionTargetActionVerb(action: CorrectionTargetAction): string {
  return action === "update" ? "修改" : "刪除";
}

function formatCorrectionTargetTime(loggedAt: string): string {
  const local = new Date(loggedAt);
  const hour = `${local.getHours()}`.padStart(2, "0");
  const minute = `${local.getMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatCorrectionTargetMealPeriod(candidate: MealCorrectionCandidate): string {
  if (candidate.mealPeriodSource !== "explicit") {
    return "";
  }

  switch (candidate.mealPeriod) {
    case "breakfast":
      return " 早餐";
    case "lunch":
      return " 午餐";
    case "dinner":
      return " 晚餐";
    case "late_night":
      return " 宵夜";
    default:
      return "";
  }
}

function formatCorrectionTargetOption(
  candidate: MealCorrectionCandidate,
  index: number,
): string {
  return `${index + 1}. ${candidate.dateKey} ${formatCorrectionTargetTime(candidate.loggedAt)}${formatCorrectionTargetMealPeriod(candidate)} ${candidate.foodName}`;
}

function formatCorrectionTargetOptions(candidates: MealCorrectionCandidate[]): string[] {
  return candidates.slice(0, 5).map((candidate, index) => formatCorrectionTargetOption(candidate, index));
}

export function renderCorrectionTargetClarificationCopy(
  input: CorrectionTargetClarificationCopyInput,
): string {
  const safeLabel = input.matchedLabel?.trim();
  const verb = correctionTargetActionVerb(input.action);
  const leadIn = safeLabel
    ? `我找到多筆可能符合「${safeLabel}」的餐點，請直接回覆編號：`
    : `我找到多筆可能要${verb}的餐點，請直接回覆編號：`;

  return [leadIn, ...formatCorrectionTargetOptions(input.candidates)].join("\n");
}

export function renderCorrectionTargetSameDateRecoveryCopy(
  input: CorrectionTargetSameDateRecoveryCopyInput,
): string {
  const sameDateCandidates = input.candidates.filter((candidate) => candidate.dateKey === input.dateKey);
  return [
    `${input.dateKey} 有幾筆餐點，請直接回覆編號：`,
    ...formatCorrectionTargetOptions(sameDateCandidates),
  ].join("\n");
}

export function renderCorrectionTargetNoMealsForDateCopy(
  input: CorrectionTargetNoMealsForDateCopyInput,
): string {
  const verb = correctionTargetActionVerb(input.action);
  return `${input.dateKey} 沒有記錄餐點，所以我還不能${verb}那一天的餐點。請提供另一個日期或食物名稱。`;
}

export function renderHistoricalLogFoodClarificationCopy(
  input: HistoricalClarificationCopyInput,
): string {
  return `這次沒有記錄餐點。${input.prompt}`;
}

export function renderHistoricalSummaryClarificationCopy(
  input: HistoricalClarificationCopyInput,
): string {
  return input.prompt;
}

export function renderHistoricalSummaryMultipleTargetsCopy(
  input: HistoricalSummaryMultipleTargetsCopyInput,
): string {
  const choices = input.dateKeys.map((dateKey, index) => `${index + 1}. ${dateKey}`);
  return [
    "我目前一次只能看一個日期。請回覆其中一個日期：",
    ...choices,
  ].join("\n");
}

function formatMealProposalLabel(input: Pick<MealNumericProposalCopyInput, "mealLabel" | "items">): string {
  const explicit = input.mealLabel?.trim();
  if (explicit) {
    return explicit;
  }

  const itemNames = input.items
    ?.map((item) => item.foodName.trim())
    .filter((name) => name.length > 0);
  if (itemNames && itemNames.length > 0) {
    return itemNames.join("、");
  }

  return "這筆餐點";
}

function formatAffectedMealNumericField(affected: MealNumericAffectedField): string {
  return `${mealNumericFieldLabel(affected.field)}：${formatMealNumericValue(
    affected.field,
    affected.before,
  )} 改為 ${formatMealNumericValue(affected.field, affected.after)}`;
}

export function renderMealNumericProposalCopy(input: MealNumericProposalCopyInput): string {
  const mealLabel = formatMealProposalLabel(input);
  const operatorCopy = input.sourceOperator ? MEAL_NUMERIC_OPERATOR_COPY[input.sourceOperator] : undefined;
  const heading = operatorCopy
    ? `我可以幫你把${mealLabel}這樣調整（${operatorCopy}）：`
    : `我可以幫你把${mealLabel}這樣調整：`;
  const fieldLines = input.affectedFields.map((field) => `• ${formatAffectedMealNumericField(field)}`);
  const otherProposalLine = input.otherProposalKindActive
    ? "你也有另一組目標提案；若要套用餐點修正，請明確回覆「套用餐點修正」。"
    : undefined;

  return [
    heading,
    ...fieldLines,
    "如果要套用，請回覆「好」；如果要調整，請直接給新的目標數字。",
    ...(otherProposalLine ? [otherProposalLine] : []),
  ].join("\n");
}

export function renderMealNumericAuthorityFailureCopy(
  input: MealNumericFieldAwareCopyInput = {},
): string {
  const fieldText = input.field
    ? `${mealNumericFieldLabel(input.field)}需要明確目標數字，或改用「減半」、「少 20%」、「加 10g」、「少 10g」這類可計算調整。`
    : "請提供明確目標數字，或改用「減半」、「少 20%」、「加 10g」、「少 10g」這類可計算調整。";
  return `這次沒有更新餐點紀錄。${fieldText}`;
}

export function renderMealNumericClarificationCopy(
  input: MealNumericFieldAwareCopyInput = {},
): string {
  const fieldText = input.field
    ? `如果要調整${mealNumericFieldLabel(input.field)}，`
    : "如果要調整餐點數字，";
  return `這次沒有更新餐點紀錄。${fieldText}請給明確目標數字，或說「減半」、「少 20%」、「偏高」這類方向讓我再確認；也可以請我幫你估合理值。`;
}

export function renderMealNumericCancelCopy(): string {
  return "已取消這組餐點修正提案，沒有更新任何餐點紀錄。";
}

function mealPeriodLabel(period: MealDeleteProposalSnapshot["mealPeriod"]): string {
  switch (period) {
    case "breakfast":
      return "早餐";
    case "lunch":
      return "午餐";
    case "dinner":
      return "晚餐";
    case "late_night":
      return "宵夜";
    default:
      return "餐點";
  }
}

export function renderMealDeleteProposalCopy(input: MealDeleteProposalCopyInput): string {
  const { snapshot } = input;
  const itemLines = snapshot.items && snapshot.items.length > 1
    ? [
        "項目：",
        ...snapshot.items.map((item) => `- ${item.foodName} ${formatNumber(item.calories)} kcal`),
      ]
    : [];
  const otherProposalLine = input.otherProposalKindActive
    ? "你也有另一組目標提案；若要刪除這筆餐點，請明確回覆「刪除這筆餐點」。"
    : undefined;

  return [
    `即將刪除：${snapshot.mealLabel}`,
    `日期：${snapshot.dateKey} ${mealPeriodLabel(snapshot.mealPeriod)}`,
    `營養：${formatNumber(snapshot.calories)} kcal，P${formatNumber(snapshot.protein)}g / C${formatNumber(snapshot.carbs)}g / F${formatNumber(snapshot.fat)}g`,
    ...itemLines,
    "如果確認要刪除，請回覆「好」或「確認」；如果取消，餐點紀錄不會變更。",
    ...(otherProposalLine ? [otherProposalLine] : []),
  ].join("\n");
}

export function renderMealDeleteCancelCopy(): string {
  return "已取消刪除這筆餐點，餐點紀錄沒有變更。";
}

export function renderMealDeleteAuthorityFailureCopy(): string {
  return "這次沒有刪除餐點紀錄。刪除確認已失效，請重新選擇要刪除的餐點。";
}

export function renderMealDeleteStaleCopy(): string {
  return "這次沒有刪除餐點紀錄。餐點內容已經變更，請重新選擇要刪除的餐點。";
}

export function renderProposalKindAmbiguityCopy(): string {
  return "這次沒有更新任何內容。你同時有餐點修正和每日目標提案，請回覆「套用餐點修正」或「套用每日目標」。";
}

export function renderGoalProposalCopy(targets: DailyTargets): string {
  return [
    "我可以先幫你改成這組每日目標：",
    `• 卡路里 ${formatNumber(targets.calories)} kcal`,
    `• 蛋白質 ${formatNumber(targets.protein)} g`,
    `• 碳水 ${formatNumber(targets.carbs)} g`,
    `• 脂肪 ${formatNumber(targets.fat)} g`,
    "如果要套用，請回覆「好」；如果要調整，請直接給新的數字。",
  ].join("\n");
}

export function renderGoalAuthorityFailureCopy(): string {
  return "這次沒有套用目標更新。請直接提供新的每日目標數字，或再請我產生一組建議。";
}

type GoalTargetField = keyof DailyTargets;

const GOAL_FIELD_RANGE_COPY: Record<GoalTargetField, { label: string; range: string }> = {
  calories: { label: "卡路里", range: "500-8000 kcal" },
  protein: { label: "蛋白質", range: "0-400 g" },
  carbs: { label: "碳水", range: "0-1000 g" },
  fat: { label: "脂肪", range: "0-300 g" },
};

export function renderGoalValidationFailureCopy(fields: GoalTargetField[]): string {
  if (fields.length === 1) {
    const field = GOAL_FIELD_RANGE_COPY[fields[0]];
    return `這次沒有套用目標更新。${field.label}需介於 ${field.range}，請提供範圍內的每日目標數字。`;
  }

  const ranges = fields.map((field) => {
    const range = GOAL_FIELD_RANGE_COPY[field];
    return `• ${range.label} ${range.range}`;
  });

  return [
    "這次沒有套用目標更新。請確認以下每日目標範圍：",
    ...ranges,
    "請提供範圍內的每日目標數字。",
  ].join("\n");
}

export function renderGoalCancelCopy(): string {
  return "已取消這組目標提案，沒有套用任何更新。之後可以直接提供新的目標數字，或再請我產生一組建議。";
}

function formatDatePrefix(dateKey: string): string {
  return dateKey === formatLocalDate(currentAppDate())
    ? ""
    : `${formatReceiptDateLabel(dateKey)} `;
}

function logUncertaintySuffix(effects: MutationEffects): string {
  if (
    effects.kind === "log" &&
    (effects.meal.quantityUncertaintyReason === "missing_quantity" ||
      effects.meal.usedConservativeAssumption === true)
  ) {
    return "若份量不同，可以再調整。";
  }
  return "";
}

export function renderMutationReceipt(effects: MutationEffects): string {
  switch (effects.kind) {
    case "log": {
      const datePrefix = formatDatePrefix(effects.meal.dateKey || effects.affectedDate);
      return `已記錄${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。${logUncertaintySuffix(effects)}`;
    }
    case "update": {
      const datePrefix = formatDatePrefix(effects.meal.dateKey || effects.affectedDate);
      return `已更新${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。`;
    }
    case "delete": {
      const datePrefix = formatDatePrefix(effects.deletedMeal.dateKey || effects.affectedDate);
      return `已刪除${datePrefix}${effects.deletedMeal.foodName}，已從當日紀錄移除。`;
    }
    case "goals":
      return [
        "已更新每日目標：",
        `• 卡路里 ${formatNumber(effects.targets.calories)} kcal`,
        `• 蛋白質 ${formatNumber(effects.targets.protein)} g`,
        `• 碳水 ${formatNumber(effects.targets.carbs)} g`,
        `• 脂肪 ${formatNumber(effects.targets.fat)} g`,
      ].join("\n");
  }
}
