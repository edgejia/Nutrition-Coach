import type { DailySummary } from "./types.js";

interface RefreshAfterMealMutationDeps<Meal> {
  redactChatReceiptIdentity: (mealId: string) => void;
  recordMealMutation: (affectedDate: string) => void;
  setDailySummary: (dailySummary: DailySummary) => void;
  getMeals: (options: { refreshReason: "meal_mutation" }) => Promise<{ meals: Meal[] }>;
  setMeals: (meals: Meal[]) => void;
  todayKey: () => string;
}

interface RefreshAfterMealMutationInput {
  mealId: string;
  affectedDate: string;
  dailySummary?: DailySummary;
}

export async function refreshAfterMealMutation<Meal>(
  deps: RefreshAfterMealMutationDeps<Meal>,
  input: RefreshAfterMealMutationInput,
) {
  const today = deps.todayKey();

  deps.redactChatReceiptIdentity(input.mealId);
  deps.recordMealMutation(input.affectedDate);

  if (input.dailySummary?.date === today) {
    deps.setDailySummary(input.dailySummary);
  }

  if (input.affectedDate !== today) {
    return;
  }

  const { meals } = await deps.getMeals({ refreshReason: "meal_mutation" });
  deps.setMeals(meals);
}
