export type ActiveScreen = "home" | "summary" | "chat" | "onboarding";

export interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

// SSE `goals_update` event payload. Server publishes only `{ targets }` so that
// the client re-renders every existing goal-driven surface (Dashboard,
// GoalSettings, HomeHeader) through the existing `setDailyTargets` store
// action — no goal-update-specific UI affordance is introduced (D-23..D-26).
export interface GoalsUpdatePayload {
  targets: DailyTargets;
}

export interface DailySummary {
  date: string;
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
  imageAssetId?: string | null;
  imageUrl?: string | null;
  loggedAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imagePath?: string | null;
  imageAssetId?: string | null;
  imageUrl?: string | null;
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
  didMutateMeal?: boolean;
  dailySummary?: DailySummary;
  dailyTargets?: DailyTargets;
  affectedDate?: string;
}

export type CoachCTAIntentId = "protein" | "next_meal" | "calorie_control" | "food_logging";

export type CoachCTAOptionId =
  | "protein-convenience-store"
  | "protein-dinner-budget"
  | "protein-gap-estimate"
  | "next-meal-calorie-budget"
  | "next-meal-eating-out"
  | "next-meal-low-oil-protein-dinner"
  | "calorie-remaining-estimate"
  | "calorie-low-calorie-finishers"
  | "calorie-dinner-adjustment"
  | "food-logging-guided"
  | "food-logging-estimate-meal"
  | "food-logging-today-review";

export interface CoachCTATaskOption {
  id: CoachCTAOptionId;
  label: string;
  prompt: string;
}

export interface CoachCTAIntent {
  id: CoachCTAIntentId;
  label: string;
  options: readonly CoachCTATaskOption[];
}

export type CoachCTA = readonly CoachCTAIntent[];

export interface IntakeData {
  goal: "fat_loss" | "muscle_gain";
  sex: "male" | "female";
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: "sedentary" | "light" | "moderate" | "active" | "very_active";
  trainingFrequency: "none" | "1_2" | "3_4" | "5_plus";
  allergies?: string;
  goalClarification?: string;
  bodyFatPercent?: number;
  tdee?: number;
  advancedNotes?: string;
}

export interface IntakeResult {
  deviceId: string;
  dailyTargets: DailyTargets;
  coachExplanation: string | null;
}

export interface ProvisionalBubble {
  id: string;
  statusLabel: string;
  content: string;
  isStreaming: boolean;
}
