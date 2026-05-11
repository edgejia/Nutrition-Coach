import type { DailyTargets } from "../services/device.js";
import type { DailySummary } from "../services/summary.js";

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
  committedSummary: DailySummary;
  committedTargets: DailyTargets;
}

export interface LogMutationEffects extends MutationEffectsBase {
  kind: "log";
  meal: CommittedMealFacts;
}

export interface UpdateMutationEffects extends MutationEffectsBase {
  kind: "update";
  meal: CommittedMealFacts;
}

export interface DeleteMutationEffects extends MutationEffectsBase {
  kind: "delete";
  deletedMeal: DeletedMealSnapshot;
}

export interface GoalsMutationEffects extends MutationEffectsBase {
  kind: "goals";
  targets: DailyTargets;
  updatedFields: Array<keyof DailyTargets>;
}

export type MutationEffects =
  | LogMutationEffects
  | UpdateMutationEffects
  | DeleteMutationEffects
  | GoalsMutationEffects;
