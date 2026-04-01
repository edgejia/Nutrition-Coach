import type { DailyTargets, DailySummary } from "./types.js";

export function getCoachAdvice(summary: DailySummary | null, targets: DailyTargets | null): string | null {
  if (!summary || !targets) {
    return null;
  }

  if (summary.mealCount === 0) {
    return "還沒記錄任何餐點，開始記錄你的第一餐吧";
  }

  const proteinRemaining = targets.protein - summary.totalProtein;
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
