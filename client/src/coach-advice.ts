import type { CoachCTA, CoachCTAIntent, CoachCTAIntentId, DailyTargets, DailySummary } from "./types.js";

export type CoachGoal = "fat_loss" | "muscle_gain" | "maintain";

export function narrowGoal(goal: string | null | undefined): CoachGoal {
  return goal === "fat_loss" || goal === "muscle_gain" || goal === "maintain" ? goal : "maintain";
}

export function getEmptyStateCopy(goal: string | null, targets: DailyTargets | null): string {
  if (!targets) {
    return "還沒記錄任何餐點，開始記錄你的第一餐吧";
  }

  const g = narrowGoal(goal);
  if (g === "muscle_gain") {
    return `今天蛋白質目標 ${Math.round(targets.protein)}g，先記錄第一餐幫增肌打底`;
  }
  if (g === "fat_loss") {
    return `今天熱量額度 ${Math.round(targets.calories)} kcal，先記錄第一餐掌握減脂節奏`;
  }
  return "還沒記錄任何餐點，開始記錄你的第一餐吧";
}

export function getCoachAdvice(
  summary: DailySummary | null,
  targets: DailyTargets | null,
  goal: string | null = "maintain",
): string | null {
  if (!summary || !targets) {
    return null;
  }

  if (summary.mealCount === 0) {
    return getEmptyStateCopy(goal, targets);
  }

  const g = narrowGoal(goal);
  if (g === "muscle_gain") {
    const proteinRemaining = Math.max(targets.protein - summary.totalProtein, 0);
    const caloriesRemaining = Math.max(targets.calories - summary.totalCalories, 0);
    if (proteinRemaining > 30) {
      return `蛋白質還差 ${Math.round(proteinRemaining)}g，記得再補一餐`;
    }
    if (caloriesRemaining > 200) {
      return `今天還有 ${Math.round(caloriesRemaining)} kcal 空間，記得再補一餐`;
    }
    if (summary.totalFat > targets.fat) {
      return "脂肪已超標，接下來選低油高蛋白食物";
    }
    return "今天增肌節奏穩定，繼續把蛋白質補齊";
  }

  if (g === "fat_loss") {
    const caloriesRemaining = targets.calories - summary.totalCalories;
    if (caloriesRemaining < 200) {
      return "熱量快到上限了，晚餐吃清淡一點";
    }

    if (summary.totalFat > targets.fat) {
      return "脂肪已超標，接下來避免油炸食物";
    }

    const proteinRemaining = Math.max(targets.protein - summary.totalProtein, 0);
    if (proteinRemaining > 30) {
      return `蛋白質還差 ${Math.round(proteinRemaining)}g，下一餐選低脂高蛋白`;
    }

    return "今天減脂節奏穩定，繼續掌握份量";
  }

  const proteinRemaining = Math.max(targets.protein - summary.totalProtein, 0);
  if (proteinRemaining > 30) {
    return `蛋白質還差 ${Math.round(proteinRemaining)}g，晚餐建議高蛋白食物`;
  }

  const caloriesRemaining = targets.calories - summary.totalCalories;
  if (caloriesRemaining < 200) {
    return "熱量快到上限了，晚餐吃清淡一點";
  }

  if (summary.totalFat > targets.fat) {
    return "脂肪已超標，接下來避免油炸食物";
  }

  return "今天攝取均衡，繼續保持！";
}

export const COACH_CTA_INTENTS = [
  {
    id: "protein",
    label: "補蛋白質",
    options: [
      {
        id: "protein-convenience-store",
        label: "推薦三個便利商店高蛋白選擇",
        prompt: "推薦三個便利商店高蛋白選擇",
      },
      {
        id: "protein-dinner-budget",
        label: "用我今天剩餘熱量安排高蛋白晚餐",
        prompt: "用我今天剩餘熱量安排高蛋白晚餐",
      },
      {
        id: "protein-gap-estimate",
        label: "幫我估算今天還差多少蛋白質",
        prompt: "幫我估算今天還差多少蛋白質",
      },
    ],
  },
  {
    id: "next_meal",
    label: "安排下一餐",
    options: [
      {
        id: "next-meal-calorie-budget",
        label: "用我今天剩餘熱量安排下一餐",
        prompt: "用我今天剩餘熱量安排下一餐",
      },
      {
        id: "next-meal-eating-out",
        label: "給我一份外食下一餐建議",
        prompt: "給我一份外食下一餐建議",
      },
      {
        id: "next-meal-low-oil-protein-dinner",
        label: "幫我安排低油高蛋白晚餐",
        prompt: "幫我安排低油高蛋白晚餐",
      },
    ],
  },
  {
    id: "calorie_control",
    label: "控制熱量",
    options: [
      {
        id: "calorie-remaining-estimate",
        label: "幫我估算現在還能吃多少",
        prompt: "幫我估算現在還能吃多少",
      },
      {
        id: "calorie-low-calorie-finishers",
        label: "推薦三個低熱量收尾選擇",
        prompt: "推薦三個低熱量收尾選擇",
      },
      {
        id: "calorie-dinner-adjustment",
        label: "幫我調整晚餐避免超標",
        prompt: "幫我調整晚餐避免超標",
      },
    ],
  },
  {
    id: "food_logging",
    label: "記錄飲食",
    options: [
      {
        id: "food-logging-guided",
        label: "一步步引導我記錄這餐",
        prompt: "一步步引導我記錄這餐",
      },
      {
        id: "food-logging-estimate-meal",
        label: "幫我估算剛剛這餐的熱量",
        prompt: "幫我估算剛剛這餐的熱量",
      },
      {
        id: "food-logging-today-review",
        label: "幫我整理今天已記錄的飲食",
        prompt: "幫我整理今天已記錄的飲食",
      },
    ],
  },
] as const satisfies readonly CoachCTAIntent[];

const HOME_CTA_INTENT_LIMIT = 3;

function orderIntents(leadId: CoachCTAIntentId): CoachCTA {
  const lead = COACH_CTA_INTENTS.find((intent) => intent.id === leadId);
  const rest = COACH_CTA_INTENTS.filter((intent) => intent.id !== leadId);
  const ordered = lead ? [lead, ...rest] : COACH_CTA_INTENTS;
  return ordered.slice(0, HOME_CTA_INTENT_LIMIT);
}

export function getCoachCTA(
  summary: DailySummary | null,
  targets: DailyTargets | null,
  _hour: number = new Date().getHours(),
): CoachCTA {
  if (!summary || !targets) {
    return orderIntents("next_meal");
  }

  if (summary.mealCount === 0) {
    return orderIntents("food_logging");
  }

  if (targets.protein - summary.totalProtein > 30) {
    return orderIntents("protein");
  }

  if (targets.calories - summary.totalCalories <= 200) {
    return orderIntents("calorie_control");
  }

  return orderIntents("next_meal");
}
