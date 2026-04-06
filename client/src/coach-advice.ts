import type { DailyTargets, DailySummary, CoachCTA } from "./types.js";

export function getCoachAdvice(summary: DailySummary | null, targets: DailyTargets | null): string | null {
  if (!summary || !targets) {
    return null;
  }

  if (summary.mealCount === 0) {
    return "還沒記錄任何餐點，開始記錄你的第一餐吧";
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

function getMealPeriod(hour: number): string {
  if (hour < 11) return "早餐";
  if (hour < 15) return "午餐";
  if (hour < 21) return "晚餐";
  return "宵夜";
}

export function getCoachCTA(
  summary: DailySummary | null,
  targets: DailyTargets | null,
  hour: number = new Date().getHours(),
): CoachCTA {
  const secondary = "記錄飲食";

  if (!summary || !targets || summary.mealCount === 0) {
    return { primary: "開始記錄今天第一餐", secondary };
  }

  const proteinRemaining = targets.protein - summary.totalProtein;
  const calRemaining = targets.calories - summary.totalCalories;

  if (proteinRemaining > 30) {
    return { primary: "問我怎麼補蛋白質", secondary };
  }

  if (calRemaining <= 0) {
    return { primary: "問我現在還能不能吃", secondary };
  }

  if (calRemaining < 200) {
    return { primary: "問我怎麼收今天這餐", secondary };
  }

  const meal = getMealPeriod(hour);
  return { primary: `問我${meal}怎麼吃`, secondary };
}
