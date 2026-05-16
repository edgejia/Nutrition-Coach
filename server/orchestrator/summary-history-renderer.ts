import { currentAppDate, formatLocalDate } from "../lib/time.js";
import type { DailySummary } from "../services/summary.js";

export interface SummaryHistoryFacts {
  dailySummary?: DailySummary;
  meals: Array<{
    foodName: string;
    calories: number;
  }>;
}

interface SummaryHistoryRenderOptions {
  currentDate?: Date;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatSummaryDateLabel(
  dateKey: string | undefined,
  currentDate = currentAppDate(),
): string {
  if (!dateKey || dateKey === formatLocalDate(currentDate)) {
    return "今天";
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return dateKey;
  }

  return `${Number(match[2])}/${Number(match[3])}`;
}

function persistedMealTotalCalories(facts: SummaryHistoryFacts): number {
  return facts.meals.reduce((sum, meal) => sum + meal.calories, 0);
}

function hasPersistedMealFacts(facts: SummaryHistoryFacts): boolean {
  return facts.meals.length > 0;
}

function concreteMealPattern(): RegExp {
  return /[\p{Script=Han}A-Za-z0-9]{1,16}(?:飯|麵|粥|湯|便當|沙拉|咖哩|吐司|三明治|漢堡|拿鐵|豆腐|鮭魚|雞胸|牛肉|滷肉)/u;
}

function hasConcreteMealName(advice: string, facts: SummaryHistoryFacts): boolean {
  if (facts.meals.some((meal) => meal.foodName && advice.includes(meal.foodName))) {
    return true;
  }
  return concreteMealPattern().test(advice);
}

function hasKcalClaim(advice: string): boolean {
  return /\d+(?:\.\d+)?\s*(?:kcal|大卡|卡路里|卡)/i.test(advice);
}

function hasMealCountClaim(advice: string): boolean {
  return /(?:\d+|[零一二兩三四五六七八九十百千]+)\s*餐/.test(advice);
}

function hasMacroAttribution(advice: string): boolean {
  return /(?:蛋白質|碳水|碳水化合物|脂肪|protein|carbs?|fat)\s*\d+(?:\.\d+)?\s*g/i.test(advice);
}

function hasUnsafeSummaryHistoryClaim(advice: string, facts: SummaryHistoryFacts): boolean {
  return (
    hasConcreteMealName(advice, facts) ||
    hasKcalClaim(advice) ||
    hasMealCountClaim(advice) ||
    hasMacroAttribution(advice)
  );
}

export function renderSummaryHistoryFacts(
  facts: SummaryHistoryFacts,
  options: SummaryHistoryRenderOptions = {},
): string {
  const dateLabel = formatSummaryDateLabel(facts.dailySummary?.date, options.currentDate);
  if (!hasPersistedMealFacts(facts)) {
    return `${dateLabel}已記錄 0 餐，共 0 kcal。`;
  }

  const mealCount = facts.meals.length;
  const totalCalories = persistedMealTotalCalories(facts);
  const mealText = facts.meals
    .map((meal) => `${meal.foodName} ${formatNumber(meal.calories)} kcal`)
    .join("、");

  return `${dateLabel}已記錄 ${mealCount} 餐，共 ${formatNumber(totalCalories)} kcal：${mealText}。`;
}

export function guardSummaryHistoryAdvice(
  advice: string | undefined,
  facts: SummaryHistoryFacts,
): string {
  const trimmed = advice?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (hasUnsafeSummaryHistoryClaim(trimmed, facts)) {
    return "";
  }
  return trimmed;
}

export function composeSummaryHistoryReply(
  facts: SummaryHistoryFacts,
  advice?: string,
  options: SummaryHistoryRenderOptions = {},
): string {
  const deterministicFacts = renderSummaryHistoryFacts(facts, options);
  const acceptedAdvice = guardSummaryHistoryAdvice(advice, facts);
  if (!acceptedAdvice) {
    return deterministicFacts;
  }
  return `${deterministicFacts}\n\n${acceptedAdvice}`;
}
