export type PrimaryTab = "home" | "chat" | "history";
export type SecondaryScreen = "settings" | "dayDetail" | "mealEdit";
export interface DayDetailPayload {
  dateKey: string;
  targetMealId?: string;
  label?: "today-live" | "history-snapshot";
}
export type SecondaryScreenState =
  | { screen: "dayDetail"; origin: PrimaryTab; payload?: DayDetailPayload }
  | { screen: "settings" | "mealEdit"; origin: PrimaryTab }
  | null;
export type ActiveScreen = PrimaryTab | "onboarding";

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

export interface LoggedMealReceipt {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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

export interface HistoryTrendBucket {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
}

export interface HistoryTrendResponse {
  from: string;
  to: string;
  completeness: "empty" | "sparse" | "complete";
  daily: HistoryTrendBucket[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    mealCount: number;
  };
  averages: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    mealsPerDay: number;
  };
}

export interface HistoryDaySnapshot {
  date: string;
  summary: DailySummary;
  meals: MealEntry[];
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
  loggedMeal?: LoggedMealReceipt;
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
  loggedMeal?: LoggedMealReceipt;
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

export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

export type OnboardingField =
  | "goal"
  | "goalClarification"
  | "sex"
  | "age"
  | "heightCm"
  | "weightKg"
  | "activityLevel"
  | "trainingFrequency"
  | "allergies"
  | "bodyFatPercent"
  | "tdee"
  | "advancedNotes";

export interface IntakeValidationIssue {
  field: OnboardingField;
  code: string;
  step: OnboardingStep;
  message: string;
}

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
