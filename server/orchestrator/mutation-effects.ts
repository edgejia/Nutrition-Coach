import type { DailyTargets } from "../services/device.js";
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
  committedSummary: DailySummary;
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
