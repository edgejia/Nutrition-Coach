import type { DailySummarySSEPayload } from "./types.js";

export type MealRowRefreshReason = "day_rollover" | "meal_mutation";

export interface SSESummaryCoordinatorDeps<Meal> {
  getMeals: (options?: { refreshReason?: MealRowRefreshReason }) => Promise<{ meals: Meal[] }>;
  setMeals: (meals: Meal[]) => void;
  setDailySummary: (summary: DailySummarySSEPayload["summary"]) => void;
  recordMealMutation: (affectedDate: string) => void;
  todayKey: () => string;
  onUnauthorized?: () => void | Promise<void>;
}

export interface SSESummaryCoordinator<Meal> {
  handleSummary: (payload: DailySummarySSEPayload) => Promise<void>;
  runInitialMealsLoad: (options?: { refreshReason?: MealRowRefreshReason }) => Promise<void>;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && error.message === "UNAUTHORIZED";
}

export function createSSESummaryCoordinator<Meal>(
  deps: SSESummaryCoordinatorDeps<Meal>,
): SSESummaryCoordinator<Meal> {
  let latestToken = 0;
  let rowsLoaded = false;
  let sameDayCommitSeen = false;

  const nextToken = () => {
    latestToken += 1;
    return latestToken;
  };

  const handleLoadError = (error: unknown) => {
    if (isUnauthorized(error)) {
      void deps.onUnauthorized?.();
    }
  };

  const commitRowsIfLatest = (token: number, meals: Meal[]) => {
    if (token !== latestToken) {
      return false;
    }
    deps.setMeals(meals);
    rowsLoaded = true;
    return true;
  };

  const reconcileTodayRowsBeforeSummary = async (payload: DailySummarySSEPayload) => {
    const token = nextToken();
    try {
      const { meals } = await deps.getMeals({ refreshReason: "meal_mutation" });
      if (!commitRowsIfLatest(token, meals)) {
        return;
      }
      sameDayCommitSeen = true;
      deps.setDailySummary(payload.summary);
    } catch (error) {
      handleLoadError(error);
    }
  };

  const refreshTodayRowsAfterInitialSummary = async () => {
    const token = nextToken();
    try {
      const { meals } = await deps.getMeals({ refreshReason: "meal_mutation" });
      commitRowsIfLatest(token, meals);
    } catch (error) {
      handleLoadError(error);
    }
  };

  return {
    async handleSummary(payload) {
      const today = deps.todayKey();
      if (payload.affectedDate > today) {
        return;
      }
      if (payload.affectedDate < today) {
        deps.recordMealMutation(payload.affectedDate);
        return;
      }

      if (payload.source === "meal_mutation") {
        await reconcileTodayRowsBeforeSummary(payload);
        return;
      }

      if (!sameDayCommitSeen) {
        sameDayCommitSeen = true;
      }
      deps.setDailySummary(payload.summary);
      if (rowsLoaded) {
        await refreshTodayRowsAfterInitialSummary();
      }
    },

    async runInitialMealsLoad(options) {
      const token = nextToken();
      try {
        const { meals } = await deps.getMeals(options);
        if (commitRowsIfLatest(token, meals)) {
          sameDayCommitSeen = true;
        }
      } catch (error) {
        handleLoadError(error);
      }
    },
  };
}
