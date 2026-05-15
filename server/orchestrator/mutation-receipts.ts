import { currentAppDate, formatLocalDate } from "../lib/time.js";
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
