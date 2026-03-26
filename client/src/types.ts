export interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DailySummary {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imagePath?: string | null;
  createdAt: string;
}
