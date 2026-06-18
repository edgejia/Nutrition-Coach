export const CHAT_MUTATION_OUTCOME_ACTIONS = [
  "log_food",
  "update_meal",
  "delete_meal",
  "update_goals",
] as const;

export type ChatMutationOutcomeAction = (typeof CHAT_MUTATION_OUTCOME_ACTIONS)[number];

type MealOutcomeAction = Extract<
  ChatMutationOutcomeAction,
  "log_food" | "update_meal" | "delete_meal"
>;

type GoalLabel = "卡路里" | "蛋白質" | "碳水" | "脂肪";
type GoalUnit = "kcal" | "g";

export interface ChatMealMutationOutcomeFact {
  action: MealOutcomeAction;
  affectedDate: string;
  foodName: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface ChatGoalMutationOutcomeFact {
  action: "update_goals";
  affectedDate: string;
  updatedGoals: Array<{
    label: GoalLabel;
    value: number;
    unit: GoalUnit;
  }>;
}

export type ChatMutationOutcomeFact =
  | ChatMealMutationOutcomeFact
  | ChatGoalMutationOutcomeFact;

const ACTIONS = new Set<string>(CHAT_MUTATION_OUTCOME_ACTIONS);
const MEAL_ACTIONS = new Set<string>(["log_food", "update_meal", "delete_meal"]);
const GOAL_LABELS = new Set<string>(["卡路里", "蛋白質", "碳水", "脂肪"]);
const GOAL_UNITS = new Set<string>(["kcal", "g"]);
const MEAL_KEYS = new Set([
  "action",
  "affectedDate",
  "foodName",
  "calories",
  "protein",
  "carbs",
  "fat",
]);
const GOAL_KEYS = new Set(["action", "affectedDate", "updatedGoals"]);
const UPDATED_GOAL_KEYS = new Set(["label", "value", "unit"]);
const FORBIDDEN_KEY_PARTS = [
  "id",
  "revision",
  "device",
  "payload",
  "args",
  "result",
  "provider",
  "debug",
  "protocol",
  "request",
  "response",
  "route",
  "endpoint",
  "summaryoutcome",
  "assistantfinaltext",
  "finalreply",
  "tool",
];
const FORBIDDEN_TEXT_PATTERNS = [
  /log_food|update_meal|delete_meal|update_goals|get_daily_summary|find_meals/i,
  /summaryOutcome|dailySummary|provider|debug|protocol|payload/i,
  /rawTool|toolArgs|toolResult|request|response|endpoint|\/api/i,
  /mealId|mealRevisionId|deviceId|currentRevisionId|revision/i,
  /JSON|PATCH|POST|DELETE/i,
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasForbiddenKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part));
}

function hasForbiddenText(value: string) {
  return FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function isRealDateKey(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validateKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key) && !hasForbiddenKey(key));
}

function validateSharedFields(value: Record<string, unknown>) {
  const action = value.action;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return undefined;
  }
  if (!isRealDateKey(value.affectedDate) || hasForbiddenText(value.affectedDate)) {
    return undefined;
  }
  return action as ChatMutationOutcomeAction;
}

function validateMealFact(
  value: Record<string, unknown>,
  action: MealOutcomeAction,
): ChatMealMutationOutcomeFact | undefined {
  if (!validateKeys(value, MEAL_KEYS)) {
    return undefined;
  }
  if (typeof value.foodName !== "string" || value.foodName.trim().length === 0) {
    return undefined;
  }

  const foodName = value.foodName.trim();
  if (hasForbiddenText(foodName)) {
    return undefined;
  }

  const fact: ChatMealMutationOutcomeFact = {
    action,
    affectedDate: value.affectedDate as string,
    foodName,
  };

  for (const key of ["calories", "protein", "carbs", "fat"] as const) {
    if (value[key] === undefined) {
      continue;
    }
    const numericValue = readFiniteNumber(value[key]);
    if (numericValue === undefined) {
      return undefined;
    }
    fact[key] = numericValue;
  }

  return fact;
}

function validateUpdatedGoal(value: unknown) {
  if (!isPlainRecord(value) || !validateKeys(value, UPDATED_GOAL_KEYS)) {
    return undefined;
  }
  if (typeof value.label !== "string" || !GOAL_LABELS.has(value.label)) {
    return undefined;
  }
  if (typeof value.unit !== "string" || !GOAL_UNITS.has(value.unit)) {
    return undefined;
  }

  const numericValue = readFiniteNumber(value.value);
  if (numericValue === undefined) {
    return undefined;
  }

  return {
    label: value.label as GoalLabel,
    value: numericValue,
    unit: value.unit as GoalUnit,
  };
}

function validateGoalFact(
  value: Record<string, unknown>,
): ChatGoalMutationOutcomeFact | undefined {
  if (!validateKeys(value, GOAL_KEYS) || !Array.isArray(value.updatedGoals)) {
    return undefined;
  }

  const updatedGoals = value.updatedGoals.map(validateUpdatedGoal);
  if (updatedGoals.length === 0 || updatedGoals.some((goal) => goal === undefined)) {
    return undefined;
  }

  return {
    action: "update_goals",
    affectedDate: value.affectedDate as string,
    updatedGoals: updatedGoals as ChatGoalMutationOutcomeFact["updatedGoals"],
  };
}

export function validateChatMutationOutcomeFact(
  value: unknown,
): ChatMutationOutcomeFact | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const action = validateSharedFields(value);
  if (!action) {
    return undefined;
  }

  if (MEAL_ACTIONS.has(action)) {
    return validateMealFact(value, action as MealOutcomeAction);
  }

  return validateGoalFact(value);
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatMealNutrition(fact: ChatMealMutationOutcomeFact) {
  const parts = [
    fact.calories === undefined ? undefined : `${formatNumber(fact.calories)} kcal`,
    fact.protein === undefined ? undefined : `蛋白質 ${formatNumber(fact.protein)} g`,
    fact.carbs === undefined ? undefined : `碳水 ${formatNumber(fact.carbs)} g`,
    fact.fat === undefined ? undefined : `脂肪 ${formatNumber(fact.fat)} g`,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? `，${parts.join("、")}` : "";
}

export function formatChatMutationOutcomeForCompressedHistory(
  value: unknown,
): string | undefined {
  const fact = validateChatMutationOutcomeFact(value);
  if (!fact) {
    return undefined;
  }

  if (fact.action === "update_goals") {
    const goals = fact.updatedGoals
      .map((goal) => `${goal.label} ${formatNumber(goal.value)} ${goal.unit}`)
      .join("、");
    return `[系統已更新目標：${fact.affectedDate} ${goals}]`;
  }

  const actionCopy: Record<MealOutcomeAction, string> = {
    log_food: "記錄",
    update_meal: "更新",
    delete_meal: "刪除",
  };

  return `[系統已${actionCopy[fact.action]}餐點：${fact.affectedDate} ${fact.foodName}${formatMealNutrition(fact)}]`;
}
