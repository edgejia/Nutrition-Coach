import { z } from "zod";
import type { ToolDefinition, ToolCall } from "../llm/types.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import {
  buildSummaryOutcomeAfterMealCommit,
  dailySummaryFromOutcome,
  type SummaryOutcome,
} from "../services/summary-outcome.js";
import type { createDeviceService, DailyTargets } from "../services/device.js";
import type {
  createMealCorrectionService,
  FindMealsResult,
  MealCorrectionCandidate,
} from "../services/meal-correction.js";
import type { createMealDeleteProposalService } from "../services/meal-delete-proposals.js";
import {
  MEAL_NUMERIC_FIELDS,
  type MealNumericField,
  type MealNumericUpdateInput,
  type createMealNumericProposalService,
} from "../services/meal-numeric-proposals.js";
import { MealRevisionPreconditionError } from "../services/meal-transactions.js";
import {
  GOAL_PROPOSAL_TTL_MS,
  type createGoalProposalService,
  type GoalProposalPayload,
} from "../services/goal-proposals.js";
import {
  DEFAULT_SESSION_ID,
  type createRecentMealLogStateService,
} from "../services/turn-state.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import {
  buildHistoricalLoggedAt,
  resolveHistoricalDateIntent,
  type HistoricalMealPeriod,
} from "../lib/historical-date.js";
import {
  extractExplicitMealPeriodFromSourceText,
  type MealPeriod,
} from "../lib/meal-period.js";
import { projectPublicMealItems } from "../lib/public-meal-items.js";
import {
  runContract,
  summarizeContractArgsForLog,
  type ToolContract,
  type RunContractContext,
  type SideEffectPolicyClass,
  type ToolPolicyDecisionFact,
} from "./tool-contract.js";
import {
  checkSourceFields,
  isGoalProposalCancel,
  isGoalProposalConsent,
} from "./source-text-guard.js";
import {
  authorizeMealNumericUpdate,
  classifyMealNumericAdjustment,
  extractMealNumericEvidence,
  type MealNumericAdjustmentClassification,
  type MealNumericUpdate,
} from "./meal-numeric-authority.js";
import {
  renderGoalAuthorityFailureCopy,
  renderGoalCancelCopy,
  renderGoalProposalCopy,
  renderGoalValidationFailureCopy,
  getProposalActionLabels,
  renderCorrectionTargetClarificationCopy,
  renderCorrectionTargetNoMealsForDateCopy,
  renderCorrectionTargetSameDateRecoveryCopy,
  renderHistoricalLogFoodClarificationCopy,
  renderHistoricalSummaryClarificationCopy,
  renderHistoricalSummaryMultipleTargetsCopy,
  renderMealDeleteProposalCopy,
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericClarificationCopy,
  renderMealNumericNoChangeCopy,
  renderMealNumericProposalCopy,
  renderRecentCorrectionEstimateProposalCopy,
  renderProposalCardIntro,
  renderProposalExpiredCopy,
} from "./mutation-receipts.js";
import type { PendingProposalCardInput } from "../services/proposal-cards.js";
import {
  classifyProteinSource,
  normalizeTrustedProteinEstimate,
  type ExcludedProteinSource,
  type ProteinSourceCertainty,
  type ProteinSourceInput,
  type TrustedProteinSource,
} from "./protein-trust.js";
import type { DeletedMealSnapshot } from "./mutation-effects.js";
import {
  derivePlanningFacts,
  type PlanningFacts,
} from "./planning-reply-renderer.js";

// ---------------------------------------------------------------------------
// Public types preserved for the orchestrator (Phase 8/9 callers).
// ---------------------------------------------------------------------------

export const FAILED_RECOGNITION_NO_SAVE_REPLY = "我沒有把這張照片存成餐點紀錄。請先補充餐點內容和份量，我再幫你估算。";
export const TEXT_NON_FOOD_NO_SAVE_REPLY = "我沒有把這段內容存成餐點紀錄。這個版本目前只支援飲食與餐點紀錄；如果你要記餐，請直接告訴我吃了什麼和份量。";

export interface ToolDeps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  mealDeleteProposalService?: ReturnType<typeof createMealDeleteProposalService>;
  mealNumericProposalService?: ReturnType<typeof createMealNumericProposalService>;
  recentMealLogStateService?: ReturnType<typeof createRecentMealLogStateService>;
  deviceService?: ReturnType<typeof createDeviceService>;
  goalProposalService?: ReturnType<typeof createGoalProposalService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
  imagePath?: string;
  toolSessionState?: {
    resolvedMealTargets: Array<{
      mealId: string;
      mealRevisionId: string;
    }>;
  };
}

export interface ToolExecutionResult {
  result: string;
  summary: string;
  success?: boolean;
  executed?: boolean;
  failureReason?: "validation" | "guard" | "execute";
  // Phase 83: typed diagnostic facts for controlled validation failures so the
  // orchestrator never reparses serialized tool JSON (Phase 68 D-01/D-07).
  validationDiagnostic?: {
    reason: string; // e.g. "schema_validation" — redacted diagnostic only
    fields?: string[]; // redacted validation field paths only
  };
  clarification?: ToolClarificationFact;
  controlledReply?: {
    source: "renderer";
    reason:
      | "goal_proposal"
      | "goal_authority_failure"
      | "goal_validation_failure"
      | "goal_cancel"
      | "meal_target_clarification"
      | "historical_date_clarification"
      | "historical_summary_clarification"
      | "meal_numeric_authority_failure"
      | "meal_numeric_clarification"
      | "meal_numeric_proposal"
      | "meal_delete_proposal"
      | "failed_recognition_no_save"
      | "text_non_food_no_save";
    text: string;
  };
  proposalCard?: PendingProposalCardInput;
  updatedFields?: string[];
  publishedEvents?: string[];
  policyFact?: ToolPolicyDecisionFact;
  dailyTargets?: DailyTargets;
  dailySummary?: DailySummary;
  summaryOutcome?: SummaryOutcome;
  summaryHistoryFacts?: {
    dailySummary?: DailySummary;
    meals: Array<{
      foodName: string;
      calories: number;
    }>;
  };
  planningFacts?: PlanningFacts;
  affectedDate?: string;
  mealMutationKind?: "log" | "update" | "delete";
  deletedMeal?: DeletedMealSnapshot;
  loggedMeal?: {
    receiptMealId?: string;
    mealId: string;
    mealRevisionId: string;
    dateKey: string;
    loggedAt: string;
    mealPeriod?: MealPeriod;
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

export interface ToolMealTargetCandidateFact {
  optionNumber: number;
  dateKey: string;
  displayTime: string;
  displayLabel: string;
  mealPeriod?: MealPeriod;
  mealPeriodSource?: "explicit";
}

export type ToolClarificationFact =
  | {
      kind: "meal_target";
      status: "needs_clarification" | "not_found";
      action: "update" | "delete";
      prompt: string;
      candidates: ToolMealTargetCandidateFact[];
    }
  | {
      kind: "historical_log";
      status: "needs_clarification";
      prompt: string;
      reason: HistoricalToolClarification["reason"];
    }
  | {
      kind: "historical_summary";
      status: "needs_clarification";
      prompt: string;
      reason: HistoricalToolClarification["reason"];
    }
  | {
      kind: "historical_summary";
      status: "multiple_targets";
      dateKeys: string[];
    };

export interface FatalToolDiagnostic {
  failureReason?: "validation" | "guard" | "execute";
  reason?: string;
  fields?: string[];
  policyFact?: ToolPolicyDecisionFact;
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

export interface LogFoodArgs extends HistoricalDateToolArgs {
  items: LogFoodItemArgs[];
  protein_sources?: ProteinSourceArgs[];
}

type QuantityUncertaintyReason = "missing_quantity";

interface NormalizedLogFoodArgs extends LogFoodArgs {
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

interface ProposeMealNumericCorrectionArgs {
  meal_id: string;
  fields: MealNumericField[];
  operator: "half" | "set" | "subtract_percent" | "add_amount" | "subtract_amount";
  value?: number;
}

interface ProposeMealEstimateArgs {
  meal_id: string;
  fields: MealNumericField[];
  estimated: Partial<Record<MealNumericField, number>>;
}

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
  dailySummary?: DailySummary;
  summaryOutcome: SummaryOutcome;
  affectedDate?: string;
  loggedMeal: {
    mealId: string;
    mealRevisionId: string;
    dateKey: string;
    loggedAt: string;
    mealPeriod?: MealPeriod;
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

interface FailedRecognitionNoSaveResult {
  status: "failed_recognition_no_save";
}

interface TextNonFoodNoSaveResult {
  status: "text_non_food_no_save";
}

interface RecentCorrectionEstimateProposalResult {
  status: "recent_correction_reestimate_proposal";
  reason: "meal_numeric_proposal";
  reply: string;
  proposalCard: PendingProposalCardInput;
}

interface RecentCorrectionEstimateNoChangeResult {
  status: "recent_correction_reestimate_no_change";
  reason: "meal_numeric_clarification";
  reply: string;
}

type LogFoodResult =
  | LogFoodSuccessResult
  | HistoricalToolClarification
  | FailedRecognitionNoSaveResult
  | TextNonFoodNoSaveResult
  | RecentCorrectionEstimateProposalResult
  | RecentCorrectionEstimateNoChangeResult;

interface UpdateMealResult {
  dailySummary?: DailySummary;
  summaryOutcome: SummaryOutcome;
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
    mealPeriod?: MealPeriod | null;
  };
}

interface DeleteMealResult {
  dailySummary?: DailySummary;
  summaryOutcome: SummaryOutcome;
  affectedDate: string;
  deletedMealId: string;
  deletedMeal: DeletedMealSnapshot;
}

interface MealDeleteProposalResult {
  status: "meal_delete_proposal";
  reason: "meal_delete_proposal";
  proposalId: string;
  reply: string;
  expiresAt: string;
  snapshot: {
    mealId: string;
    expectedMealRevisionId: string;
    mealLabel: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    dateKey: string;
    loggedAt: string;
    mealPeriod: MealPeriod;
    items?: Array<{
      foodName: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }>;
  };
}

type DeleteMealContractResult = DeleteMealResult | MealTargetControlledResult | MealDeleteProposalResult;

interface GetDailySummaryArgs {
  date_text?: string;
}

export type PlanNextMealArgs = z.infer<typeof planNextMealSchema>;

export interface PlanNextMealResult {
  status: "planning";
  planningFacts: PlanningFacts;
}

type GetDailySummaryResult =
  | {
      status: "summary";
      dailySummary: DailySummary;
      meals: Array<{
        foodName: string;
        calories: number;
      }>;
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
  publishedEvents?: Array<"goals_update">;
}

interface GoalControlledResult {
  status: "controlled_reply";
  reason: NonNullable<ToolExecutionResult["controlledReply"]>["reason"];
  reply: string;
}

type ProposeGoalsResult = GoalControlledResult & {
  reason: "goal_proposal";
  proposalCard: PendingProposalCardInput;
};

interface MealNumericControlledResult {
  status: "controlled_reply";
  reason: "meal_numeric_authority_failure" | "meal_numeric_clarification" | "meal_numeric_proposal";
  reply: string;
}

interface MealTargetControlledResult {
  status: "controlled_reply";
  reason: "meal_target_clarification";
  reply: string;
}

type UpdateGoalsContractResult = UpdateGoalsResult | GoalControlledResult;
type UpdateMealContractResult = UpdateMealResult | MealNumericControlledResult | MealTargetControlledResult;
type ProposeMealNumericCorrectionResult = MealNumericControlledResult & {
  reason: "meal_numeric_proposal";
  proposalCard?: PendingProposalCardInput;
};

type UpdateGoalsArgs =
  | ({ mode: "current_turn_values" } & Partial<DailyTargets>)
  | ({ mode: "latest_proposal" } & Partial<DailyTargets>);

export interface GoalProposalPolicyAuthorization {
  proposalId: string;
  proposal: GoalProposalPayload;
}

const finiteNumber = z.number().refine(Number.isFinite, "must be finite");
const nonNegativeFiniteNumber = z
  .number()
  .refine((value) => Number.isFinite(value) && value >= 0, "must be non-negative");
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
    calories: nonNegativeFiniteNumber,
    protein: nonNegativeFiniteNumber,
    carbs: nonNegativeFiniteNumber,
    fat: nonNegativeFiniteNumber,
    quantity: finiteNumber.optional(),
    quantity_g: finiteNumber.optional(),
    quantity_ml: finiteNumber.optional(),
    amount: z.string().optional(),
    unit: z.string().optional(),
    serving_size: z.string().optional(),
  })
  .strict();

const logFoodSchema = z
  .object({
    items: z.array(logFoodItemSchema).min(1, "items must contain at least one entry"),
    date_text: historicalDateTextSchema,
    meal_period: historicalMealPeriodSchema,
    protein_sources: z.array(proteinSourceSchema).min(1).optional(),
  })
  .strict();

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

export const planNextMealSchema = z.object({}).strict();

const targetFieldSchemas = {
  calories: z.number().min(500).max(8000),
  protein: z.number().min(0).max(400),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(300),
} as const;

const proposeGoalsSchema = z
  .object({
    calories: targetFieldSchemas.calories,
    protein: targetFieldSchemas.protein,
    carbs: targetFieldSchemas.carbs,
    fat: targetFieldSchemas.fat,
  })
  .strict();

const updateGoalsSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("current_turn_values"),
      calories: targetFieldSchemas.calories.optional(),
      protein: targetFieldSchemas.protein.optional(),
      carbs: targetFieldSchemas.carbs.optional(),
      fat: targetFieldSchemas.fat.optional(),
    })
    .strict()
    .refine((args) => updatedGoalFields(args).length > 0, {
      message: "at least one goal field is required",
    }),
  z
    .object({
      mode: z.literal("latest_proposal"),
      calories: targetFieldSchemas.calories.optional(),
      protein: targetFieldSchemas.protein.optional(),
      carbs: targetFieldSchemas.carbs.optional(),
      fat: targetFieldSchemas.fat.optional(),
    })
    .strict(),
]);

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

const mealNumericFieldSchema = z.enum(MEAL_NUMERIC_FIELDS);
const boundedEstimateSchema = z
  .object({
    calories: z.number().int().min(0).max(5000).optional(),
    protein: z.number().min(0).max(400).optional(),
    carbs: z.number().min(0).max(800).optional(),
    fat: z.number().min(0).max(400).optional(),
  })
  .strict();
const proposeMealEstimateSchema = z
  .object({
    meal_id: z.string().uuid("meal_id must be a uuid"),
    fields: z.array(mealNumericFieldSchema).min(1, "fields must contain at least one field"),
    estimated: boundedEstimateSchema,
  })
  .strict()
  .superRefine((args, ctx) => {
    const requestedFields = new Set(args.fields);
    if (requestedFields.size !== args.fields.length) {
      ctx.addIssue({
        code: "custom",
        message: "fields must be unique",
        path: ["fields"],
      });
    }
    for (const field of args.fields) {
      if (args.estimated[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "estimated value is required for each requested field",
          path: ["estimated", field],
        });
      }
    }
    for (const field of MEAL_NUMERIC_FIELDS) {
      if (args.estimated[field] !== undefined && !requestedFields.has(field)) {
        ctx.addIssue({
          code: "custom",
          message: "estimated values must match requested fields",
          path: ["estimated", field],
        });
      }
    }
  });
const proposeMealNumericCorrectionSchema = z
  .object({
    meal_id: z.string().uuid("meal_id must be a uuid"),
    fields: z.array(mealNumericFieldSchema).min(1, "fields must contain at least one field"),
    operator: z.enum(["half", "set", "subtract_percent", "add_amount", "subtract_amount"]),
    value: finiteNumber.optional(),
  })
  .strict()
  .refine((args) => new Set(args.fields).size === args.fields.length, {
    message: "fields must be unique",
    path: ["fields"],
  })
  .refine((args) => args.operator === "half" ? args.value === undefined : args.value !== undefined, {
    message: "value is required only for non-half operators",
    path: ["value"],
  });

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

function pickTargetPatch(args: Partial<DailyTargets>): Partial<DailyTargets> {
  const patch: Partial<DailyTargets> = {};
  for (const field of updatedGoalFields(args)) {
    patch[field] = args[field];
  }
  return patch;
}

function makeGoalControlledResult(
  reason: NonNullable<ToolExecutionResult["controlledReply"]>["reason"],
  reply: string,
): GoalControlledResult {
  return {
    status: "controlled_reply",
    reason,
    reply,
  };
}

function formatGoalValue(field: keyof DailyTargets, value: number): string {
  return field === "calories" ? `${value} kcal` : `${value} g`;
}

function goalFieldLabel(field: keyof DailyTargets): string {
  switch (field) {
    case "calories":
      return "卡路里";
    case "protein":
      return "蛋白質";
    case "carbs":
      return "碳水";
    case "fat":
      return "脂肪";
    default:
      return field satisfies never;
  }
}

function proposalMealNumericFieldLabel(field: MealNumericField): string {
  switch (field) {
    case "calories":
      return "卡路里";
    case "protein":
      return "蛋白質";
    case "carbs":
      return "碳水";
    case "fat":
      return "脂肪";
    default:
      return field satisfies never;
  }
}

function formatProposalMealNumericValue(field: MealNumericField, value: number): string {
  const unit = field === "calories" ? "kcal" : "g";
  const normalized = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${normalized} ${unit}`;
}

function formatProposalNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function proposalMealPeriodLabel(period: MealPeriod): string {
  switch (period) {
    case "breakfast":
      return "早餐";
    case "lunch":
      return "午餐";
    case "dinner":
      return "晚餐";
    case "late_night":
      return "宵夜";
    default:
      return period satisfies never;
  }
}

function buildGoalProposalCard(proposal: GoalProposalPayload): PendingProposalCardInput {
  const labels = getProposalActionLabels("goal");
  return {
    proposalId: proposal.proposalId,
    proposalKind: "goal",
    proposalLane: "goal",
    title: renderProposalCardIntro("goal"),
    details: {
      rows: (["calories", "protein", "carbs", "fat"] as const).map((field) => ({
        label: goalFieldLabel(field),
        after: formatGoalValue(field, proposal.targets[field]),
      })),
    },
    actions: {
      approveLabel: labels.approveLabel,
      editLabel: labels.editLabel,
      rejectLabel: labels.rejectLabel,
    },
    expiresAt: new Date(new Date(proposal.createdAt).getTime() + GOAL_PROPOSAL_TTL_MS).toISOString(),
    lapseCopy: renderProposalExpiredCopy("goal"),
  };
}

function buildMealNumericProposalCard(input: {
  proposalId: string;
  proposalKind: "meal_numeric" | "meal_estimate";
  affectedFields: Array<{ field: MealNumericField; before: number; after: number }>;
  expiresAt: string;
}): PendingProposalCardInput {
  const labels = getProposalActionLabels(input.proposalKind);
  return {
    proposalId: input.proposalId,
    proposalKind: input.proposalKind,
    proposalLane: "meal_mutation",
    title: renderProposalCardIntro(input.proposalKind),
    details: {
      rows: input.affectedFields.map((field) => ({
        label: proposalMealNumericFieldLabel(field.field),
        before: formatProposalMealNumericValue(field.field, field.before),
        after: formatProposalMealNumericValue(field.field, field.after),
      })),
    },
    actions: {
      approveLabel: labels.approveLabel,
      editLabel: labels.editLabel,
      rejectLabel: labels.rejectLabel,
    },
    expiresAt: input.expiresAt,
    lapseCopy: renderProposalExpiredCopy(input.proposalKind),
  };
}

function buildMealDeleteProposalCard(input: {
  proposalId: string;
  expiresAt: string;
  snapshot: MealDeleteProposalResult["snapshot"];
}): PendingProposalCardInput {
  const labels = getProposalActionLabels("meal_delete");
  return {
    proposalId: input.proposalId,
    proposalKind: "meal_delete",
    proposalLane: "meal_mutation",
    title: renderProposalCardIntro("meal_delete"),
    details: {
      rows: [
        { label: "餐點", value: input.snapshot.mealLabel },
        { label: "日期", value: `${input.snapshot.dateKey} ${proposalMealPeriodLabel(input.snapshot.mealPeriod)}` },
        {
          label: "營養",
          value: `${formatProposalNumber(input.snapshot.calories)} kcal，P${formatProposalNumber(input.snapshot.protein)}g / C${formatProposalNumber(input.snapshot.carbs)}g / F${formatProposalNumber(input.snapshot.fat)}g`,
        },
        ...(input.snapshot.items?.map((item) => ({
          label: item.foodName,
          value: `${formatProposalNumber(item.calories)} kcal`,
        })) ?? []),
      ],
    },
    actions: {
      approveLabel: labels.approveLabel,
      editLabel: labels.editLabel,
      rejectLabel: labels.rejectLabel,
    },
    expiresAt: input.expiresAt,
    lapseCopy: renderProposalExpiredCopy("meal_delete"),
  };
}

function isGoalControlledResult(result: UpdateGoalsContractResult): result is GoalControlledResult {
  return "status" in result && result.status === "controlled_reply";
}

function isMealControlledResult(
  result: UpdateMealContractResult | DeleteMealContractResult,
): result is MealNumericControlledResult | MealTargetControlledResult {
  return "status" in result && result.status === "controlled_reply";
}

function goalToolProperties(required = false) {
  const properties = {
    calories: { type: "number", minimum: 500, maximum: 8000 },
    protein: { type: "number", minimum: 0, maximum: 400 },
    carbs: { type: "number", minimum: 0, maximum: 1000 },
    fat: { type: "number", minimum: 0, maximum: 300 },
  };
  return required
    ? { properties, required: ["calories", "protein", "carbs", "fat"] }
    : { properties };
}

const goalTargetProperties = goalToolProperties();

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
  if (/宵夜/.test(input)) return "late_night";
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

function shouldMarkMissingQuantity(
  items: LogFoodItemArgs[],
  sourceText?: string,
): boolean {
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
  const items = repairGenericDrinkItemsFromSourceText(args.items, sourceText);

  return {
    items,
    ...(args.date_text !== undefined ? { date_text: args.date_text } : {}),
    ...(args.meal_period !== undefined ? { meal_period: args.meal_period } : {}),
    ...(args.protein_sources !== undefined ? { protein_sources: args.protein_sources } : {}),
    ...(shouldMarkMissingQuantity(items, sourceText)
      ? { quantityUncertaintyReason: "missing_quantity" as const }
      : {}),
  };
}

function normalizeFailedRecognitionName(name: string): string {
  return name.trim().toLowerCase();
}

const FAILED_RECOGNITION_PLACEHOLDER_NAMES = new Set([
  "unknown",
  "unknown food",
  "unrecognized",
  "unrecognized food",
  "unidentified",
  "unidentified food",
  "無法辨識內容",
  "無法辨識食物",
  "無法辨識餐點",
  "無法辨識的照片",
  "未知食物",
  "未知餐點",
]);

function isFailedRecognitionPlaceholderName(name: string): boolean {
  const normalized = normalizeFailedRecognitionName(name);
  if (!normalized) {
    return false;
  }

  if (FAILED_RECOGNITION_PLACEHOLDER_NAMES.has(normalized)) {
    return true;
  }

  return /^(?:cannot|can't|unable to|not able to)\s+(?:identify|recognize)/.test(normalized)
    || /(?:無法|不能|未能).{0,4}(?:辨識|識別).{0,6}(?:內容|食物|餐點|照片)/.test(normalized);
}

function aggregateMealNutrition(items: LogFoodItemArgs[]) {
  return items.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function isImpossibleMealAggregate(aggregate: {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}): boolean {
  const values = [aggregate.calories, aggregate.protein, aggregate.carbs, aggregate.fat];
  if (values.some((value) => value < 0)) {
    return true;
  }
  if (values.every((value) => value === 0)) {
    return true;
  }
  return aggregate.calories <= 0
    && (aggregate.protein > 0 || aggregate.carbs > 0 || aggregate.fat > 0);
}

function getLogFoodNames(args: NormalizedLogFoodArgs): string[] {
  return args.items.map((item) => item.food_name);
}

function isFailedRecognitionLogFood(args: NormalizedLogFoodArgs): boolean {
  if (getLogFoodNames(args).some(isFailedRecognitionPlaceholderName)) {
    return true;
  }
  return isImpossibleMealAggregate(aggregateMealNutrition(args.items));
}

const TEXT_NON_FOOD_LABEL_PATTERN =
  /(?:運動|健身|重訓|重量訓練|深蹲|硬舉|臥推|伏地挺身|跑步|慢跑|游泳|單車|騎車|步行|走路|訓練|workout|exercise|squat|deadlift|bench|run|running|cycling)/i;

const TEXT_NON_FOOD_QUANTITY_PATTERN =
  /(?:\d+(?:\.\d+)?\s*(?:kg|公斤|公升|下|組|reps?|sets?)|\b\d+\s*[xX]\s*\d+\b)/i;

function isTextNonFoodNoSaveLogFood(
  args: NormalizedLogFoodArgs,
  sourceText: string,
  hadImage: boolean,
): boolean {
  if (hadImage || !isImpossibleMealAggregate(aggregateMealNutrition(args.items))) {
    return false;
  }

  const labels = getLogFoodNames(args).join(" ");
  return TEXT_NON_FOOD_LABEL_PATTERN.test(labels)
    || (
      TEXT_NON_FOOD_LABEL_PATTERN.test(sourceText)
      && TEXT_NON_FOOD_QUANTITY_PATTERN.test(sourceText)
    );
}

const RECENT_CORRECTION_NEW_MEAL_PATTERN =
  /(?:新的一餐|另外一餐|再記一餐|照常記錄)/;

const RECENT_CORRECTION_SIGNAL_PATTERN =
  /(?:其實|不是|更正|改成|目測|不要新增第二餐|不要新增|別新增|剛剛|剛才)/;

const RECENT_CORRECTION_PORTION_REPLACEMENT_PATTERN =
  /(?:\d+(?:\.\d+)?\s*(?:g|克|公克).{0,16}(?:不是|改成|只有|約|目測)|(?:不是|改成|只有|約|目測).{0,16}\d+(?:\.\d+)?\s*(?:g|克|公克))/;

function isCorrectionLikeRecentMealFollowUp(sourceText: string): boolean {
  const text = sourceText.trim();
  if (!text || RECENT_CORRECTION_NEW_MEAL_PATTERN.test(text)) {
    return false;
  }
  return RECENT_CORRECTION_SIGNAL_PATTERN.test(text)
    || RECENT_CORRECTION_PORTION_REPLACEMENT_PATTERN.test(text);
}

function resolveProteinSourceInputs(
  args: LogFoodArgs,
  sourceText?: string,
): { proteinSources: ProteinSourceInput[]; usedExplicitProteinSources: boolean } {
  const inferredSources = args.items.flatMap((item) => inferProteinSourcesFromItem(item));

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
  return roundProtein(args.items.reduce((sum, item) => sum + item.protein, 0));
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

  const labels = args.items.map((item) => item.food_name);
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
  args: LogFoodArgs,
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
  return projectPublicMealItems(items.map((item, position) => ({ ...item, position })));
}

function projectMealIdentityFields(meal: {
  id: string;
  mealRevisionId: string;
  loggedAt: string;
  mealPeriod?: MealPeriod | null;
  imagePath: string | null;
}) {
  const imageAssetId = parseAssetRef(meal.imagePath);
  return {
    mealId: meal.id,
    mealRevisionId: meal.mealRevisionId,
    dateKey: formatLocalDate(new Date(meal.loggedAt)),
    loggedAt: meal.loggedAt,
    ...(meal.mealPeriod ? { mealPeriod: meal.mealPeriod } : {}),
    imageAssetId,
    imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
  };
}

function findResolvedMealTarget(
  toolSessionState: ToolDeps["toolSessionState"] | undefined,
  mealId: string,
): { mealId: string; mealRevisionId: string } | undefined {
  return toolSessionState?.resolvedMealTargets?.find(
    (target) => target.mealId === mealId && target.mealRevisionId.trim().length > 0,
  );
}

function revisionPreconditionFatalError(error: MealRevisionPreconditionError): FatalToolError {
  return new FatalToolError(error.code);
}

function normalizeUpdateMealInput(args: UpdateMealArgs): {
  serviceInput:
    | { items: Array<{ foodName: string; calories: number; protein: number; carbs: number; fat: number }> }
    | { patch: { foodName?: string; calories?: number; protein?: number; carbs?: number; fat?: number } };
  numericUpdate?: MealNumericUpdate;
} {
  if ("items" in args) {
    const items = args.items.map((item) => ({
      foodName: item.food_name.trim(),
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    }));
    return {
      serviceInput: { items },
      numericUpdate: { items },
    };
  }

  const patch = {
    ...(args.food_name !== undefined ? { foodName: args.food_name.trim() } : {}),
    ...(args.calories !== undefined ? { calories: args.calories } : {}),
    ...(args.protein !== undefined ? { protein: args.protein } : {}),
    ...(args.carbs !== undefined ? { carbs: args.carbs } : {}),
    ...(args.fat !== undefined ? { fat: args.fat } : {}),
  };
  const numericPatch = {
    ...(args.calories !== undefined ? { calories: args.calories } : {}),
    ...(args.protein !== undefined ? { protein: args.protein } : {}),
    ...(args.carbs !== undefined ? { carbs: args.carbs } : {}),
    ...(args.fat !== undefined ? { fat: args.fat } : {}),
  };

  return {
    serviceInput: { patch },
    ...(Object.keys(numericPatch).length > 0 ? { numericUpdate: { patch: numericPatch } } : {}),
  };
}

function firstMealNumericField(paths: readonly string[]): MealNumericField | undefined {
  for (const path of paths) {
    const match = path.match(/(?:^|\.)(calories|protein|carbs|fat)$/);
    if (match) {
      return match[1] as MealNumericField;
    }
  }
  return undefined;
}

function roundComparableMealNumeric(value: number): number {
  return Number(Number(value).toFixed(3));
}

function filterUnchangedMealNumericPatch(
  update: MealNumericUpdate,
  currentTotals: Record<MealNumericField, number>,
): MealNumericUpdate | undefined {
  if ("items" in update) {
    return update;
  }

  const patch: Partial<Record<MealNumericField, number>> = {};
  for (const field of MEAL_NUMERIC_FIELDS) {
    const value = update.patch[field];
    if (value === undefined) continue;
    if (roundComparableMealNumeric(currentTotals[field]) === roundComparableMealNumeric(value)) continue;
    patch[field] = value;
  }

  return Object.keys(patch).length > 0 ? { patch } : undefined;
}

function buildBoundedEstimatePatch(
  fields: readonly MealNumericField[],
  estimated: Partial<Record<MealNumericField, number>>,
): MealNumericUpdateInput {
  const patch: MealNumericUpdateInput = {};
  for (const field of fields) {
    const value = estimated[field];
    if (value !== undefined) {
      patch[field] = value;
    }
  }
  return patch;
}

function buildEstimateAffectedFields(
  fields: readonly MealNumericField[],
  updateInput: MealNumericUpdateInput,
  currentTotals: Record<MealNumericField, number>,
) {
  return fields
    .filter((field) => updateInput[field] !== undefined)
    .filter((field) => roundComparableMealNumeric(currentTotals[field]) !== roundComparableMealNumeric(updateInput[field]!))
    .map((field) => ({
      field,
      before: currentTotals[field],
      after: updateInput[field]!,
    }));
}

function buildUpdateInputFromAffectedFields(
  affectedFields: Array<{ field: MealNumericField; after: number }>,
): MealNumericUpdateInput {
  const input: MealNumericUpdateInput = {};
  for (const affected of affectedFields) {
    input[affected.field] = affected.after;
  }
  return input;
}

function makeMealNumericControlledResult(
  reason: MealNumericControlledResult["reason"],
  reply: string,
): MealNumericControlledResult {
  return {
    status: "controlled_reply",
    reason,
    reply,
  };
}

function makeMealDeleteProposalResult(input: Omit<MealDeleteProposalResult, "status" | "reason">): MealDeleteProposalResult {
  return {
    status: "meal_delete_proposal",
    reason: "meal_delete_proposal",
    ...input,
  };
}

function makeMealTargetControlledResult(reply: string): MealTargetControlledResult {
  return {
    status: "controlled_reply",
    reason: "meal_target_clarification",
    reply,
  };
}

type DeviceRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createDeviceService>["getDevice"]>>
>;

function deviceRowToDailyTargets(device: DeviceRow): DailyTargets {
  return {
    calories: device.dailyCalories,
    protein: device.dailyProtein,
    carbs: device.dailyCarbs,
    fat: device.dailyFat,
  };
}

function classificationMatchesOperator(
  classification: MealNumericAdjustmentClassification,
  args: ProposeMealNumericCorrectionArgs,
  currentUserMessage: string,
): boolean {
  if (args.operator === "set") {
    if (classification.kind !== "explicit_final_value" || args.value === undefined) {
      return false;
    }
    const evidence = extractMealNumericEvidence(currentUserMessage);
    return args.fields.every((field) => evidence[field].includes(args.value!));
  }

  if (classification.kind !== "proposal_candidate" || classification.operator !== args.operator) {
    return false;
  }
  if (args.operator === "half") {
    return true;
  }
  return "value" in classification && classification.value === args.value;
}

function toMealNumericOperatorIntent(args: ProposeMealNumericCorrectionArgs) {
  switch (args.operator) {
    case "half":
      return { fields: args.fields, operator: args.operator } as const;
    case "set":
    case "subtract_percent":
    case "add_amount":
    case "subtract_amount":
      return { fields: args.fields, operator: args.operator, value: args.value ?? 0 } as const;
  }
}

function mealNumericRendererOperator(operator: string): string {
  switch (operator) {
    case "subtract_percent":
      return "reduce_percent";
    case "add_amount":
      return "add";
    case "subtract_amount":
      return "subtract";
    default:
      return operator;
  }
}

// ---------------------------------------------------------------------------
// Contracts. logSummary returns redacted shape (D-30); macros are part of
// existing Phase 8 behavior for log_food (intentional, see plan).
// ---------------------------------------------------------------------------

const logFoodContract: ToolContract<LogFoodArgs, LogFoodResult> = {
  name: "log_food",
  policyClass: "execute-and-report",
  policyRules: [
    {
      id: "log_food_failed_recognition_no_save",
      decision: "blocked",
      description: "Failed image recognition returns a renderer-owned no-save reply without meal or summary mutation.",
    },
    {
      id: "log_food_text_non_food_no_save",
      decision: "blocked",
      description: "Text or unsupported non-food all-zero attempts return a renderer-owned no-save reply without meal or summary mutation.",
    },
    {
      id: "log_food_recent_correction_reestimate_proposal",
      decision: "blocked",
      description: "Correction-like recent follow-ups create a confirm-first meal estimate proposal instead of persisting a duplicate meal.",
    },
    {
      id: "log_food_historical_date_clarification",
      decision: "blocked",
      description: "Historical date ambiguity returns one controlled clarification without meal or summary mutation.",
    },
    {
      id: "log_food_trusted_protein_basis_guard",
      decision: "blocked",
      description: "Unsupported trusted-protein inputs fail closed before persistence.",
    },
  ],
  description: "將已分析的一項或多項食物記錄到今日，或記錄到明確指定的一個過去日期。歷史記錄只能對單一日期執行。",
  parameters: {
    type: "object",
    properties: {
      protein_sources: {
        type: "array",
        description: "Optional parse-time evidence. Provide only when credible protein-source anchors exist; omit when no credible anchors are available.",
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
    required: ["items"],
    additionalProperties: false,
  },
  zodSchema: logFoodSchema,
  // No sourceFields per D-11: log_food calorie estimates need not appear in
  // user text; the assistant computes them.
  logSummary: (args) => ({
    tool: "log_food",
    calories: args.items.reduce((sum, item) => sum + item.calories, 0),
    protein: args.items.reduce((sum, item) => sum + item.protein, 0),
    carbs: args.items.reduce((sum, item) => sum + item.carbs, 0),
    fat: args.items.reduce((sum, item) => sum + item.fat, 0),
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

    const mealPeriod = extractExplicitMealPeriodFromSourceText(context.currentUserMessage);
    const normalized = normalizeLogFoodArgs(args, context.currentUserMessage);
    if (
      deps.recentMealLogStateService &&
      deps.mealCorrectionService &&
      deps.mealNumericProposalService &&
      isCorrectionLikeRecentMealFollowUp(context.currentUserMessage)
    ) {
      const recentMeal = await deps.recentMealLogStateService.getLatest({
        deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      if (recentMeal) {
        try {
          const currentFacts = await deps.mealCorrectionService.loadCurrentMealFacts(
            deviceId,
            recentMeal.mealId,
            recentMeal.mealRevisionId,
          );
          const estimatedTotals = aggregateMealNutrition(normalized.items);
          const affectedFields = buildEstimateAffectedFields(
            MEAL_NUMERIC_FIELDS,
            estimatedTotals,
            currentFacts.totals,
          );
          if (affectedFields.length === 0) {
            const reply = renderMealNumericNoChangeCopy();
            return {
              ok: true,
              result: {
                status: "recent_correction_reestimate_no_change" as const,
                reason: "meal_numeric_clarification" as const,
                reply,
              },
              toolMessage: reply,
            };
          }
          const proposal = await deps.mealNumericProposalService.putLatest({
            deviceId,
            sessionId: DEFAULT_SESSION_ID,
            input: {
              mealId: currentFacts.mealId,
              expectedMealRevisionId: currentFacts.currentMealRevisionId,
              updateInput: buildUpdateInputFromAffectedFields(affectedFields),
              affectedFields,
              sourceOperator: "model_estimate",
              provenance: "model_estimate",
            },
          });
          await deps.mealDeleteProposalService?.clear({ deviceId, sessionId: DEFAULT_SESSION_ID });
          const otherProposalKindActive = deps.goalProposalService
            ? Boolean(await deps.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))
            : false;
          const reply = renderRecentCorrectionEstimateProposalCopy({
            mealLabel: currentFacts.mealLabel,
            affectedFields: proposal.affectedFields,
            otherProposalKindActive,
          });
          return {
            ok: true,
            result: {
              status: "recent_correction_reestimate_proposal" as const,
              reason: "meal_numeric_proposal" as const,
              reply,
              proposalCard: buildMealNumericProposalCard({
                proposalId: proposal.proposalId,
                proposalKind: "meal_estimate",
                affectedFields: proposal.affectedFields,
                expiresAt: proposal.expiresAt,
              }),
            },
            toolMessage: reply,
          };
        } catch (error) {
          if (error instanceof MealRevisionPreconditionError) {
            throw revisionPreconditionFatalError(error);
          }
          throw error;
        }
      }
    }
    if (isTextNonFoodNoSaveLogFood(normalized, context.currentUserMessage, Boolean(deps.imagePath))) {
      return {
        ok: true,
        result: { status: "text_non_food_no_save" as const },
        toolMessage: JSON.stringify({ status: "text_non_food_no_save" }),
      };
    }
    if (isFailedRecognitionLogFood(normalized)) {
      return {
        ok: true,
        result: { status: "failed_recognition_no_save" as const },
        toolMessage: JSON.stringify({ status: "failed_recognition_no_save" }),
      };
    }
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
        ...(mealPeriod ? { mealPeriod } : {}),
        items: normalizedItems,
      });

    // Phase 8/9 invariant: persist the meal BEFORE recomputing the daily
    // summary so partial-success fallback paths still see the row in the DB.
    const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
      deviceId,
      affectedDate: dateIntent.dateKey,
      summaryService: deps.summaryService,
      foodLoggingService: deps.foodLoggingService,
    });
    const dailySummary = dailySummaryFromOutcome(summaryOutcome);

    return {
      ok: true,
      result: {
        status: "logged",
        summaryOutcome,
        ...(dailySummary ? { dailySummary } : {}),
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
  policyClass: "clarify-first",
  policyRules: [
    {
      id: "find_meals_target_clarification",
      decision: "blocked",
      description: "Ambiguous update/delete targets return renderer-owned clarification instead of mutating meals.",
    },
    {
      id: "find_meals_pending_selection_helper_state",
      decision: "allowed",
      description: "May write session-scoped pending target-selection metadata, never meal, goal, or summary mutations.",
    },
  ],
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
    const result = await deps.mealCorrectionService.findMeals({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      action: args.action,
      query: args.query.trim(),
      options: {
        currentDate,
        previousDateKey: extractPreviousHistoricalDateKey(
          context.previousAssistantMessage,
          currentDate,
        ),
      },
    });
    if (deps.toolSessionState) {
      deps.toolSessionState.resolvedMealTargets = result.status === "resolved"
        ? [{ mealId: result.resolvedMealId, mealRevisionId: result.mealRevisionId }]
        : [];
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
  policyClass: "direct-execute",
  policyRules: [
    {
      id: "get_daily_summary_historical_date_clarification",
      decision: "blocked",
      description: "Ambiguous or multi-date summary queries return controlled clarification without publish side effects.",
    },
  ],
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
    const meals = await deps.foodLoggingService.getMealsByDate(
      deviceId,
      buildLocalMidpointDate(dateIntent.dateKey),
    );
    const mealFacts = meals.map((meal) => ({
      foodName: meal.foodName,
      calories: meal.calories,
    }));
    return {
      ok: true,
      result: {
        status: "summary",
        dailySummary: summary,
        meals: mealFacts,
        affectedDate: dateIntent.isHistorical ? dateIntent.dateKey : undefined,
      },
      toolMessage: JSON.stringify({
        dailySummary: summary,
        meals: mealFacts,
      }),
    };
  },
};

export const planNextMealContract: ToolContract<
  PlanNextMealArgs,
  PlanNextMealResult
> = {
  name: "plan_next_meal",
  policyClass: "direct-execute",
  policyRules: [
    {
      id: "plan_next_meal_authoritative_current_facts",
      decision: "allowed",
      description: "Computes current planning facts from authenticated-device summary and target services.",
    },
    {
      id: "plan_next_meal_no_mutation",
      decision: "allowed",
      description: "Returns planning facts only and does not mutate meals, goals, proposals, receipts, or cards.",
    },
  ],
  description: "依今日目標與已記錄攝取，取得下一餐規劃所需的後端權威事實。沒有參數；不可用於記錄或修改餐點。",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  zodSchema: planNextMealSchema,
  logSummary: () => ({ tool: "plan_next_meal" }),
  execute: async (_args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.summaryService || !deps.deviceService || !deviceId) {
      throw new Error("plan_next_meal contract missing summaryService/deviceService/deviceId in context");
    }

    const [summary, device] = await Promise.all([
      deps.summaryService.getDailySummary(deviceId, currentAppDate()),
      deps.deviceService.getDevice(deviceId),
    ]);
    if (!device) {
      throw new Error("plan_next_meal contract could not load device targets");
    }

    const planningFacts = derivePlanningFacts(summary, deviceRowToDailyTargets(device));
    return {
      ok: true,
      result: {
        status: "planning",
        planningFacts,
      },
      toolMessage: JSON.stringify(planningFacts),
    };
  },
};

const updateMealContract: ToolContract<UpdateMealArgs, UpdateMealContractResult> = {
  name: "update_meal",
  policyClass: "direct-execute",
  policyRules: [
    {
      id: "update_meal_requires_resolved_target",
      decision: "blocked",
      description: "Direct meal updates require a same-turn resolved target.",
    },
    {
      id: "update_meal_numeric_authority_guard",
      decision: "blocked",
      description: "Numeric changes must pass current-turn source authority before write.",
    },
    {
      id: "update_meal_revision_precondition_guard",
      decision: "blocked",
      description: "Direct meal updates require the resolved target revision to remain current.",
    },
  ],
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

    const resolvedTarget = findResolvedMealTarget(deps.toolSessionState, args.meal_id);
    if (!resolvedTarget) {
      throw new FatalToolError("meal target unresolved");
    }

    const { serviceInput, numericUpdate } = normalizeUpdateMealInput(args);

    let updated: UpdateMealResult;
    try {
      const currentFacts = await deps.mealCorrectionService.loadCurrentMealFacts(
        deviceId,
        args.meal_id,
        resolvedTarget.mealRevisionId,
      );
      const changedNumericUpdate = numericUpdate
        ? filterUnchangedMealNumericPatch(numericUpdate, currentFacts.totals)
        : undefined;
      if (changedNumericUpdate) {
        const authority = authorizeMealNumericUpdate({
          currentUserMessage: context.currentUserMessage,
          currentMeal: {
            ...currentFacts.totals,
            items: currentFacts.items,
          },
          update: changedNumericUpdate,
        });
        if (!authority.ok) {
          const field = firstMealNumericField(authority.unauthorizedFields);
          const reply = renderMealNumericAuthorityFailureCopy({ field });
          return {
            ok: true,
            result: makeMealNumericControlledResult("meal_numeric_authority_failure", reply),
            toolMessage: reply,
          };
        }
      }

      updated = await deps.mealCorrectionService.updateMeal(
        deviceId,
        args.meal_id,
        serviceInput,
        resolvedTarget.mealRevisionId,
      );
    } catch (error) {
      if (error instanceof MealRevisionPreconditionError) {
        const recovery = await deps.mealCorrectionService.recoverStalePendingSelection?.({
          deviceId,
          sessionId: DEFAULT_SESSION_ID,
          action: "update",
        });
        if (recovery) {
          const reply = renderFindMealsControlledReply(recovery);
          return {
            ok: true,
            result: makeMealTargetControlledResult(reply),
            toolMessage: reply,
          };
        }
        throw revisionPreconditionFatalError(error);
      }
      const message = error instanceof Error ? error.message : "meal update failed";
      if (message === "MEAL_NAME_PATCH_REQUIRES_SINGLE_ITEM") {
        throw new FatalToolError("multi-item meal name changes require full items replacement");
      }
      throw error;
    }

    await deps.mealCorrectionService.clearPendingSelection({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    });
    if (deps.toolSessionState) {
      deps.toolSessionState.resolvedMealTargets = [];
    }

    return {
      ok: true,
      result: updated,
      toolMessage: "已更新餐點",
    };
  },
};

const proposeMealNumericCorrectionContract: ToolContract<
  ProposeMealNumericCorrectionArgs,
  ProposeMealNumericCorrectionResult
> = {
  name: "propose_meal_numeric_correction",
  policyClass: "confirm-first",
  policyRules: [
    {
      id: "propose_meal_numeric_correction_setup_only",
      decision: "allowed",
      description: "Writes pending proposal authority but does not mutate meals.",
    },
    {
      id: "propose_meal_numeric_correction_requires_resolved_target",
      decision: "blocked",
      description: "Proposal setup requires a same-turn resolved target before writing pending helper state.",
    },
  ],
  description:
    "建立一組待確認的餐點數字修正提案，不會更新餐點。只接受已解析 meal_id、受影響欄位和本輪文字支持的操作；具體 before/after 由後端從目前餐點資料計算。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meal_id: { type: "string" },
      fields: {
        type: "array",
        items: { type: "string", enum: [...MEAL_NUMERIC_FIELDS] },
      },
      operator: {
        type: "string",
        enum: ["half", "set", "subtract_percent", "add_amount", "subtract_amount"],
      },
      value: { type: "number" },
    },
    required: ["meal_id", "fields", "operator"],
  },
  zodSchema: proposeMealNumericCorrectionSchema,
  logSummary: (args) => ({
    tool: "propose_meal_numeric_correction",
    fields: [...args.fields],
    operator: args.operator,
    hasValue: args.value !== undefined,
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.mealCorrectionService || !deps.mealNumericProposalService || !deviceId) {
      throw new Error("propose_meal_numeric_correction contract missing mealCorrectionService/mealNumericProposalService/deviceId in context");
    }

    const resolvedTarget = findResolvedMealTarget(deps.toolSessionState, args.meal_id);
    if (!resolvedTarget) {
      throw new FatalToolError("meal target unresolved");
    }

    const classification = classifyMealNumericAdjustment(context.currentUserMessage);
    if (!classificationMatchesOperator(classification, args, context.currentUserMessage)) {
      const reply = renderMealNumericClarificationCopy({ field: args.fields[0] });
      return {
        ok: true,
        result: makeMealNumericControlledResult("meal_numeric_clarification", reply) as ProposeMealNumericCorrectionResult,
        toolMessage: reply,
      };
    }

    try {
      const currentFacts = await deps.mealCorrectionService.loadCurrentMealFacts(
        deviceId,
        args.meal_id,
        resolvedTarget.mealRevisionId,
      );
      const preview = deps.mealCorrectionService.previewMealNumericCorrection(
        currentFacts,
        toMealNumericOperatorIntent(args),
      );
      if (preview.affectedFields.length === 0) {
        const reply = renderMealNumericNoChangeCopy();
        return {
          ok: true,
          result: makeMealNumericControlledResult("meal_numeric_clarification", reply) as ProposeMealNumericCorrectionResult,
          toolMessage: reply,
        };
      }
      const proposal = await deps.mealNumericProposalService.putLatest({
        deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
        mealId: preview.mealId,
        expectedMealRevisionId: preview.expectedMealRevisionId,
        updateInput: preview.updateInput,
        affectedFields: preview.affectedFields,
        sourceOperator: preview.sourceOperator,
        },
      });
      await deps.mealDeleteProposalService?.clear({ deviceId, sessionId: DEFAULT_SESSION_ID });
      const otherProposalKindActive = deps.goalProposalService
        ? Boolean(await deps.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))
        : false;
      const reply = renderMealNumericProposalCopy({
        mealLabel: preview.mealLabel,
        affectedFields: proposal.affectedFields,
        sourceOperator: mealNumericRendererOperator(proposal.sourceOperator),
        otherProposalKindActive,
      });
      return {
        ok: true,
        result: {
          ...makeMealNumericControlledResult("meal_numeric_proposal", reply),
          reason: "meal_numeric_proposal",
          proposalCard: buildMealNumericProposalCard({
            proposalId: proposal.proposalId,
            proposalKind: "meal_numeric",
            affectedFields: proposal.affectedFields,
            expiresAt: proposal.expiresAt,
          }),
        },
        toolMessage: reply,
      };
    } catch (error) {
      if (error instanceof MealRevisionPreconditionError) {
        throw revisionPreconditionFatalError(error);
      }
      throw error;
    }
  },
};

const proposeMealEstimateContract: ToolContract<
  ProposeMealEstimateArgs,
  ProposeMealNumericCorrectionResult
> = {
  name: "propose_meal_estimate",
  policyClass: "confirm-first",
  policyRules: [
    {
      id: "propose_meal_estimate_setup_only",
      decision: "allowed",
      description: "Writes bounded model-estimate proposal authority but does not mutate meals.",
    },
    {
      id: "propose_meal_estimate_requires_resolved_target",
      decision: "blocked",
      description: "Estimate proposal setup requires a same-turn resolved target before writing pending helper state.",
    },
    {
      id: "propose_meal_estimate_bounds_validation",
      decision: "blocked",
      description: "Model-estimated numeric values must pass strict field presence, uniqueness, and single-field bounds before persistence.",
    },
  ],
  description:
    "建立一組待確認的餐點估值修正提案，不會更新餐點。只在使用者明確要求協助估合理數值時使用；meal_id 必須已解析，估值只可放在 estimated 物件並通過後端單欄上下限驗證。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meal_id: { type: "string" },
      fields: {
        type: "array",
        items: { type: "string", enum: [...MEAL_NUMERIC_FIELDS] },
      },
      estimated: {
        type: "object",
        additionalProperties: false,
        properties: {
          calories: { type: "integer", minimum: 0, maximum: 5000 },
          protein: { type: "number", minimum: 0, maximum: 400 },
          carbs: { type: "number", minimum: 0, maximum: 800 },
          fat: { type: "number", minimum: 0, maximum: 400 },
        },
      },
    },
    required: ["meal_id", "fields", "estimated"],
  },
  zodSchema: proposeMealEstimateSchema,
  logSummary: (args) => ({
    tool: "propose_meal_estimate",
    fields: [...args.fields],
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.mealCorrectionService || !deps.mealNumericProposalService || !deviceId) {
      throw new Error("propose_meal_estimate contract missing mealCorrectionService/mealNumericProposalService/deviceId in context");
    }

    const resolvedTarget = findResolvedMealTarget(deps.toolSessionState, args.meal_id);
    if (!resolvedTarget) {
      throw new FatalToolError("meal target unresolved");
    }

    try {
      const currentFacts = await deps.mealCorrectionService.loadCurrentMealFacts(
        deviceId,
        args.meal_id,
        resolvedTarget.mealRevisionId,
      );
      const updateInput = buildBoundedEstimatePatch(args.fields, args.estimated);
      const affectedFields = buildEstimateAffectedFields(args.fields, updateInput, currentFacts.totals);
      if (affectedFields.length === 0) {
        const reply = renderMealNumericNoChangeCopy();
        return {
          ok: true,
          result: makeMealNumericControlledResult("meal_numeric_clarification", reply) as ProposeMealNumericCorrectionResult,
          toolMessage: reply,
        };
      }
      const proposal = await deps.mealNumericProposalService.putLatest({
        deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: currentFacts.mealId,
          expectedMealRevisionId: currentFacts.currentMealRevisionId,
          updateInput: buildUpdateInputFromAffectedFields(affectedFields),
          affectedFields,
          sourceOperator: "model_estimate",
          provenance: "model_estimate",
        },
      });
      await deps.mealDeleteProposalService?.clear({ deviceId, sessionId: DEFAULT_SESSION_ID });
      const otherProposalKindActive = deps.goalProposalService
        ? Boolean(await deps.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))
        : false;
      const reply = renderMealNumericProposalCopy({
        mealLabel: currentFacts.mealLabel,
        affectedFields: proposal.affectedFields,
        otherProposalKindActive,
      });
      return {
        ok: true,
        result: {
          ...makeMealNumericControlledResult("meal_numeric_proposal", reply),
          reason: "meal_numeric_proposal",
          proposalCard: buildMealNumericProposalCard({
            proposalId: proposal.proposalId,
            proposalKind: "meal_estimate",
            affectedFields: proposal.affectedFields,
            expiresAt: proposal.expiresAt,
          }),
        },
        toolMessage: reply,
      };
    } catch (error) {
      if (error instanceof MealRevisionPreconditionError) {
        throw revisionPreconditionFatalError(error);
      }
      throw error;
    }
  },
};

const deleteMealContract: ToolContract<DeleteMealArgs, DeleteMealContractResult> = {
  name: "delete_meal",
  policyClass: "confirm-first",
  policyRules: [
    {
      id: "delete_meal_setup_only",
      decision: "allowed",
      description: "Writes pending delete proposal authority but does not mutate meals.",
    },
    {
      id: "delete_meal_requires_resolved_target",
      decision: "blocked",
      description: "Delete proposal setup requires a same-turn resolved target before writing pending helper state.",
    },
    {
      id: "delete_meal_revision_precondition_guard",
      decision: "blocked",
      description: "Delete proposal setup requires the resolved target revision to remain current.",
    },
  ],
  policyGate: () => ({
    allowed: true,
    fact: {
      tool: "delete_meal",
      policyClass: "confirm-first",
      decision: "allowed",
      ruleId: "delete_meal_setup_only",
    },
  }),
  description: "建立一組待確認的歷史餐點刪除提案，不會刪除餐點。只有在本輪已先透過 find_meals 解析出唯一目標後才可呼叫。",
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
    if (!deps?.mealCorrectionService || !deps.mealDeleteProposalService || !deviceId) {
      throw new Error("delete_meal contract missing mealCorrectionService/mealDeleteProposalService/deviceId in context");
    }

    const resolvedTarget = findResolvedMealTarget(deps.toolSessionState, args.meal_id);
    if (!resolvedTarget) {
      throw new FatalToolError("meal target unresolved");
    }

    try {
      const currentFacts = await deps.mealCorrectionService.loadCurrentMealFacts(
        deviceId,
        args.meal_id,
        resolvedTarget.mealRevisionId,
      );
      const snapshot = {
        mealId: currentFacts.mealId,
        expectedMealRevisionId: currentFacts.currentMealRevisionId,
        mealLabel: currentFacts.mealLabel,
        calories: currentFacts.totals.calories,
        protein: currentFacts.totals.protein,
        carbs: currentFacts.totals.carbs,
        fat: currentFacts.totals.fat,
        dateKey: currentFacts.dateKey,
        loggedAt: currentFacts.loggedAt,
        mealPeriod: currentFacts.mealPeriod,
        ...(currentFacts.items.length > 1
          ? {
              items: currentFacts.items.map((item) => ({
                foodName: item.foodName,
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
              })),
            }
          : {}),
      };
      const proposal = await deps.mealDeleteProposalService.putLatest({
        deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: currentFacts.mealId,
          expectedMealRevisionId: currentFacts.currentMealRevisionId,
          snapshot,
        },
      });
      await deps.mealNumericProposalService?.clear({ deviceId, sessionId: DEFAULT_SESSION_ID });
      const otherProposalKindActive = deps.goalProposalService
        ? Boolean(await deps.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))
        : false;
      const reply = renderMealDeleteProposalCopy({
        snapshot: proposal.snapshot,
        otherProposalKindActive,
      });
      return {
        ok: true,
        result: makeMealDeleteProposalResult({
          proposalId: proposal.proposalId,
          reply,
          snapshot: proposal.snapshot,
          expiresAt: proposal.expiresAt,
        }),
        toolMessage: reply,
      };
    } catch (error) {
      if (error instanceof MealRevisionPreconditionError) {
        const recovery = await deps.mealCorrectionService.recoverStalePendingSelection?.({
          deviceId,
          sessionId: DEFAULT_SESSION_ID,
          action: "delete",
        });
        if (recovery) {
          const reply = renderFindMealsControlledReply(recovery);
          return {
            ok: true,
            result: makeMealTargetControlledResult(reply),
            toolMessage: reply,
          };
        }
        throw revisionPreconditionFatalError(error);
      }
      throw error;
    }
  },
};

const proposeGoalsContract: ToolContract<DailyTargets, ProposeGoalsResult> = {
  name: "propose_goals",
  policyClass: "confirm-first",
  policyRules: [
    {
      id: "propose_goals_setup_only",
      decision: "allowed",
      description: "Writes pending proposal authority but does not mutate device goals.",
    },
  ],
  description:
    "建立一組待確認的每日營養目標提案，不會更新使用者目標。必須提供完整 calories/protein/carbs/fat 數字；使用者確認後才可由 update_goals 套用。",
  parameters: {
    type: "object",
    additionalProperties: false,
    ...goalToolProperties(true),
  },
  zodSchema: proposeGoalsSchema,
  logSummary: () => ({
    tool: "propose_goals",
    fields: ["calories", "protein", "carbs", "fat"],
    status: "proposal",
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.goalProposalService || !deviceId) {
      throw new Error("propose_goals contract missing goalProposalService/deviceId in context");
    }

    const proposal = await deps.goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: args,
    });
    const reply = renderGoalProposalCopy(args);

    return {
      ok: true,
      result: {
        ...makeGoalControlledResult("goal_proposal", reply),
        reason: "goal_proposal",
        proposalCard: buildGoalProposalCard(proposal),
      },
      toolMessage: reply,
    };
  },
};

const updateGoalsContract: ToolContract<UpdateGoalsArgs, UpdateGoalsContractResult> = {
  name: "update_goals",
  policyClass: "direct-execute",
  policyRules: [
    {
      id: "update_goals_current_turn_source_guard",
      decision: "blocked",
      description: "Current-turn target updates require source-text evidence for numeric fields.",
    },
    {
      id: "update_goals_latest_proposal_confirm_first",
      decision: "blocked",
      description: "Latest-proposal commits escalate to confirm-first proposal authorization.",
    },
    {
      id: "update_goals_latest_proposal_cancel",
      decision: "allowed",
      description: "Latest-proposal cancellation may clear pending proposal state without committing goals.",
    },
  ],
  description:
    "更新使用者每日營養目標。必須提供 mode：current_turn_values 只用目前使用者訊息中的具體數字；latest_proposal 只套用目前有效的後端目標提案且需要使用者明確同意。空參數或沒有 mode 都無效。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["current_turn_values", "latest_proposal"] },
      ...goalTargetProperties.properties,
    },
    required: ["mode"],
  },
  zodSchema: updateGoalsSchema,
  logSummary: (args) => ({
    tool: "update_goals",
    mode: args.mode,
    updatedFields: updatedGoalFields(args),
  }),
  policyGate: async (args, context) => {
    if (args.mode === "current_turn_values") {
      return {
        allowed: true,
        fact: {
          tool: "update_goals",
          policyClass: "direct-execute",
          decision: "allowed",
          ruleId: "update_goals_current_turn_source_guard",
        },
      };
    }

    if (isGoalProposalCancel(context.currentUserMessage)) {
      return {
        allowed: true,
        fact: {
          tool: "update_goals",
          policyClass: "direct-execute",
          decision: "allowed",
          ruleId: "update_goals_latest_proposal_cancel",
        },
      };
    }

    const overridePatch = pickTargetPatch(args);
    const overrideFields = updatedGoalFields(overridePatch);
    if (overrideFields.length > 0) {
      const guardResult = checkSourceFields(overridePatch as Record<string, unknown>, overrideFields, {
        currentUserMessage: context.currentUserMessage,
      });
      if (!guardResult.ok) {
        return {
          allowed: false,
          fact: {
            tool: "update_goals",
            policyClass: "direct-execute",
            decision: "blocked",
            ruleId: "update_goals_current_turn_source_guard",
          },
        };
      }
    }

    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.goalProposalService || !deviceId || !isGoalProposalConsent(context.currentUserMessage)) {
      return {
        allowed: false,
        fact: {
          tool: "update_goals",
          policyClass: "direct-execute",
          decision: "blocked",
          ruleId: "update_goals_latest_proposal_confirm_first",
        },
      };
    }

    const activeProposal = await deps.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    });
    if (!activeProposal) {
      return {
        allowed: false,
        fact: {
          tool: "update_goals",
          policyClass: "direct-execute",
          decision: "blocked",
          ruleId: "update_goals_latest_proposal_confirm_first",
        },
      };
    }

    const consumedProposal = await deps.goalProposalService.consumeLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      proposalId: activeProposal.proposalId,
    });
    if (!consumedProposal) {
      return {
        allowed: false,
        fact: {
          tool: "update_goals",
          policyClass: "direct-execute",
          decision: "blocked",
          ruleId: "update_goals_latest_proposal_confirm_first",
          proposalId: activeProposal.proposalId,
        },
      };
    }

    context.policyAuthorization = {
      ...context.policyAuthorization,
      updateGoalsLatestProposal: {
        proposalId: consumedProposal.proposalId,
        proposal: consumedProposal,
      } satisfies GoalProposalPolicyAuthorization,
    };

    return {
      allowed: true,
      fact: {
        tool: "update_goals",
        policyClass: "direct-execute",
        decision: "allowed",
        ruleId: "update_goals_latest_proposal_confirm_first",
        proposalId: consumedProposal.proposalId,
      },
    };
  },
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.deviceService || !deps.goalProposalService || !deps.publisher || !deviceId) {
      throw new Error("update_goals contract missing deviceService/goalProposalService/publisher/deviceId in context");
    }

    if (args.mode === "latest_proposal" && isGoalProposalCancel(context.currentUserMessage)) {
      await deps.goalProposalService.clear({ deviceId, sessionId: DEFAULT_SESSION_ID });
      const reply = renderGoalCancelCopy();
      return {
        ok: true,
        result: makeGoalControlledResult("goal_cancel", reply),
        toolMessage: reply,
      };
    }

    const overridePatch = pickTargetPatch(args);
    const overrideFields = updatedGoalFields(overridePatch);
    if (overrideFields.length > 0) {
      const guardResult = checkSourceFields(overridePatch as Record<string, unknown>, overrideFields, {
        currentUserMessage: context.currentUserMessage,
      });
      if (!guardResult.ok) {
        const reply = renderGoalAuthorityFailureCopy();
        return {
          ok: true,
          result: makeGoalControlledResult("goal_authority_failure", reply),
          toolMessage: reply,
        };
      }
    }

    let updatePatch: Partial<DailyTargets>;
    if (args.mode === "current_turn_values") {
      updatePatch = overridePatch;
    } else {
      const authorization = context.policyAuthorization?.updateGoalsLatestProposal as
        | GoalProposalPolicyAuthorization
        | undefined;
      if (!authorization) {
        const reply = renderGoalAuthorityFailureCopy();
        return {
          ok: true,
          result: makeGoalControlledResult("goal_authority_failure", reply),
          toolMessage: reply,
        };
      }
      updatePatch = {
        ...authorization.proposal.targets,
        ...overridePatch,
      };
    }

    const updatedFields = updatedGoalFields(updatePatch);
    const targets = await deps.deviceService.updateGoals(deviceId, updatePatch);
    if (args.mode === "current_turn_values") {
      try {
        await deps.goalProposalService.clear({ deviceId, sessionId: DEFAULT_SESSION_ID });
      } catch {
        // Targets are already committed; cleanup failure must not alter the user-visible outcome.
      }
    }

    let publishedEvents: Array<"goals_update"> = [];
    try {
      deps.publisher.publishGoalsUpdate(deviceId, targets);
      publishedEvents = ["goals_update"];
    } catch {
      // SSE fan-out is a post-commit side effect; keep the committed receipt authoritative.
    }

    return {
      ok: true,
      result: {
        targets,
        updatedFields,
        publishedEvents,
      },
      toolMessage: formatGoalsReceipt(targets),
    };
  },
};

// ---------------------------------------------------------------------------
// Registry (D-02). Single source of truth.
// ---------------------------------------------------------------------------

export const KNOWN_TOOL_NAMES = [
  "log_food",
  "get_daily_summary",
  "plan_next_meal",
  "find_meals",
  "propose_goals",
  "update_goals",
  "propose_meal_estimate",
  "propose_meal_numeric_correction",
  "update_meal",
  "delete_meal",
] as const;

export type KnownToolName = (typeof KNOWN_TOOL_NAMES)[number];

export const KNOWN_TOOL_POLICY_CLASSES = {
  log_food: "execute-and-report",
  get_daily_summary: "direct-execute",
  plan_next_meal: "direct-execute",
  find_meals: "clarify-first",
  propose_goals: "confirm-first",
  update_goals: "direct-execute",
  propose_meal_estimate: "confirm-first",
  propose_meal_numeric_correction: "confirm-first",
  update_meal: "direct-execute",
  delete_meal: "confirm-first",
} satisfies Record<KnownToolName, SideEffectPolicyClass>;

export const toolRegistry: Map<string, ToolContract<any, any>> = new Map([
  [logFoodContract.name, logFoodContract as ToolContract<any, any>],
  [findMealsContract.name, findMealsContract as ToolContract<any, any>],
  [updateMealContract.name, updateMealContract as ToolContract<any, any>],
  [deleteMealContract.name, deleteMealContract as ToolContract<any, any>],
  [getDailySummaryContract.name, getDailySummaryContract as ToolContract<any, any>],
  [planNextMealContract.name, planNextMealContract as ToolContract<any, any>],
  [proposeMealEstimateContract.name, proposeMealEstimateContract as ToolContract<any, any>],
  [proposeMealNumericCorrectionContract.name, proposeMealNumericCorrectionContract as ToolContract<any, any>],
  [proposeGoalsContract.name, proposeGoalsContract as ToolContract<any, any>],
  [updateGoalsContract.name, updateGoalsContract as ToolContract<any, any>],
]);

export function assertRegistryPolicies(
  registry: ReadonlyMap<string, ToolContract<any, any>>,
  expectedPolicyClasses: Record<string, SideEffectPolicyClass>,
): void {
  for (const [toolName, contract] of registry.entries()) {
    const expectedClass = expectedPolicyClasses[toolName];
    if (!expectedClass) {
      throw new Error(`Unknown registered tool policy: ${toolName}`);
    }
    if (!contract.policyClass) {
      throw new Error(`Missing side-effect policy for registered tool: ${toolName}`);
    }
    if (contract.policyClass !== expectedClass) {
      throw new Error(
        `Side-effect policy mismatch for ${toolName}: expected ${expectedClass}, got ${contract.policyClass}`,
      );
    }
  }

  for (const toolName of Object.keys(expectedPolicyClasses)) {
    if (!registry.has(toolName)) {
      throw new Error(`Missing registered tool for side-effect policy: ${toolName}`);
    }
  }

  if (registry.size !== Object.keys(expectedPolicyClasses).length) {
    throw new Error("Registered tool count does not match side-effect policy table");
  }
}

assertRegistryPolicies(toolRegistry, KNOWN_TOOL_POLICY_CLASSES);

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
    if (toolName === "plan_next_meal") {
      return "<plan_next_meal args>";
    }
    if (toolName === "find_meals") {
      return `action: ${summary.action ?? "unknown"}`;
    }
    if (toolName === "update_meal") {
      return `itemCount: ${summary.itemCount ?? "?"}`;
    }
    if (toolName === "propose_meal_numeric_correction") {
      const fields = Array.isArray(summary.fields)
        ? summary.fields.join(",")
        : "";
      const operator = typeof summary.operator === "string" ? summary.operator : "unknown";
      return `fields: ${fields}; operator: ${operator}`;
    }
    if (toolName === "propose_meal_estimate") {
      const fields = Array.isArray(summary.fields)
        ? summary.fields.join(",")
        : "";
      return `fields: ${fields}`;
    }
    if (toolName === "delete_meal") {
      return "<delete_meal args>";
    }
    if (toolName === "propose_goals") {
      return "fields: calories,protein,carbs,fat";
    }
    if (toolName === "update_goals") {
      const fields = Array.isArray(summary.updatedFields)
        ? summary.updatedFields.join(",")
        : "";
      const mode = typeof summary.mode === "string" ? summary.mode : "unknown";
      return `mode: ${mode}; updatedFields: ${fields}`;
    }
    return `<${toolName} args>`;
  }
  return `<${toolName} args>`;
}

function parseFailureFields(result: string): string[] {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    return Array.isArray(parsed.fields) && parsed.fields.every((field) => typeof field === "string")
      ? parsed.fields as string[]
      : [];
  } catch {
    return [];
  }
}

function goalValidationFieldsFromFailure(result: string): UpdateGoalField[] {
  const goalFields = new Set<UpdateGoalField>(["calories", "protein", "carbs", "fat"]);
  const fields = parseFailureFields(result)
    .map((field) => field.split(".").at(-1) ?? field)
    .filter((field): field is UpdateGoalField => goalFields.has(field as UpdateGoalField));
  return [...new Set(fields)];
}

function dateKeyFromNoMealsPrompt(prompt: string): string | undefined {
  const match = prompt.match(/(\d{4}-\d{2}-\d{2})\s+沒有記錄餐點/);
  return match?.[1];
}

function renderFindMealsControlledReply(result: Exclude<FindMealsResult, { status: "resolved" }>): string {
  const noMealsDateKey = dateKeyFromNoMealsPrompt(result.prompt);
  if (noMealsDateKey) {
    return renderCorrectionTargetNoMealsForDateCopy({
      action: result.action,
      dateKey: noMealsDateKey,
    });
  }

  if (result.status === "needs_clarification" && result.candidates.length > 0) {
    const candidateDateKeys = new Set(result.candidates.map((candidate) => candidate.dateKey));
    if (candidateDateKeys.size === 1) {
      const [dateKey] = candidateDateKeys;
      if (dateKey) {
        return renderCorrectionTargetSameDateRecoveryCopy({
          action: result.action,
          dateKey,
          candidates: result.candidates,
        });
      }
    }

    return renderCorrectionTargetClarificationCopy({
      action: result.action,
      candidates: result.candidates,
    });
  }

  return result.prompt;
}

function formatClarificationTime(loggedAt: string): string {
  const local = new Date(loggedAt);
  const hour = `${local.getHours()}`.padStart(2, "0");
  const minute = `${local.getMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

function projectMealTargetCandidateFact(
  candidate: MealCorrectionCandidate,
  index: number,
): ToolMealTargetCandidateFact {
  return {
    optionNumber: index + 1,
    dateKey: candidate.dateKey,
    displayTime: formatClarificationTime(candidate.loggedAt),
    displayLabel: candidate.foodName,
    ...(candidate.mealPeriodSource === "explicit"
      ? {
          mealPeriod: candidate.mealPeriod,
          mealPeriodSource: "explicit" as const,
        }
      : {}),
  };
}

function buildMealTargetClarificationFact(
  result: Exclude<FindMealsResult, { status: "resolved" }>,
  prompt: string,
): ToolClarificationFact {
  return {
    kind: "meal_target",
    status: result.status,
    action: result.action,
    prompt,
    candidates: result.status === "needs_clarification"
      ? result.candidates.slice(0, 5).map(projectMealTargetCandidateFact)
      : [],
  };
}

function buildHistoricalLogClarificationFact(
  clarification: HistoricalToolClarification,
  prompt: string,
): ToolClarificationFact {
  return {
    kind: "historical_log",
    status: "needs_clarification",
    prompt,
    reason: clarification.reason,
  };
}

function buildHistoricalSummaryClarificationFact(
  summary: Exclude<GetDailySummaryResult, { status: "summary" }>,
  prompt?: string,
): ToolClarificationFact {
  if (summary.status === "multiple_targets") {
    return {
      kind: "historical_summary",
      status: "multiple_targets",
      dateKeys: [...summary.dateKeys],
    };
  }

  return {
    kind: "historical_summary",
    status: "needs_clarification",
    prompt: prompt ?? summary.prompt,
    reason: summary.reason,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator-facing dispatch (registry-first per D-03). Adapts the
// controlled `runContract` result back to the legacy `ToolExecutionResult`
// shape expected by `server/orchestrator/index.ts` (Phase 8 hooks + Phase 9
// dailySummary contract). Validation failures for find_meals / update_goals /
// update_meal / delete_meal — and, since Phase 83, log_food schema_validation
// failures — return controlled failures (`success:false, executed:false`) so
// the orchestrator feeds the error back to the model for retry within
// MAX_ROUNDS. log_food `invalid_json` (unparseable args), execute failures,
// and get_daily_summary non-success outcomes are still surfaced as
// `FatalToolError` so the route-level fallback path stays intact.
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
  const attachPolicyFact = <T extends Omit<ToolExecutionResult, "policyFact">>(result: T): T & {
    policyFact?: ToolPolicyDecisionFact;
  } => {
    if (!outcome.policyFact) {
      return result;
    }
    return {
      ...result,
      policyFact: outcome.policyFact,
    };
  };

  if (!outcome.success) {
    if (
      toolCall.function.name === "log_food"
      && deps.imagePath
      && isMissingTrustedProteinBasisFailure(outcome)
    ) {
      return attachPolicyFact({
        result: outcome.result,
        summary: "failureReason: execute",
        success: false,
        executed: false,
        failureReason: outcome.failureReason,
      });
    }

    // Phase 83 (D-02): log_food schema_validation failures return a controlled
    // failure so the model can retry (e.g. with grouped items[]) within
    // MAX_ROUNDS. Keyed on the generic failure reason only — no legacy-shape
    // detection (D-01). `invalid_json` and execute failures fall through to the
    // FatalToolError conversion below (route UNIFIED_FALLBACK unchanged).
    if (
      toolCall.function.name === "log_food"
      && outcome.failureReason === "validation"
    ) {
      let failureKind: string | undefined;
      let failureFields: string[] | undefined;
      try {
        const parsed = JSON.parse(outcome.result) as Record<string, unknown>;
        if (typeof parsed.reason === "string") {
          failureKind = parsed.reason;
        }
        if (
          Array.isArray(parsed.fields)
          && parsed.fields.every((field) => typeof field === "string")
        ) {
          failureFields = parsed.fields as string[];
        }
      } catch {
        // result was not JSON; fall through to the FatalToolError conversion
      }
      if (failureKind === "schema_validation") {
        return attachPolicyFact({
          result: outcome.result,
          summary: `failureReason: ${outcome.failureReason ?? "validation"}`,
          success: false,
          executed: false,
          failureReason: outcome.failureReason,
          validationDiagnostic: {
            reason: failureKind,
            ...(failureFields ? { fields: failureFields } : {}),
          },
        });
      }
    }

    if (
      toolCall.function.name === "find_meals"
      || toolCall.function.name === "update_goals"
      || toolCall.function.name === "update_meal"
      || toolCall.function.name === "delete_meal"
      || toolCall.function.name === "propose_meal_estimate"
    ) {
      if (
        toolCall.function.name === "propose_meal_estimate"
        && outcome.failureReason === "validation"
      ) {
        let failureKind = "schema_validation";
        let failureFields: string[] | undefined;
        try {
          const parsed = JSON.parse(outcome.result) as Record<string, unknown>;
          if (typeof parsed.reason === "string") {
            failureKind = parsed.reason;
          }
          if (
            Array.isArray(parsed.fields)
            && parsed.fields.every((field) => typeof field === "string")
          ) {
            failureFields = parsed.fields as string[];
          }
        } catch {
          // Keep the stable schema_validation default below.
        }
        return attachPolicyFact({
          result: outcome.result,
          summary: `failureReason: ${outcome.failureReason}`,
          success: false,
          executed: false,
          failureReason: outcome.failureReason,
          validationDiagnostic: {
            reason: failureKind,
            ...(failureFields ? { fields: failureFields } : {}),
          },
        });
      }
      const updatedFields =
        typeof outcome.logSummary === "object" &&
        outcome.logSummary !== null &&
        Array.isArray(outcome.logSummary.updatedFields)
          ? (outcome.logSummary.updatedFields as string[])
          : undefined;
      if (toolCall.function.name === "update_goals") {
        const validationFields = outcome.failureReason === "validation"
          ? goalValidationFieldsFromFailure(outcome.result)
          : [];
        const hasValidationFields = validationFields.length > 0;
        const reply = hasValidationFields
          ? renderGoalValidationFailureCopy(validationFields)
          : renderGoalAuthorityFailureCopy();
        return attachPolicyFact({
          result: reply,
          summary: `failureReason: ${outcome.failureReason ?? "validation"}`,
          success: false,
          executed: false,
          failureReason: outcome.failureReason,
          updatedFields,
          controlledReply: {
            source: "renderer",
            reason: hasValidationFields ? "goal_validation_failure" : "goal_authority_failure",
            text: reply,
          },
        });
      }
      return attachPolicyFact({
        result: outcome.result,
        summary: `failureReason: ${outcome.failureReason ?? "validation"}`,
        success: false,
        executed: false,
        failureReason: outcome.failureReason,
        updatedFields,
      });
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
        ...(outcome.policyFact ? { policyFact: outcome.policyFact } : {}),
      };
    } catch {
      diagnostic = outcome.failureReason || outcome.policyFact
        ? {
            ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
            ...(outcome.policyFact ? { policyFact: outcome.policyFact } : {}),
          }
        : undefined;
    }
    throw new FatalToolError(failureMessage, { diagnostic });
  }

  // Map contract-level success result back to ToolExecutionResult.
  if (toolCall.function.name === "log_food") {
    const contractResult = outcome.contractResult as LogFoodResult;
    if (contractResult.status === "failed_recognition_no_save") {
      return attachPolicyFact({
        result: FAILED_RECOGNITION_NO_SAVE_REPLY,
        summary: "failureReason: failed_recognition_no_save",
        success: false,
        executed: false,
        failureReason: "guard",
        controlledReply: {
          source: "renderer",
          reason: "failed_recognition_no_save",
          text: FAILED_RECOGNITION_NO_SAVE_REPLY,
        },
      });
    }
    if (contractResult.status === "text_non_food_no_save") {
      return attachPolicyFact({
        result: TEXT_NON_FOOD_NO_SAVE_REPLY,
        summary: "failureReason: text_non_food_no_save",
        success: false,
        executed: false,
        failureReason: "guard",
        controlledReply: {
          source: "renderer",
          reason: "text_non_food_no_save",
          text: TEXT_NON_FOOD_NO_SAVE_REPLY,
        },
      });
    }
    if (contractResult.status === "recent_correction_reestimate_proposal") {
      return attachPolicyFact({
        result: contractResult.reply,
        summary: "status: proposal",
        success: true,
        executed: true,
        proposalCard: contractResult.proposalCard,
        controlledReply: {
          source: "renderer",
          reason: contractResult.reason,
          text: contractResult.reply,
        },
      });
    }
    if (contractResult.status === "recent_correction_reestimate_no_change") {
      return attachPolicyFact({
        result: contractResult.reply,
        summary: "failureReason: guard",
        success: false,
        executed: false,
        failureReason: "guard",
        controlledReply: {
          source: "renderer",
          reason: contractResult.reason,
          text: contractResult.reply,
        },
      });
    }
    if (contractResult.status === "needs_clarification") {
      const reply = renderHistoricalLogFoodClarificationCopy({
        prompt: contractResult.prompt,
      });
      return attachPolicyFact({
        result: reply,
        summary: "status: needs_clarification",
        success: false,
        executed: false,
        failureReason: "guard",
        clarification: buildHistoricalLogClarificationFact(contractResult, reply),
        controlledReply: {
          source: "renderer",
          reason: "historical_date_clarification",
          text: reply,
        },
      });
    }
    return attachPolicyFact({
      result: outcome.result,
      summary: "成功",
      mealMutationKind: "log",
      dailySummary: contractResult.dailySummary,
      summaryOutcome: contractResult.summaryOutcome,
      affectedDate: contractResult.affectedDate,
      loggedMeal: contractResult.loggedMeal,
    });
  }

  if (toolCall.function.name === "find_meals") {
    const contractResult = outcome.contractResult as FindMealsResult;
    if (contractResult.status !== "resolved") {
      const reply = renderFindMealsControlledReply(contractResult);
      return attachPolicyFact({
        result: reply,
        summary: `status: ${contractResult.status}`,
        success: false,
        executed: false,
        failureReason: "guard",
        clarification: buildMealTargetClarificationFact(contractResult, reply),
        controlledReply: {
          source: "renderer",
          reason: "meal_target_clarification",
          text: reply,
        },
      });
    }

    return attachPolicyFact({
      result: outcome.result,
      summary: `status: ${contractResult.status}`,
    });
  }

  if (toolCall.function.name === "update_meal") {
    const contractResult = outcome.contractResult as UpdateMealContractResult;
    if (isMealControlledResult(contractResult)) {
      return attachPolicyFact({
        result: contractResult.reply,
        summary: "failureReason: guard",
        success: false,
        executed: false,
        failureReason: "guard",
        controlledReply: {
          source: "renderer",
          reason: contractResult.reason,
          text: contractResult.reply,
        },
      });
    }
    return attachPolicyFact({
      result: outcome.result,
      summary: "成功",
      mealMutationKind: "update",
      dailySummary: contractResult.dailySummary,
      summaryOutcome: contractResult.summaryOutcome,
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
    });
  }

  if (toolCall.function.name === "delete_meal") {
    const contractResult = outcome.contractResult as DeleteMealContractResult;
    if ("status" in contractResult && contractResult.status === "meal_delete_proposal") {
      return attachPolicyFact({
        result: contractResult.reply,
        summary: "status: proposal",
        success: true,
        executed: false,
        proposalCard: buildMealDeleteProposalCard({
          proposalId: contractResult.proposalId,
          expiresAt: contractResult.expiresAt,
          snapshot: contractResult.snapshot,
        }),
        controlledReply: {
          source: "renderer",
          reason: contractResult.reason,
          text: contractResult.reply,
        },
      });
    }
    if (isMealControlledResult(contractResult)) {
      return attachPolicyFact({
        result: contractResult.reply,
        summary: "failureReason: guard",
        success: false,
        executed: false,
        failureReason: "guard",
        controlledReply: {
          source: "renderer",
          reason: contractResult.reason,
          text: contractResult.reply,
        },
      });
    }
    return attachPolicyFact({
      result: outcome.result,
      summary: "成功",
      mealMutationKind: "delete",
      dailySummary: contractResult.dailySummary,
      summaryOutcome: contractResult.summaryOutcome,
      affectedDate: contractResult.affectedDate,
      deletedMeal: contractResult.deletedMeal,
    });
  }

  if (toolCall.function.name === "get_daily_summary") {
    const summary = outcome.contractResult as GetDailySummaryResult;
    if (summary.status === "needs_clarification") {
      const reply = renderHistoricalSummaryClarificationCopy({
        prompt: summary.prompt,
      });
      return attachPolicyFact({
        result: reply,
        summary: "status: needs_clarification",
        success: false,
        executed: false,
        failureReason: "guard",
        clarification: buildHistoricalSummaryClarificationFact(summary, reply),
        controlledReply: {
          source: "renderer",
          reason: "historical_summary_clarification",
          text: reply,
        },
      });
    }
    if (summary.status === "multiple_targets") {
      const reply = renderHistoricalSummaryMultipleTargetsCopy({
        dateKeys: summary.dateKeys,
      });
      return attachPolicyFact({
        result: reply,
        summary: "status: multiple_targets",
        success: false,
        executed: false,
        failureReason: "guard",
        clarification: buildHistoricalSummaryClarificationFact(summary),
        controlledReply: {
          source: "renderer",
          reason: "historical_summary_clarification",
          text: reply,
        },
      });
    }
    return attachPolicyFact({
      result: outcome.result,
      summary: `熱量 ${summary.dailySummary.totalCalories}kcal, P${summary.dailySummary.totalProtein}g, C${summary.dailySummary.totalCarbs}g, F${summary.dailySummary.totalFat}g`,
      dailySummary: summary.dailySummary,
      summaryHistoryFacts: {
        dailySummary: summary.dailySummary,
        meals: summary.meals,
      },
      affectedDate: summary.affectedDate,
    });
  }

  if (toolCall.function.name === "plan_next_meal") {
    const contractResult = outcome.contractResult as PlanNextMealResult;
    return attachPolicyFact({
      result: outcome.result,
      summary: "status: planning",
      success: true,
      executed: true,
      planningFacts: contractResult.planningFacts,
    });
  }

  if (toolCall.function.name === "propose_goals") {
    const contractResult = outcome.contractResult as ProposeGoalsResult;
    return attachPolicyFact({
      result: contractResult.reply,
      summary: "status: proposal",
      success: true,
      executed: true,
      proposalCard: contractResult.proposalCard,
      controlledReply: {
        source: "renderer",
        reason: contractResult.reason,
        text: contractResult.reply,
      },
    });
  }

  if (toolCall.function.name === "propose_meal_numeric_correction") {
    const contractResult = outcome.contractResult as ProposeMealNumericCorrectionResult;
    const isProposal = contractResult.reason === "meal_numeric_proposal";
    return attachPolicyFact({
      result: contractResult.reply,
      summary: isProposal ? "status: proposal" : "failureReason: guard",
      success: isProposal,
      executed: isProposal,
      ...(isProposal ? {} : { failureReason: "guard" as const }),
      ...(contractResult.proposalCard ? { proposalCard: contractResult.proposalCard } : {}),
      controlledReply: {
        source: "renderer",
        reason: contractResult.reason,
        text: contractResult.reply,
      },
    });
  }

  if (toolCall.function.name === "propose_meal_estimate") {
    const contractResult = outcome.contractResult as ProposeMealNumericCorrectionResult;
    const isProposal = contractResult.reason === "meal_numeric_proposal";
    return attachPolicyFact({
      result: contractResult.reply,
      summary: isProposal ? "status: proposal" : "failureReason: guard",
      success: isProposal,
      executed: isProposal,
      ...(isProposal ? {} : { failureReason: "guard" as const }),
      ...(contractResult.proposalCard ? { proposalCard: contractResult.proposalCard } : {}),
      controlledReply: {
        source: "renderer",
        reason: contractResult.reason,
        text: contractResult.reply,
      },
    });
  }

  if (toolCall.function.name === "update_goals") {
    const contractResult = outcome.contractResult as UpdateGoalsContractResult;
    if (isGoalControlledResult(contractResult)) {
      const failureReason = contractResult.reason === "goal_validation_failure"
        ? "validation"
        : "guard";
      return attachPolicyFact({
        result: contractResult.reply,
        summary: `failureReason: ${failureReason}`,
        success: false,
        executed: false,
        failureReason,
        updatedFields:
          typeof outcome.logSummary === "object" &&
          outcome.logSummary !== null &&
          Array.isArray(outcome.logSummary.updatedFields)
            ? [...(outcome.logSummary.updatedFields as UpdateGoalField[])]
            : undefined,
        controlledReply: {
          source: "renderer",
          reason: contractResult.reason,
          text: contractResult.reply,
        },
      });
    }
    const updateResult = contractResult as UpdateGoalsResult;
    return attachPolicyFact({
      result: outcome.result,
      summary: `updatedFields: ${updateResult.updatedFields.join(",")}`,
      success: true,
      executed: true,
      updatedFields: [...updateResult.updatedFields],
      publishedEvents: [...(updateResult.publishedEvents ?? [])],
      dailyTargets: updateResult.targets,
    });
  }

  // Defensive: any contract added to the registry without a wrapper case here
  // returns the contract's toolMessage and an empty summary. Future tools
  // (e.g. update_goals in 10-03) are expected to call `runContract` directly.
  return attachPolicyFact({
    result: outcome.result,
    summary: "",
  });
}
