import type { DailySummary, DailyTargets } from "../types.js";

export interface HomeNutritionSnapshot {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  targets: DailyTargets;
}

export type HomeAnimationIntent =
  | { kind: "replay" }
  | { kind: "delta"; from: HomeNutritionSnapshot }
  | { kind: "none" };

export type HomeEntryTrigger =
  | "cold_start"
  | "manual_refresh"
  | "meal_mutation"
  | "nav_from_chat"
  | "nav_from_history";

export function buildHomeNutritionSnapshot(input: {
  date: string;
  summary: Pick<DailySummary, "totalCalories" | "totalProtein" | "totalCarbs" | "totalFat"> | null;
  targets: DailyTargets | null;
}): HomeNutritionSnapshot {
  return {
    date: input.date,
    kcal: Math.round(input.summary?.totalCalories ?? 0),
    protein: Math.round(input.summary?.totalProtein ?? 0),
    carbs: Math.round(input.summary?.totalCarbs ?? 0),
    fat: Math.round(input.summary?.totalFat ?? 0),
    targets: {
      calories: Math.round(input.targets?.calories ?? 0),
      protein: Math.round(input.targets?.protein ?? 0),
      carbs: Math.round(input.targets?.carbs ?? 0),
      fat: Math.round(input.targets?.fat ?? 0),
    },
  };
}

export function snapshotsEqual(a: HomeNutritionSnapshot, b: HomeNutritionSnapshot): boolean {
  return a.kcal === b.kcal && a.protein === b.protein && a.carbs === b.carbs && a.fat === b.fat;
}

export function isNavigationEntryTrigger(trigger: HomeEntryTrigger): boolean {
  return trigger === "nav_from_chat" || trigger === "nav_from_history";
}

export function deriveHomeEntryIntent(input: {
  trigger: HomeEntryTrigger;
  today: string;
  baseline: HomeNutritionSnapshot | null;
  current: HomeNutritionSnapshot;
  unseenTodayMutation: boolean;
}): { intent: HomeAnimationIntent; nextBaseline: HomeNutritionSnapshot } {
  if (!input.baseline || input.baseline.date !== input.today) {
    return { intent: { kind: "replay" }, nextBaseline: input.current };
  }

  if (input.trigger === "manual_refresh") {
    return {
      intent: snapshotsEqual(input.baseline, input.current)
        ? { kind: "replay" }
        : { kind: "delta", from: input.baseline },
      nextBaseline: input.current,
    };
  }

  if (input.trigger === "meal_mutation") {
    return {
      intent: snapshotsEqual(input.baseline, input.current)
        ? { kind: "none" }
        : { kind: "delta", from: input.baseline },
      nextBaseline: input.current,
    };
  }

  if (isNavigationEntryTrigger(input.trigger)) {
    return {
      intent: input.unseenTodayMutation
        ? { kind: "delta", from: input.baseline }
        : { kind: "replay" },
      nextBaseline: input.current,
    };
  }

  return { intent: { kind: "replay" }, nextBaseline: input.current };
}

export function applyMealMutationMark(input: {
  affectedDate: string;
  today: string;
  homeVisible: boolean;
  unseenTodayMutation: boolean;
}): boolean {
  if (input.affectedDate !== input.today || input.homeVisible) {
    return input.unseenTodayMutation;
  }
  return true;
}
