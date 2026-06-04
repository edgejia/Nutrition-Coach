export type PrimaryTab = "home" | "chat" | "history";
export type SecondaryScreen = "settings" | "dayDetail" | "mealEdit";
export type MealPeriod = "breakfast" | "lunch" | "dinner" | "late_night";
export type MealReceiptStatus = "active" | "deleted" | "stale_revision";
export interface DayDetailPayload {
  dateKey: string;
  targetMealId?: string;
  label?: "today-live" | "history-snapshot";
}
export interface MealEditPayload {
  mealId: string;
  mealRevisionId: string;
  dateKey: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  itemCount: number;
  items?: MealItemDetail[];
  imageAssetId?: string | null;
  imageUrl?: string | null;
  loggedAt?: string;
  mealPeriod?: MealPeriod;
}
export type SecondaryScreenState =
  | { screen: "dayDetail"; origin: PrimaryTab; payload?: DayDetailPayload }
  | { screen: "settings"; origin: PrimaryTab }
  | { screen: "mealEdit"; origin: PrimaryTab; payload: MealEditPayload }
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

export type DailySummarySSESource = "initial" | "meal_mutation";

export interface DailySummarySSEPayload {
  summary: DailySummary;
  affectedDate: string;
  source: DailySummarySSESource;
}

export type SummaryOutcome =
  | { status: "fresh"; dailySummary: DailySummary }
  | { status: "recovered"; dailySummary: DailySummary; reason: "recompute_failed" }
  | { status: "unavailable"; reason: "recompute_failed" };

// Phase 76 keeps item rows media-free: whole-meal photos remain meal-level
// evidence per D-01/D-03 until a future item-media contract exists.
export interface MealItemDetail {
  name: string;
  position: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface LoggedMealReceipt {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  itemCount: number;
  items?: MealItemDetail[];
  receiptMealId?: string;
  mealId?: string;
  mealRevisionId?: string;
  dateKey?: string;
  receiptStatus?: MealReceiptStatus;
  loggedAt?: string;
  imageAssetId?: string | null;
  imageUrl?: string | null;
  mealPeriod?: MealPeriod;
}

export interface MealEntry {
  id: string;
  mealRevisionId?: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  itemCount: number;
  items?: MealItemDetail[];
  imageAssetId?: string | null;
  imageUrl?: string | null;
  loggedAt: string;
  mealPeriod?: MealPeriod;
}

export interface ScalarUpdateMealInput {
  expectedMealRevisionId: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imageAssetId?: string | null;
}

export interface GroupedUpdateMealInput {
  expectedMealRevisionId: string;
  items: MealItemDetail[];
}

export type UpdateMealInput = ScalarUpdateMealInput | GroupedUpdateMealInput;

export interface DeleteMealOptions {
  expectedMealRevisionId: string;
}

export interface UpdateMealResponse {
  affectedDate: string;
  dailySummary?: DailySummary;
  summaryOutcome?: SummaryOutcome;
  meal: MealEntry;
}

export interface DeleteMealResponse {
  affectedDate: string;
  dailySummary?: DailySummary;
  summaryOutcome?: SummaryOutcome;
  deletedMealId?: string;
}

export interface MealMutationNotice {
  affectedDate: string;
  nonce: number;
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
  turnId?: string;
  imagePath?: string | null;
  imageAssetId?: string | null;
  imageUrl?: string | null;
  imagePreviewUrl?: string;
  createdAt: string;
  status?: "complete" | "stopped" | "error";
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
  turnId: string;
  reply: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: LoggedMealReceipt;
  dailySummary?: DailySummary;
  summaryOutcome?: SummaryOutcome;
  dailyTargets?: DailyTargets;
  affectedDate?: string;
  deletedMealId?: string;
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
  goal: "fat_loss" | "muscle_gain" | "maintain";
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
  usedFallback: boolean;
}

export interface ProvisionalBubble {
  id: string;
  statusLabel: string;
  content: string;
  isStreaming: boolean;
  status?: "complete" | "stopped" | "error";
}
