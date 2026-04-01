export type ActiveScreen = "home" | "summary" | "chat" | "onboarding" | "settings";

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
  mealCount: number;
}

export interface MealEntry {
  id: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imagePath?: string | null;
  imagePreviewUrl?: string;
  createdAt: string;
  didLogMeal?: boolean;
}

export interface PendingHomeChatDraft {
  id: string;
  text: string;
  image?: File;
  status: "staged" | "sending" | "failed";
}

export interface ChatReply {
  reply: string;
  didLogMeal?: boolean;
}
