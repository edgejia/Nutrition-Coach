import type { DailyTargets } from "../services/device.js";
import type { ChatMutationOutcomeFact } from "../services/chat-mutation-outcomes.js";
import type { DailySummary } from "../services/summary.js";
import type { SummaryOutcome } from "../services/summary-outcome.js";

export interface CommittedMealFacts {
  mealId: string;
  mealRevisionId: string;
  dateKey: string;
  loggedAt: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  itemCount: number;
  quantityUncertaintyReason?: "missing_quantity";
  usedConservativeAssumption?: boolean;
}

export interface DeletedMealSnapshot {
  mealId: string;
  dateKey: string;
  loggedAt: string;
  foodName: string;
  calories?: number;
  protein?: number;
}

interface MutationEffectsBase {
  affectedDate: string;
  committedTargets: DailyTargets;
}

interface MealMutationEffectsBase extends MutationEffectsBase {
  summaryOutcome: SummaryOutcome;
}

interface GoalsMutationEffectsBase extends MutationEffectsBase {
  committedSummary?: DailySummary;
}

export interface LogMutationEffects extends MealMutationEffectsBase {
  kind: "log";
  meal: CommittedMealFacts;
}

export interface UpdateMutationEffects extends MealMutationEffectsBase {
  kind: "update";
  meal: CommittedMealFacts;
}

export interface DeleteMutationEffects extends MealMutationEffectsBase {
  kind: "delete";
  deletedMeal: DeletedMealSnapshot;
}

export interface GoalsMutationEffects extends GoalsMutationEffectsBase {
  kind: "goals";
  targets: DailyTargets;
  updatedFields: Array<keyof DailyTargets>;
}

export type MutationEffects =
  | LogMutationEffects
  | UpdateMutationEffects
  | DeleteMutationEffects
  | GoalsMutationEffects;

type GoalField = keyof DailyTargets;

const GOAL_FACT_LABELS: Record<GoalField, "卡路里" | "蛋白質" | "碳水" | "脂肪"> = {
  calories: "卡路里",
  protein: "蛋白質",
  carbs: "碳水",
  fat: "脂肪",
};

const GOAL_FACT_UNITS: Record<GoalField, "kcal" | "g"> = {
  calories: "kcal",
  protein: "g",
  carbs: "g",
  fat: "g",
};

function finiteNutrition(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mealFactNutrition(
  meal: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  },
) {
  return {
    ...(finiteNutrition(meal.calories) === undefined ? {} : { calories: finiteNutrition(meal.calories) }),
    ...(finiteNutrition(meal.protein) === undefined ? {} : { protein: finiteNutrition(meal.protein) }),
    ...(finiteNutrition(meal.carbs) === undefined ? {} : { carbs: finiteNutrition(meal.carbs) }),
    ...(finiteNutrition(meal.fat) === undefined ? {} : { fat: finiteNutrition(meal.fat) }),
  };
}

export function mutationOutcomeFactFromEffects(
  effects: MutationEffects,
): ChatMutationOutcomeFact {
  if (effects.kind === "goals") {
    return {
      action: "update_goals",
      affectedDate: effects.affectedDate,
      updatedGoals: effects.updatedFields
        .filter((field) => Number.isFinite(effects.targets[field]))
        .map((field) => ({
          label: GOAL_FACT_LABELS[field],
          value: effects.targets[field],
          unit: GOAL_FACT_UNITS[field],
        })),
    };
  }

  if (effects.kind === "delete") {
    return {
      action: "delete_meal",
      affectedDate: effects.affectedDate,
      foodName: effects.deletedMeal.foodName,
      ...mealFactNutrition(effects.deletedMeal),
    };
  }

  return {
    action: effects.kind === "log" ? "log_food" : "update_meal",
    affectedDate: effects.affectedDate,
    foodName: effects.meal.foodName,
    ...mealFactNutrition(effects.meal),
  };
}
