import { currentAppDate, formatLocalDate } from "../lib/time.js";
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
  "dailySummary",
  "dailyTargets",
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
