export const MEAL_PERIODS = ["breakfast", "lunch", "dinner", "late_night"] as const;

export type MealPeriod = typeof MEAL_PERIODS[number];

const MEAL_PERIOD_SET = new Set<MealPeriod>(MEAL_PERIODS);

const DIRECT_MEAL_PERIOD_PATTERNS: Array<{ period: MealPeriod; pattern: RegExp }> = [
  { period: "breakfast", pattern: /早餐|早飯|早饭/g },
  { period: "lunch", pattern: /午餐|午飯|午饭/g },
  { period: "dinner", pattern: /晚餐|晚飯|晚饭/g },
  { period: "late_night", pattern: /宵夜/g },
];

export function normalizeMealPeriod(value: unknown): MealPeriod | undefined {
  return typeof value === "string" && MEAL_PERIOD_SET.has(value as MealPeriod)
    ? (value as MealPeriod)
    : undefined;
}

export function extractExplicitMealPeriodFromSourceText(sourceText: string): MealPeriod | undefined {
  if (!sourceText.trim()) {
    return undefined;
  }

  const matchedPeriods = new Set<MealPeriod>();

  for (const { period, pattern } of DIRECT_MEAL_PERIOD_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(sourceText)) {
      matchedPeriods.add(period);
    }
  }

  return matchedPeriods.size === 1 ? [...matchedPeriods][0] : undefined;
}
