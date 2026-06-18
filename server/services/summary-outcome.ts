import type { createFoodLoggingService } from "./food-logging.js";
import type { createSummaryService, DailySummary } from "./summary.js";

export type SummaryOutcome =
  | { status: "fresh"; dailySummary: DailySummary }
  | { status: "recovered"; dailySummary: DailySummary; reason: "recompute_failed" }
  | { status: "unavailable"; reason: "recompute_failed" };

export function dailySummaryFromOutcome(outcome: SummaryOutcome): DailySummary | undefined {
  return outcome.status === "unavailable" ? undefined : outcome.dailySummary;
}

export function buildLocalMidpointDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

type SummaryServiceForOutcome = Pick<ReturnType<typeof createSummaryService>, "getDailySummary">;
type FoodLoggingServiceForOutcome = Pick<ReturnType<typeof createFoodLoggingService>, "getMealsByDate">;

async function recoverDailySummaryFromPersistedMeals(input: {
  deviceId: string;
  affectedDate: string;
  foodLoggingService: FoodLoggingServiceForOutcome;
}): Promise<DailySummary> {
  const meals = await input.foodLoggingService.getMealsByDate(
    input.deviceId,
    buildLocalMidpointDate(input.affectedDate),
  );

  return {
    totalCalories: meals.reduce((sum, meal) => sum + meal.calories, 0),
    totalProtein: meals.reduce((sum, meal) => sum + meal.protein, 0),
    totalCarbs: meals.reduce((sum, meal) => sum + meal.carbs, 0),
    totalFat: meals.reduce((sum, meal) => sum + meal.fat, 0),
    mealCount: meals.length,
    date: input.affectedDate,
  };
}

export async function buildSummaryOutcomeAfterMealCommit(input: {
  deviceId: string;
  affectedDate: string;
  summaryService: SummaryServiceForOutcome;
  foodLoggingService: FoodLoggingServiceForOutcome;
}): Promise<SummaryOutcome> {
  try {
    return {
      status: "fresh",
      dailySummary: await input.summaryService.getDailySummary(
        input.deviceId,
        buildLocalMidpointDate(input.affectedDate),
      ),
    };
  } catch {
    try {
      return {
        status: "recovered",
        reason: "recompute_failed",
        dailySummary: await recoverDailySummaryFromPersistedMeals(input),
      };
    } catch {
      return { status: "unavailable", reason: "recompute_failed" };
    }
  }
}
