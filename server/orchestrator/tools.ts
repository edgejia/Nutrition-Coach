import { z } from "zod";
import type { ToolDefinition, ToolCall } from "../llm/types.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createDeviceService, DailyTargets } from "../services/device.js";
import type { createMealCorrectionService, FindMealsResult } from "../services/meal-correction.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import {
  buildHistoricalLoggedAt,
  resolveHistoricalDateIntent,
  type HistoricalMealPeriod,
} from "../lib/historical-date.js";
import {
  runContract,
  summarizeContractArgsForLog,
  type ToolContract,
  type RunContractContext,
} from "./tool-contract.js";
import {
  classifyProteinSource,
  normalizeTrustedProteinEstimate,
  type ExcludedProteinSource,
  type ProteinSourceCertainty,
  type ProteinSourceInput,
  type TrustedProteinSource,
} from "./protein-trust.js";
import type { DeletedMealSnapshot } from "./mutation-effects.js";

// ---------------------------------------------------------------------------
// Public types preserved for the orchestrator (Phase 8/9 callers).
// ---------------------------------------------------------------------------

export interface ToolDeps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  deviceService?: ReturnType<typeof createDeviceService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
  imagePath?: string;
  toolSessionState?: {
    resolvedMealIds: string[];
  };
}

export interface ToolExecutionResult {
  result: string;
  summary: string;
  success?: boolean;
  executed?: boolean;
  failureReason?: "validation" | "guard" | "execute";
  updatedFields?: string[];
  publishedEvents?: string[];
  dailyTargets?: DailyTargets;
  dailySummary?: DailySummary;
  affectedDate?: string;
  mealMutationKind?: "log" | "update" | "delete";
  deletedMeal?: DeletedMealSnapshot;
  loggedMeal?: {
    mealId: string;
    mealRevisionId: string;
    dateKey: string;
    loggedAt: string;
    imageAssetId: string | null;
    imageUrl: string | null;
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    itemCount: number;
    items?: Array<{
      name: string;
      position: number;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }>;
    quantityUncertaintyReason?: "missing_quantity";
    countedSources: TrustedProteinSource[];
    excludedSources: ExcludedProteinSource[];
    usedConservativeAssumption: boolean;
  };
}

export interface FatalToolDiagnostic {
  failureReason?: "validation" | "guard" | "execute";
  reason?: string;
  fields?: string[];
}

export class FatalToolError extends Error {
  readonly diagnostic?: FatalToolDiagnostic;

  constructor(message: string, options?: { cause?: unknown; diagnostic?: FatalToolDiagnostic }) {
    super(message);
    this.name = "FatalToolError";
    this.cause = options?.cause;
    this.diagnostic = options?.diagnostic;
  }
}

export function isFatalToolError(error: unknown): error is FatalToolError {
  return error instanceof FatalToolError;
}

// ---------------------------------------------------------------------------
// Contract-level types.
// ---------------------------------------------------------------------------

interface LogFoodItemArgs {
  food_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  quantity?: number;
  quantity_g?: number;
  quantity_ml?: number;
  amount?: string;
  unit?: string;
  serving_size?: string;
}

interface ProteinSourceArgs {
  name: string;
  protein: number;
  is_primary: boolean;
  certainty: ProteinSourceCertainty;
}

interface HistoricalDateToolArgs {
  date_text?: string;
  meal_period?: HistoricalMealPeriod;
}

interface LogFoodLegacyArgs extends LogFoodItemArgs, HistoricalDateToolArgs {
  protein_sources?: ProteinSourceArgs[];
}

interface LogFoodGroupedArgs extends HistoricalDateToolArgs {
  items: LogFoodItemArgs[];
  protein_sources?: ProteinSourceArgs[];
  food_name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  quantity?: number;
  quantity_g?: number;
  quantity_ml?: number;
  amount?: string;
  unit?: string;
  serving_size?: string;
}

export type LogFoodArgs = LogFoodLegacyArgs | LogFoodGroupedArgs;
type QuantityUncertaintyReason = "missing_quantity";

interface NormalizedLogFoodArgs extends HistoricalDateToolArgs {
  items: LogFoodItemArgs[];
  protein_sources?: ProteinSourceArgs[];
  quantityUncertaintyReason?: QuantityUncertaintyReason;
}

interface FindMealsArgs {
  action: "update" | "delete";
  query: string;
}

interface UpdateMealPatchArgs {
  meal_id: string;
  food_name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

type UpdateMealArgs = UpdateMealPatchArgs | { meal_id: string; items: LogFoodItemArgs[] };

interface DeleteMealArgs {
  meal_id: string;
}

type HistoricalToolClarification = {
  status: "needs_clarification";
  prompt: string;
  reason: "multiple_dates" | "unsupported" | "unparseable";
};

interface LogFoodSuccessResult {
  status: "logged";
  dailySummary: DailySummary;
  affectedDate?: string;
  loggedMeal: {
    mealId: string;
    mealRevisionId: string;
    dateKey: string;
    loggedAt: string;
    imageAssetId: string | null;
    imageUrl: string | null;
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    itemCount: number;
    items: Array<{
      name: string;
      position: number;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }>;
    quantityUncertaintyReason?: QuantityUncertaintyReason;
    countedSources: TrustedProteinSource[];
    excludedSources: ExcludedProteinSource[];
    usedConservativeAssumption: boolean;
  };
}

type LogFoodResult = LogFoodSuccessResult | HistoricalToolClarification;

interface UpdateMealResult {
  dailySummary: DailySummary;
  affectedDate: string;
  updatedMeal: {
    id: string;
    mealRevisionId: string;
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    itemCount: number;
    items: Array<{
      name: string;
      position: number;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }>;
    imagePath: string | null;
    loggedAt: string;
  };
}

interface DeleteMealResult {
  dailySummary: DailySummary;
  affectedDate: string;
  deletedMealId: string;
  deletedMeal: DeletedMealSnapshot;
}

interface GetDailySummaryArgs {
  date_text?: string;
}

type GetDailySummaryResult =
  | {
      status: "summary";
      dailySummary: DailySummary;
      affectedDate?: string;
    }
  | HistoricalToolClarification
  | {
      status: "multiple_targets";
      dateKeys: string[];
    };
type UpdateGoalField = keyof DailyTargets;

interface UpdateGoalsResult {
  targets: DailyTargets;
  updatedFields: UpdateGoalField[];
  publishedEvents: ["goals_update"];
}

const finiteNumber = z.number().refine(Number.isFinite, "must be finite");
const quantityToolProperties = {
  quantity: { type: "number" },
  quantity_g: { type: "number" },
  quantity_ml: { type: "number" },
  amount: { type: "string" },
  unit: { type: "string" },
  serving_size: { type: "string" },
} as const;
const historicalDateTextSchema = z.string().min(1, "date_text must be non-empty").optional();
const historicalMealPeriodSchema = z.enum(["breakfast", "lunch", "dinner", "late_night"]).optional();
const proteinSourceSchema = z
  .object({
    name: z.string().min(1, "protein_sources[].name must be non-empty"),
    protein: finiteNumber,
    is_primary: z.boolean(),
    certainty: z.enum(["clear", "uncertain"]),
  })
  .strict();

const logFoodItemSchema = z
  .object({
    food_name: z.string().min(1, "food_name must be non-empty"),
    calories: finiteNumber,
    protein: finiteNumber,
    carbs: finiteNumber,
    fat: finiteNumber,
    quantity: finiteNumber.optional(),
    quantity_g: finiteNumber.optional(),
    quantity_ml: finiteNumber.optional(),
    amount: z.string().optional(),
    unit: z.string().optional(),
    serving_size: z.string().optional(),
  })
  .strict();

const logFoodSchema = z.union([
  logFoodItemSchema
    .extend({
      date_text: historicalDateTextSchema,
      meal_period: historicalMealPeriodSchema,
      protein_sources: z.array(proteinSourceSchema).min(1).optional(),
    })
    .strict(),
  z
    .object({
      items: z.array(logFoodItemSchema).min(1, "items must contain at least one entry"),
      date_text: historicalDateTextSchema,
      meal_period: historicalMealPeriodSchema,
      protein_sources: z.array(proteinSourceSchema).min(1).optional(),
      food_name: z.string().min(1).optional(),
      calories: finiteNumber.optional(),
      protein: finiteNumber.optional(),
      carbs: finiteNumber.optional(),
      fat: finiteNumber.optional(),
      quantity: finiteNumber.optional(),
      quantity_g: finiteNumber.optional(),
      quantity_ml: finiteNumber.optional(),
      amount: z.string().optional(),
      unit: z.string().optional(),
      serving_size: z.string().optional(),
    })
    .strict(),
]);

const findMealsSchema = z
  .object({
    action: z.enum(["update", "delete"]),
    query: z.string().min(1, "query must be non-empty"),
  })
  .strict();

const getDailySummarySchema = z
  .object({
    date_text: historicalDateTextSchema,
  })
  .strict();

const updateGoalsSchema = z
  .object({
    calories: z.number().min(500).max(8000).optional(),
    protein: z.number().min(0).max(400).optional(),
    carbs: z.number().min(0).max(1000).optional(),
    fat: z.number().min(0).max(300).optional(),
  })
  .strict()
  .refine((args) => Object.keys(args).length > 0, {
    message: "at least one goal field is required",
  });

const updateMealSchema = z.union([
  z
    .object({
      meal_id: z.string().uuid("meal_id must be a uuid"),
      food_name: z.string().min(1, "food_name must be non-empty").optional(),
      calories: finiteNumber.optional(),
      protein: finiteNumber.optional(),
      carbs: finiteNumber.optional(),
      fat: finiteNumber.optional(),
    })
    .strict()
    .refine(
      (args) => Object.keys(args).some((key) => key !== "meal_id"),
      { message: "at least one meal field is required" },
    ),
  z
    .object({
      meal_id: z.string().uuid("meal_id must be a uuid"),
      items: z.array(logFoodItemSchema).min(1, "items must contain at least one entry"),
    })
    .strict(),
]);

const deleteMealSchema = z
  .object({
    meal_id: z.string().uuid("meal_id must be a uuid"),
  })
  .strict();

function updatedGoalFields(args: Partial<DailyTargets>): UpdateGoalField[] {
  return (["calories", "protein", "carbs", "fat"] as const).filter(
    (field) => args[field] !== undefined,
  );
}

function formatGoalsReceipt(targets: DailyTargets): string {
  return `已更新每日目標：\n• 卡路里 ${targets.calories} kcal\n• 蛋白質 ${targets.protein} g\n• 碳水 ${targets.carbs} g\n• 脂肪 ${targets.fat} g`;
}

function buildHistoricalToolMessage(
  result: HistoricalToolClarification | { status: "multiple_targets"; dateKeys: string[] },
): string {
  return JSON.stringify(result);
}

function extractHistoricalMealPeriod(input: string): HistoricalMealPeriod | undefined {
  if (/(早餐|早上|早飯)/.test(input)) return "breakfast";
  if (/(午餐|中午)/.test(input)) return "lunch";
  if (/(晚餐|晚上)/.test(input)) return "dinner";
  if (/(宵夜|點心|下午茶)/.test(input)) return "late_night";
  return undefined;
}

function extractPreviousHistoricalDateKey(
  previousAssistantMessage: string | undefined,
  currentDate: Date,
): string | undefined {
  if (!previousAssistantMessage) {
    return undefined;
  }

  const resolved = resolveHistoricalDateIntent({
    input: previousAssistantMessage,
    currentDate,
    mode: "mutation",
  });
  if (resolved.status !== "resolved" || !resolved.isHistorical || resolved.source !== "explicit") {
    return undefined;
  }

  return resolved.dateKey;
}

function buildLocalMidpointDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

async function recoverDailySummaryFromPersistedMeals(
  deps: ToolDeps,
  deviceId: string,
  dateKey: string,
): Promise<DailySummary> {
  const meals = await deps.foodLoggingService.getMealsByDate(
    deviceId,
    buildLocalMidpointDate(dateKey),
  );

  return {
    totalCalories: meals.reduce((sum, meal) => sum + meal.calories, 0),
    totalProtein: meals.reduce((sum, meal) => sum + meal.protein, 0),
    totalCarbs: meals.reduce((sum, meal) => sum + meal.carbs, 0),
    totalFat: meals.reduce((sum, meal) => sum + meal.fat, 0),
    mealCount: meals.length,
    date: dateKey,
  };
}

function roundProtein(value: number): number {
  return Math.round(Math.max(value, 0) * 10) / 10;
}

function normalizeComparableName(name: string): string {
  return name.trim().toLowerCase();
}

function namesLikelyMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeComparableName(left);
  const normalizedRight = normalizeComparableName(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function inferProteinSourcesFromItem(item: LogFoodItemArgs): ProteinSourceInput[] {
  const category = classifyProteinSource(item.food_name);
  if (category === "unknown" && item.protein <= 0) {
    return [];
  }

  return [{
    name: item.food_name.trim(),
    protein: roundProtein(item.protein),
    isPrimary: category !== "trace",
    certainty: "clear",
  }];
}

function hasQuantityBearingField(item: LogFoodItemArgs): boolean {
  return item.quantity !== undefined
    || item.quantity_g !== undefined
    || item.quantity_ml !== undefined
    || hasQuantityLikeNumberInText(item.amount ?? "")
    || hasQuantityLikeNumberInText(item.serving_size ?? "");
}

function hasQuantityLikeNumberInText(text: string): boolean {
  return /(?:\d|[０-９]|[一二三四五六七八九十兩半])\s*(?:g|克|公斤|kg|ml|毫升|杯|碗|份|顆|片|根|條|個|包|盒|匙|湯匙|茶匙|碗|盤|瓶|罐|塊|枚|串|球|卷|張|把)?/i.test(text);
}

function hasGroupedQuantityEvidence(args: LogFoodArgs): boolean {
  return "items" in args && (
    args.quantity !== undefined
    || args.quantity_g !== undefined
    || args.quantity_ml !== undefined
    || hasQuantityLikeNumberInText(args.amount ?? "")
    || hasQuantityLikeNumberInText(args.unit ?? "")
    || hasQuantityLikeNumberInText(args.serving_size ?? "")
  );
}

function shouldMarkMissingQuantity(
  items: LogFoodItemArgs[],
  sourceText?: string,
  hasTopLevelQuantityEvidence = false,
): boolean {
  if (hasTopLevelQuantityEvidence) {
    return false;
  }
  if (sourceText && hasQuantityLikeNumberInText(sourceText)) {
    return false;
  }
  return items.every(
    (item) => !hasQuantityBearingField(item) && !hasQuantityLikeNumberInText(item.food_name),
  );
}

function sourceTextSoyMilkAnchor(sourceText?: string): string | undefined {
  if (!sourceText) {
    return undefined;
  }
  if (/豆漿|soy milk/i.test(sourceText)) {
    return "豆漿";
  }
  return undefined;
}

function isGenericDrinkLabel(label: string): boolean {
  return /^(?:飲品|飲料|植物性飲料|無糖飲料)$/i.test(label.trim());
}

function repairGenericDrinkItemsFromSourceText(
  items: LogFoodItemArgs[],
  sourceText?: string,
): LogFoodItemArgs[] {
  const anchor = sourceTextSoyMilkAnchor(sourceText);
  if (!anchor || items.length !== 1) {
    return items;
  }
  const [item] = items;
  if (!item || !isGenericDrinkLabel(item.food_name) || item.protein <= 0) {
    return items;
  }
  return [{ ...item, food_name: anchor }];
}

export function normalizeLogFoodArgs(args: LogFoodArgs, sourceText?: string): NormalizedLogFoodArgs {
  // When items[] is present it is authoritative; top-level aggregate fields are compatibility noise.
  const rawItems = "items" in args
    ? args.items
    : [
        {
          food_name: args.food_name,
          calories: args.calories,
          protein: args.protein,
          carbs: args.carbs,
          fat: args.fat,
          ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
          ...(args.quantity_g !== undefined ? { quantity_g: args.quantity_g } : {}),
          ...(args.quantity_ml !== undefined ? { quantity_ml: args.quantity_ml } : {}),
          ...(args.amount !== undefined ? { amount: args.amount } : {}),
          ...(args.unit !== undefined ? { unit: args.unit } : {}),
          ...(args.serving_size !== undefined ? { serving_size: args.serving_size } : {}),
        },
      ];
  const items = repairGenericDrinkItemsFromSourceText(rawItems, sourceText);

  return {
    items,
    ...(args.date_text !== undefined ? { date_text: args.date_text } : {}),
    ...(args.meal_period !== undefined ? { meal_period: args.meal_period } : {}),
    ...(args.protein_sources !== undefined ? { protein_sources: args.protein_sources } : {}),
    ...(shouldMarkMissingQuantity(items, sourceText, hasGroupedQuantityEvidence(args))
      ? { quantityUncertaintyReason: "missing_quantity" as const }
      : {}),
  };
}

function resolveProteinSourceInputs(
  args: LogFoodArgs,
  sourceText?: string,
): { proteinSources: ProteinSourceInput[]; usedExplicitProteinSources: boolean } {
  const inferredSources = "items" in args
    ? args.items.flatMap((item) => inferProteinSourcesFromItem(item))
    : inferProteinSourcesFromItem(args);

  if (args.protein_sources && args.protein_sources.length > 0) {
    const explicitSources = args.protein_sources.map((source) => ({
      name: source.name.trim(),
      protein: roundProtein(source.protein),
      isPrimary: source.is_primary,
      certainty: source.certainty,
    }));
    const inferredSupplements = inferredSources.filter((inferred) =>
      !explicitSources.some((explicit) => namesLikelyMatch(explicit.name, inferred.name)),
    );

    return {
      usedExplicitProteinSources: true,
      proteinSources: [...explicitSources, ...inferredSupplements],
    };
  }

  return {
    usedExplicitProteinSources: false,
    proteinSources: inferredSources,
  };
}

function totalProposedProtein(args: LogFoodArgs): number {
  return "items" in args
    ? roundProtein(args.items.reduce((sum, item) => sum + item.protein, 0))
    : roundProtein(args.protein);
}

function shouldRejectTrustedProteinPersistence(
  args: LogFoodArgs,
  countedSourceCount: number,
): boolean {
  if (countedSourceCount > 0) {
    return false;
  }

  const proposedProtein = totalProposedProtein(args);
  if (proposedProtein <= 0) {
    return false;
  }

  const labels = "items" in args ? args.items.map((item) => item.food_name) : [args.food_name];
  const categories = labels.map((label) => classifyProteinSource(label));
  return !categories.every((category) => category === "trace");
}

function isMissingTrustedProteinBasisFailure(outcome: { failureReason?: string; result: string }) {
  if (outcome.failureReason !== "execute") {
    return false;
  }
  try {
    const parsed = JSON.parse(outcome.result) as Record<string, unknown>;
    return parsed.message === "trusted protein basis required for this meal";
  } catch {
    return false;
  }
}

function scaleGroupedProteinValues(
  items: Array<{ index: number; protein: number }>,
  targetProtein: number,
): Map<number, number> {
  const scaled = new Map<number, number>();
  const roundedTarget = roundProtein(targetProtein);

  if (items.length === 0 || roundedTarget <= 0) {
    return scaled;
  }

  const currentTotal = items.reduce((sum, item) => sum + item.protein, 0);
  if (currentTotal <= 0) {
    return scaled;
  }

  let remainingProtein = roundedTarget;
  let remainingCurrent = currentTotal;

  items.forEach((item, index) => {
    const isLast = index === items.length - 1;
    const nextProtein = isLast
      ? remainingProtein
      : roundProtein((item.protein / remainingCurrent) * remainingProtein);
    scaled.set(item.index, nextProtein);
    remainingProtein = roundProtein(remainingProtein - nextProtein);
    remainingCurrent -= item.protein;
  });

  return scaled;
}

function buildNormalizedGroupedItems(
  args: LogFoodGroupedArgs,
  countedSources: TrustedProteinSource[],
  trustedProtein: number,
  usedExplicitProteinSources: boolean,
): Array<{
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}> {
  const countedSourceNames = countedSources.map((source) => source.name);
  const countedItems = args.items
    .map((item, index) => {
      const category = classifyProteinSource(item.food_name);
      const matchesCountedSource = countedSourceNames.some((sourceName) =>
        namesLikelyMatch(item.food_name, sourceName),
      );
      const shouldCount = category !== "trace"
        && (usedExplicitProteinSources ? matchesCountedSource : category !== "unknown");

      return {
        index,
        foodName: item.food_name.trim(),
        calories: item.calories,
        protein: roundProtein(item.protein),
        carbs: item.carbs,
        fat: item.fat,
        shouldCount,
      };
    });

  const countedItemInputs = countedItems
    .filter((item) => item.shouldCount)
    .map((item) => ({ index: item.index, protein: item.protein }));
  const scaledProteins = scaleGroupedProteinValues(countedItemInputs, trustedProtein);

  return countedItems.map((item) => ({
    foodName: item.foodName,
    calories: item.calories,
    protein: scaledProteins.get(item.index) ?? 0,
    carbs: item.carbs,
    fat: item.fat,
  }));
}

function projectLoggedMealItems(
  items: Array<{
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>,
) {
  return items.map((item, index) => ({
    name: item.foodName,
    position: index + 1,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  }));
}

function projectMealIdentityFields(meal: {
  id: string;
  mealRevisionId: string;
  loggedAt: string;
  imagePath: string | null;
}) {
  const imageAssetId = parseAssetRef(meal.imagePath);
  return {
    mealId: meal.id,
    mealRevisionId: meal.mealRevisionId,
    dateKey: formatLocalDate(new Date(meal.loggedAt)),
    loggedAt: meal.loggedAt,
    imageAssetId,
    imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
  };
}

// ---------------------------------------------------------------------------
// Contracts. logSummary returns redacted shape (D-30); macros are part of
// existing Phase 8 behavior for log_food (intentional, see plan).
// ---------------------------------------------------------------------------

const logFoodContract: ToolContract<LogFoodArgs, LogFoodResult> = {
  name: "log_food",
  description: "將已分析的一項或多項食物記錄到今日，或記錄到明確指定的一個過去日期。歷史記錄只能對單一日期執行。",
  parameters: {
    type: "object",
    properties: {
      food_name: { type: "string" },
      calories: { type: "number" },
      protein: { type: "number" },
      carbs: { type: "number" },
      fat: { type: "number" },
      ...quantityToolProperties,
      protein_sources: {
        type: "array",
        description: "Required. List visually identifiable protein-bearing ingredients; mark uncertain when estimated from an image.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            protein: { type: "number" },
            is_primary: { type: "boolean" },
            certainty: {
              type: "string",
              enum: ["clear", "uncertain"],
            },
          },
          required: ["name", "protein", "is_primary", "certainty"],
        },
      },
      date_text: { type: "string" },
      meal_period: {
        type: "string",
        enum: ["breakfast", "lunch", "dinner", "late_night"],
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            food_name: { type: "string" },
            calories: { type: "number" },
            protein: { type: "number" },
            carbs: { type: "number" },
            fat: { type: "number" },
            ...quantityToolProperties,
          },
          required: ["food_name", "calories", "protein", "carbs", "fat"],
        },
      },
    },
    additionalProperties: false,
    required: ["protein_sources"],
  },
  zodSchema: logFoodSchema,
  // No sourceFields per D-11: log_food calorie estimates need not appear in
  // user text; the assistant computes them.
  logSummary: (args) => ({
    tool: "log_food",
    calories: "items" in args ? args.items.reduce((sum, item) => sum + item.calories, 0) : args.calories,
    protein: "items" in args ? args.items.reduce((sum, item) => sum + item.protein, 0) : args.protein,
    carbs: "items" in args ? args.items.reduce((sum, item) => sum + item.carbs, 0) : args.carbs,
    fat: "items" in args ? args.items.reduce((sum, item) => sum + item.fat, 0) : args.fat,
    proteinSourceCount: args.protein_sources?.length ?? 0,
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps || !deviceId) {
      throw new Error("log_food contract missing toolDeps/deviceId in context");
    }
    const currentDate = currentAppDate();
    const dateIntent = resolveHistoricalDateIntent({
      input: args.date_text?.trim() || context.currentUserMessage,
      currentDate,
      mode: "mutation",
      previousDateKey: extractPreviousHistoricalDateKey(
        context.previousAssistantMessage,
        currentDate,
      ),
    });
    if (dateIntent.status === "needs_clarification") {
      const clarification: HistoricalToolClarification = {
        status: "needs_clarification",
        prompt: dateIntent.prompt,
        reason: dateIntent.reason,
      };
      return {
        ok: true,
        result: clarification,
        toolMessage: buildHistoricalToolMessage(clarification),
      };
    }
    if (dateIntent.status !== "resolved") {
      const clarification: HistoricalToolClarification = {
        status: "needs_clarification",
        prompt: "我還不能確定你要記錄哪一天，請一次告訴我一個日期。",
        reason: "multiple_dates",
      };
      return {
        ok: true,
        result: clarification,
        toolMessage: buildHistoricalToolMessage(clarification),
      };
    }

    const loggedAt = dateIntent.isHistorical
      ? buildHistoricalLoggedAt({
          dateKey: dateIntent.dateKey,
          mealPeriod: args.meal_period ?? extractHistoricalMealPeriod(context.currentUserMessage),
        })
      : undefined;

    const normalized = normalizeLogFoodArgs(args, context.currentUserMessage);
    const { proteinSources, usedExplicitProteinSources } = resolveProteinSourceInputs(
      normalized,
      context.currentUserMessage,
    );
    const normalizedProtein = normalizeTrustedProteinEstimate({
      mealName: normalized.items.map((item) => item.food_name.trim()).join("、"),
      proposedProtein: totalProposedProtein(normalized),
      proteinSources,
    });

    if (shouldRejectTrustedProteinPersistence(normalized, normalizedProtein.countedSources.length)) {
      throw new FatalToolError("trusted protein basis required for this meal");
    }

    const normalizedItems = buildNormalizedGroupedItems(
      normalized,
      normalizedProtein.countedSources,
      normalizedProtein.trustedProtein,
      usedExplicitProteinSources,
    );
    const loggedMeal = await deps.foodLoggingService.logGroupedMeal(deviceId, {
        imagePath: deps.imagePath,
        loggedAt,
        items: normalizedItems,
      });

    // Phase 8/9 invariant: persist the meal BEFORE recomputing the daily
    // summary so partial-success fallback paths still see the row in the DB.
    let dailySummary: DailySummary;
    try {
      dailySummary = await deps.summaryService.getDailySummary(
        deviceId,
        buildLocalMidpointDate(dateIntent.dateKey),
      );
    } catch {
      dailySummary = await recoverDailySummaryFromPersistedMeals(
        deps,
        deviceId,
        dateIntent.dateKey,
      );
    }

    return {
      ok: true,
      result: {
        status: "logged",
        dailySummary,
        affectedDate: dateIntent.isHistorical ? dateIntent.dateKey : undefined,
        loggedMeal: {
          ...projectMealIdentityFields(loggedMeal),
          foodName: loggedMeal.foodName,
          calories: loggedMeal.calories,
          protein: loggedMeal.protein,
          carbs: loggedMeal.carbs,
          fat: loggedMeal.fat,
          itemCount: normalizedItems.length,
          items: projectLoggedMealItems(normalizedItems),
          ...(normalized.quantityUncertaintyReason
            ? { quantityUncertaintyReason: normalized.quantityUncertaintyReason }
            : {}),
          countedSources: normalizedProtein.countedSources,
          excludedSources: normalizedProtein.excludedSources,
          usedConservativeAssumption: normalizedProtein.usedConservativeAssumption,
        },
      },
      toolMessage: "食物已成功記錄",
    };
  },
};

const findMealsContract: ToolContract<FindMealsArgs, FindMealsResult> = {
  name: "find_meals",
  description: "解析要修改或刪除的歷史餐點目標，只能回傳資料庫候選或要求澄清。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["update", "delete"],
      },
      query: { type: "string" },
    },
    required: ["action", "query"],
  },
  zodSchema: findMealsSchema,
  logSummary: (args) => ({
    tool: "find_meals",
    action: args.action,
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.mealCorrectionService || !deviceId) {
      throw new Error("find_meals contract missing mealCorrectionService/deviceId in context");
    }

    const currentDate = currentAppDate();
    const result = await deps.mealCorrectionService.findMeals(
      deviceId,
      args.action,
      args.query.trim(),
      {
        currentDate,
        previousDateKey: extractPreviousHistoricalDateKey(
          context.previousAssistantMessage,
          currentDate,
        ),
      },
    );
    if (deps.toolSessionState) {
      deps.toolSessionState.resolvedMealIds =
        result.status === "resolved" ? [result.resolvedMealId] : [];
    }

    return {
      ok: true,
      result,
      toolMessage: JSON.stringify(result),
    };
  },
};

const getDailySummaryContract: ToolContract<
  GetDailySummaryArgs,
  GetDailySummaryResult
> = {
  name: "get_daily_summary",
  description: "查詢今日或明確指定單一日期的營養素總量。多日期問題請分別呼叫多次，每次只帶一個日期片語。",
  parameters: {
    type: "object",
    properties: {
      date_text: { type: "string" },
    },
    additionalProperties: false,
  },
  zodSchema: getDailySummarySchema,
  logSummary: () => ({ tool: "get_daily_summary" }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps || !deviceId) {
      throw new Error(
        "get_daily_summary contract missing toolDeps/deviceId in context",
      );
    }
    const currentDate = currentAppDate();
    const dateIntent = resolveHistoricalDateIntent({
      input: args.date_text?.trim() || context.currentUserMessage,
      currentDate,
      mode: "query",
      previousDateKey: extractPreviousHistoricalDateKey(
        context.previousAssistantMessage,
        currentDate,
      ),
    });
    if (dateIntent.status === "needs_clarification") {
      const clarification: HistoricalToolClarification = {
        status: "needs_clarification",
        prompt: dateIntent.prompt,
        reason: dateIntent.reason,
      };
      return {
        ok: true,
        result: clarification,
        toolMessage: buildHistoricalToolMessage(clarification),
      };
    }
    if (dateIntent.status === "resolved_many") {
      const multipleTargets = {
        status: "multiple_targets" as const,
        dateKeys: dateIntent.dateKeys,
      };
      return {
        ok: true,
        result: multipleTargets,
        toolMessage: buildHistoricalToolMessage(multipleTargets),
      };
    }
    const summary = await deps.summaryService.getDailySummary(
      deviceId,
      buildLocalMidpointDate(dateIntent.dateKey),
    );
    return {
      ok: true,
      result: {
        status: "summary",
        dailySummary: summary,
        affectedDate: dateIntent.isHistorical ? dateIntent.dateKey : undefined,
      },
      toolMessage: JSON.stringify(summary),
    };
  },
};

const updateMealContract: ToolContract<UpdateMealArgs, UpdateMealResult> = {
  name: "update_meal",
  description: "更新已解析出的歷史餐點內容。只有在本輪已先透過 find_meals 解析出唯一目標後才可呼叫。若只調整單一欄位，可只提供該欄位，其餘沿用原紀錄；對多項餐點，數字欄位會視為整餐總量 patch 並由系統按原比例分配到 items。items 只用於整筆多項餐點 replacement。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meal_id: { type: "string" },
      food_name: { type: "string" },
      calories: { type: "number" },
      protein: { type: "number" },
      carbs: { type: "number" },
      fat: { type: "number" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            food_name: { type: "string" },
            calories: { type: "number" },
            protein: { type: "number" },
            carbs: { type: "number" },
            fat: { type: "number" },
          },
          required: ["food_name", "calories", "protein", "carbs", "fat"],
        },
      },
    },
    required: ["meal_id"],
  },
  zodSchema: updateMealSchema,
  logSummary: (args) => ({
    tool: "update_meal",
    itemCount: "items" in args ? args.items.length : 1,
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.mealCorrectionService || !deviceId) {
      throw new Error("update_meal contract missing mealCorrectionService/deviceId in context");
    }

    const resolvedMealIds = deps.toolSessionState?.resolvedMealIds ?? [];
    if (!resolvedMealIds.includes(args.meal_id)) {
      throw new FatalToolError("meal target unresolved");
    }

    let updated: UpdateMealResult;
    try {
      updated = await deps.mealCorrectionService.updateMeal(
        deviceId,
        args.meal_id,
        "items" in args
          ? {
              items: args.items.map((item) => ({
                foodName: item.food_name.trim(),
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
              })),
            }
          : {
              patch: {
                ...(args.food_name !== undefined ? { foodName: args.food_name.trim() } : {}),
                ...(args.calories !== undefined ? { calories: args.calories } : {}),
                ...(args.protein !== undefined ? { protein: args.protein } : {}),
                ...(args.carbs !== undefined ? { carbs: args.carbs } : {}),
                ...(args.fat !== undefined ? { fat: args.fat } : {}),
              },
            },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "meal update failed";
      if (message === "MEAL_NAME_PATCH_REQUIRES_SINGLE_ITEM") {
        throw new FatalToolError("multi-item meal name changes require full items replacement");
      }
      throw error;
    }

    await deps.mealCorrectionService.clearPendingSelection(deviceId);
    if (deps.toolSessionState) {
      deps.toolSessionState.resolvedMealIds = [];
    }

    return {
      ok: true,
      result: updated,
      toolMessage: "已更新餐點",
    };
  },
};

const deleteMealContract: ToolContract<DeleteMealArgs, DeleteMealResult> = {
  name: "delete_meal",
  description: "刪除已解析出的歷史餐點。只有在本輪已先透過 find_meals 解析出唯一目標後才可呼叫。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meal_id: { type: "string" },
    },
    required: ["meal_id"],
  },
  zodSchema: deleteMealSchema,
  logSummary: () => ({
    tool: "delete_meal",
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.mealCorrectionService || !deviceId) {
      throw new Error("delete_meal contract missing mealCorrectionService/deviceId in context");
    }

    const resolvedMealIds = deps.toolSessionState?.resolvedMealIds ?? [];
    if (!resolvedMealIds.includes(args.meal_id)) {
      throw new FatalToolError("meal target unresolved");
    }

    const deleted = await deps.mealCorrectionService.deleteMeal(deviceId, args.meal_id);

    await deps.mealCorrectionService.clearPendingSelection(deviceId);
    if (deps.toolSessionState) {
      deps.toolSessionState.resolvedMealIds = [];
    }

    return {
      ok: true,
      result: deleted,
      toolMessage: "已刪除餐點",
    };
  },
};

const updateGoalsContract: ToolContract<Partial<DailyTargets>, UpdateGoalsResult> = {
  name: "update_goals",
  description:
    "更新使用者每日營養目標。只有當使用者在目前訊息提供 calories/protein/carbs/fat 的具體數字，或明確同意上一輪助理推薦的具體數字時才可呼叫；模糊意圖必須先推薦具體目標值並請使用者確認。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      calories: { type: "number", minimum: 500, maximum: 8000 },
      protein: { type: "number", minimum: 0, maximum: 400 },
      carbs: { type: "number", minimum: 0, maximum: 1000 },
      fat: { type: "number", minimum: 0, maximum: 300 },
    },
  },
  zodSchema: updateGoalsSchema,
  sourceFields: ["calories", "protein", "carbs", "fat"] as const,
  logSummary: (args) => ({
    tool: "update_goals",
    updatedFields: updatedGoalFields(args),
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.deviceService || !deps.publisher || !deviceId) {
      throw new Error("update_goals contract missing deviceService/publisher/deviceId in context");
    }

    const updatedFields = updatedGoalFields(args);
    const targets = await deps.deviceService.updateGoals(deviceId, args);
    deps.publisher.publishGoalsUpdate(deviceId, targets);

    return {
      ok: true,
      result: {
        targets,
        updatedFields,
        publishedEvents: ["goals_update"],
      },
      toolMessage: formatGoalsReceipt(targets),
    };
  },
};

// ---------------------------------------------------------------------------
// Registry (D-02). Single source of truth.
// ---------------------------------------------------------------------------

export const toolRegistry: Map<string, ToolContract<any, any>> = new Map([
  [logFoodContract.name, logFoodContract as ToolContract<any, any>],
  [findMealsContract.name, findMealsContract as ToolContract<any, any>],
  [updateMealContract.name, updateMealContract as ToolContract<any, any>],
  [deleteMealContract.name, deleteMealContract as ToolContract<any, any>],
  [getDailySummaryContract.name, getDailySummaryContract as ToolContract<any, any>],
  [updateGoalsContract.name, updateGoalsContract as ToolContract<any, any>],
]);

export function getToolDefinitions(): ToolDefinition[] {
  const defs: ToolDefinition[] = [];
  for (const contract of toolRegistry.values()) {
    defs.push({
      type: "function",
      function: {
        name: contract.name,
        description: contract.description,
        parameters: contract.parameters,
      },
    });
  }
  return defs;
}

// Compatibility export (Phase 10-02): server/orchestrator/index.ts still imports
// `toolDefinitions` until 10-03; computed once at module load from registry.
export const toolDefinitions: ToolDefinition[] = getToolDefinitions();

export function redactToolArgsForHook(toolName: string, rawArgs: string): string {
  const contract = toolRegistry.get(toolName);
  if (contract) {
    const summary = summarizeContractArgsForLog(contract, rawArgs);
    if (typeof summary === "string") {
      return summary;
    }
    if (toolName === "log_food") {
      const calories = summary.calories ?? "?";
      const protein = summary.protein ?? "?";
      const carbs = summary.carbs ?? "?";
      const fat = summary.fat ?? "?";
      return `熱量 ${calories}kcal, P${protein}g, C${carbs}g, F${fat}g`;
    }
    if (toolName === "get_daily_summary") {
      return "<get_daily_summary args>";
    }
    if (toolName === "find_meals") {
      return `action: ${summary.action ?? "unknown"}`;
    }
    if (toolName === "update_meal") {
      return `itemCount: ${summary.itemCount ?? "?"}`;
    }
    if (toolName === "delete_meal") {
      return "<delete_meal args>";
    }
    if (toolName === "update_goals") {
      const fields = Array.isArray(summary.updatedFields)
        ? summary.updatedFields.join(",")
        : "";
      return `updatedFields: ${fields}`;
    }
    return `<${toolName} args>`;
  }
  return `<${toolName} args>`;
}

// ---------------------------------------------------------------------------
// Orchestrator-facing dispatch (registry-first per D-03). Adapts the
// controlled `runContract` result back to the legacy `ToolExecutionResult`
// shape expected by `server/orchestrator/index.ts` (Phase 8 hooks + Phase 9
// dailySummary contract). Controlled non-success outcomes are surfaced as
// `FatalToolError` so the orchestrator's `executed:false` hook path stays
// intact for log_food / get_daily_summary; future contracts that prefer
// controlled failures (e.g. update_goals in 10-03) should call `runContract`
// directly.
// ---------------------------------------------------------------------------

export async function executeTool(
  toolCall: ToolCall,
  deviceId: string,
  deps: ToolDeps,
  sourceContext?: { currentUserMessage?: string; previousAssistantMessage?: string },
): Promise<ToolExecutionResult> {
  const contract = toolRegistry.get(toolCall.function.name);
  if (!contract) {
    throw new FatalToolError("unknown tool");
  }

  const ctx: RunContractContext = {
    currentUserMessage: sourceContext?.currentUserMessage ?? "",
    previousAssistantMessage: sourceContext?.previousAssistantMessage,
    deps: { toolDeps: deps, deviceId },
  };

  const outcome = await runContract(contract, toolCall, ctx);

  if (!outcome.success) {
    if (
      toolCall.function.name === "log_food"
      && deps.imagePath
      && isMissingTrustedProteinBasisFailure(outcome)
    ) {
      return {
        result: outcome.result,
        summary: "failureReason: execute",
        success: false,
        executed: false,
        failureReason: outcome.failureReason,
      };
    }

    if (
      toolCall.function.name === "find_meals"
      || toolCall.function.name === "update_goals"
      || toolCall.function.name === "update_meal"
      || toolCall.function.name === "delete_meal"
    ) {
      const updatedFields =
        typeof outcome.logSummary === "object" &&
        outcome.logSummary !== null &&
        Array.isArray(outcome.logSummary.updatedFields)
          ? (outcome.logSummary.updatedFields as string[])
          : undefined;
      return {
        result: outcome.result,
        summary: `failureReason: ${outcome.failureReason ?? "validation"}`,
        success: false,
        executed: false,
        failureReason: outcome.failureReason,
        updatedFields,
      };
    }

    // Convert controlled failures into FatalToolError so the existing
    // orchestrator catch-block emits `executed:false` exactly as Phase 8 did
    // for log_food / get_daily_summary. Carry the underlying message so test
    // assertions like `/summary computation failed/` still match.
    let failureMessage = "tool execution failed";
    try {
      const parsed = JSON.parse(outcome.result) as Record<string, unknown>;
      if (typeof parsed.message === "string" && parsed.message.length > 0) {
        failureMessage = parsed.message;
      } else if (typeof parsed.failureReason === "string") {
        failureMessage = `tool failed: ${parsed.failureReason}`;
      }
    } catch {
      // result was not JSON; keep generic message
    }
    let diagnostic: FatalToolDiagnostic | undefined;
    try {
      const parsed = JSON.parse(outcome.result) as Record<string, unknown>;
      diagnostic = {
        failureReason: outcome.failureReason,
        ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
        ...(Array.isArray(parsed.fields) && parsed.fields.every((field) => typeof field === "string")
          ? { fields: parsed.fields as string[] }
          : {}),
      };
    } catch {
      diagnostic = outcome.failureReason ? { failureReason: outcome.failureReason } : undefined;
    }
    throw new FatalToolError(failureMessage, { diagnostic });
  }

  // Map contract-level success result back to ToolExecutionResult.
  if (toolCall.function.name === "log_food") {
    const contractResult = outcome.contractResult as LogFoodResult;
    if (contractResult.status === "needs_clarification") {
      return {
        result: outcome.result,
        summary: "status: needs_clarification",
        success: false,
        executed: false,
        failureReason: "guard",
      };
    }
    return {
      result: outcome.result,
      summary: "成功",
      mealMutationKind: "log",
      dailySummary: contractResult.dailySummary,
      affectedDate: contractResult.affectedDate,
      loggedMeal: contractResult.loggedMeal,
    };
  }

  if (toolCall.function.name === "find_meals") {
    const contractResult = outcome.contractResult as FindMealsResult;
    return {
      result: outcome.result,
      summary: `status: ${contractResult.status}`,
    };
  }

  if (toolCall.function.name === "update_meal") {
    const contractResult = outcome.contractResult as UpdateMealResult;
    return {
      result: outcome.result,
      summary: "成功",
      mealMutationKind: "update",
      dailySummary: contractResult.dailySummary,
      affectedDate: contractResult.affectedDate,
      loggedMeal: {
        ...projectMealIdentityFields(contractResult.updatedMeal),
        foodName: contractResult.updatedMeal.foodName,
        calories: contractResult.updatedMeal.calories,
        protein: contractResult.updatedMeal.protein,
        carbs: contractResult.updatedMeal.carbs,
        fat: contractResult.updatedMeal.fat,
        itemCount: contractResult.updatedMeal.itemCount,
        items: contractResult.updatedMeal.items,
        countedSources: [],
        excludedSources: [],
        usedConservativeAssumption: false,
      },
    };
  }

  if (toolCall.function.name === "delete_meal") {
    const contractResult = outcome.contractResult as DeleteMealResult;
    return {
      result: outcome.result,
      summary: "成功",
      mealMutationKind: "delete",
      dailySummary: contractResult.dailySummary,
      affectedDate: contractResult.affectedDate,
      deletedMeal: contractResult.deletedMeal,
    };
  }

  if (toolCall.function.name === "get_daily_summary") {
    const summary = outcome.contractResult as GetDailySummaryResult;
    if (summary.status === "needs_clarification") {
      return {
        result: outcome.result,
        summary: "status: needs_clarification",
        success: false,
        executed: false,
        failureReason: "guard",
      };
    }
    if (summary.status === "multiple_targets") {
      return {
        result: outcome.result,
        summary: "status: multiple_targets",
        success: false,
        executed: false,
        failureReason: "guard",
      };
    }
    return {
      result: outcome.result,
      summary: `熱量 ${summary.dailySummary.totalCalories}kcal, P${summary.dailySummary.totalProtein}g, C${summary.dailySummary.totalCarbs}g, F${summary.dailySummary.totalFat}g`,
      dailySummary: summary.dailySummary,
      affectedDate: summary.affectedDate,
    };
  }

  if (toolCall.function.name === "update_goals") {
    const contractResult = outcome.contractResult as UpdateGoalsResult;
    return {
      result: outcome.result,
      summary: `updatedFields: ${contractResult.updatedFields.join(",")}`,
      success: true,
      executed: true,
      updatedFields: [...contractResult.updatedFields],
      publishedEvents: [...contractResult.publishedEvents],
      dailyTargets: contractResult.targets,
    };
  }

  // Defensive: any contract added to the registry without a wrapper case here
  // returns the contract's toolMessage and an empty summary. Future tools
  // (e.g. update_goals in 10-03) are expected to call `runContract` directly.
  return {
    result: outcome.result,
    summary: "",
  };
}
