import { z } from "zod";
import type { ToolDefinition, ToolCall } from "../llm/types.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import { currentAppDate } from "../lib/time.js";
import {
  runContract,
  type ToolContract,
  type RunContractContext,
} from "./tool-contract.js";

// ---------------------------------------------------------------------------
// Public types preserved for the orchestrator (Phase 8/9 callers).
// ---------------------------------------------------------------------------

export interface ToolDeps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  imagePath?: string;
}

export interface ToolExecutionResult {
  result: string;
  summary: string;
  dailySummary?: DailySummary;
  loggedMeal?: {
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

export class FatalToolError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "FatalToolError";
    this.cause = options?.cause;
  }
}

export function isFatalToolError(error: unknown): error is FatalToolError {
  return error instanceof FatalToolError;
}

// ---------------------------------------------------------------------------
// Contract-level types.
// ---------------------------------------------------------------------------

interface LogFoodArgs {
  food_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface LogFoodResult {
  dailySummary: DailySummary;
  loggedMeal: {
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

type GetDailySummaryArgs = Record<string, never>;
type GetDailySummaryResult = DailySummary;

const finiteNumber = z.number().refine(Number.isFinite, "must be finite");

const logFoodSchema = z
  .object({
    food_name: z.string().min(1, "food_name must be non-empty"),
    calories: finiteNumber,
    protein: finiteNumber,
    carbs: finiteNumber,
    fat: finiteNumber,
  })
  .strict();

const getDailySummarySchema = z.object({}).strict();

// ---------------------------------------------------------------------------
// Contracts. logSummary returns redacted shape (D-30); macros are part of
// existing Phase 8 behavior for log_food (intentional, see plan).
// ---------------------------------------------------------------------------

const logFoodContract: ToolContract<LogFoodArgs, LogFoodResult> = {
  name: "log_food",
  description: "將已分析的食物記錄到今日飲食中。",
  parameters: {
    type: "object",
    properties: {
      food_name: { type: "string" },
      calories: { type: "number" },
      protein: { type: "number" },
      carbs: { type: "number" },
      fat: { type: "number" },
    },
    required: ["food_name", "calories", "protein", "carbs", "fat"],
  },
  zodSchema: logFoodSchema,
  // No sourceFields per D-11: log_food calorie estimates need not appear in
  // user text; the assistant computes them.
  logSummary: (args) => ({
    tool: "log_food",
    calories: args.calories,
    protein: args.protein,
    carbs: args.carbs,
    fat: args.fat,
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps || !deviceId) {
      throw new Error("log_food contract missing toolDeps/deviceId in context");
    }
    const normalizedFoodName = args.food_name.trim();

    // Phase 8/9 invariant: persist the meal BEFORE recomputing the daily
    // summary so partial-success fallback paths still see the row in the DB.
    await deps.foodLoggingService.logFood(deviceId, {
      foodName: normalizedFoodName,
      calories: args.calories,
      protein: args.protein,
      carbs: args.carbs,
      fat: args.fat,
      imagePath: deps.imagePath,
    });

    let dailySummary: DailySummary;
    try {
      dailySummary = await deps.summaryService.getDailySummary(
        deviceId,
        currentAppDate(),
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "log_food dailySummary recomputation failed";
      throw new FatalToolError(message, { cause: err });
    }

    return {
      ok: true,
      result: {
        dailySummary,
        loggedMeal: {
          foodName: normalizedFoodName,
          calories: args.calories,
          protein: args.protein,
          carbs: args.carbs,
          fat: args.fat,
        },
      },
      toolMessage: "食物已成功記錄",
    };
  },
};

const getDailySummaryContract: ToolContract<
  GetDailySummaryArgs,
  GetDailySummaryResult
> = {
  name: "get_daily_summary",
  description: "查詢今日已攝取的營養素總量。",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  zodSchema: getDailySummarySchema,
  logSummary: () => ({ tool: "get_daily_summary" }),
  execute: async (_args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps || !deviceId) {
      throw new Error(
        "get_daily_summary contract missing toolDeps/deviceId in context",
      );
    }
    const summary = await deps.summaryService.getDailySummary(
      deviceId,
      currentAppDate(),
    );
    return {
      ok: true,
      result: summary,
      toolMessage: JSON.stringify(summary),
    };
  },
};

// ---------------------------------------------------------------------------
// Registry (D-02). Single source of truth.
// ---------------------------------------------------------------------------

export const toolRegistry: Map<string, ToolContract<any, any>> = new Map([
  [logFoodContract.name, logFoodContract as ToolContract<any, any>],
  [getDailySummaryContract.name, getDailySummaryContract as ToolContract<any, any>],
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
    throw new FatalToolError(failureMessage);
  }

  // Map contract-level success result back to ToolExecutionResult.
  if (toolCall.function.name === "log_food") {
    const contractResult = outcome.contractResult as LogFoodResult;
    return {
      result: outcome.result,
      summary: "成功",
      dailySummary: contractResult.dailySummary,
      loggedMeal: contractResult.loggedMeal,
    };
  }

  if (toolCall.function.name === "get_daily_summary") {
    const summary = outcome.contractResult as GetDailySummaryResult;
    return {
      result: outcome.result,
      summary: `熱量 ${summary.totalCalories}kcal, P${summary.totalProtein}g, C${summary.totalCarbs}g, F${summary.totalFat}g`,
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
