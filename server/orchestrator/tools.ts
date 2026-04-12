import type { ToolDefinition, ToolCall } from "../llm/types.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { Logger } from "./index.js";
import { currentAppDate } from "../lib/time.js";

export const toolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
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
    },
  },
  {
    type: "function",
    function: {
      name: "get_daily_summary",
      description: "查詢今日已攝取的營養素總量。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

export interface ToolDeps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  imagePath?: string;
  logger?: Logger;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function executeTool(
  toolCall: ToolCall,
  deviceId: string,
  deps: ToolDeps
): Promise<ToolExecutionResult> {
  const name = toolCall.function.name;
  let args: Record<string, unknown>;

  try {
    args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch (err) {
    if (name === "log_food") {
      throw new FatalToolError("Invalid log_food arguments", { cause: err });
    }
    throw err;
  }

  if (name === "log_food") {
    const foodName = args.food_name;
    const calories = args.calories;
    const protein = args.protein;
    const carbs = args.carbs;
    const fat = args.fat;
    if (
      typeof foodName !== "string" ||
      foodName.trim() === "" ||
      !isFiniteNumber(calories) ||
      !isFiniteNumber(protein) ||
      !isFiniteNumber(carbs) ||
      !isFiniteNumber(fat)
    ) {
      throw new FatalToolError("Invalid log_food arguments");
    }
    const normalizedFoodName = foodName.trim();

    // Main-path contract: the meal must be persisted AND the fresh daily summary
    // must be computed before log_food is treated as a successful logged meal.
    await deps.foodLoggingService.logFood(deviceId, {
      foodName: normalizedFoodName,
      calories,
      protein,
      carbs,
      fat,
      imagePath: deps.imagePath,
    });

    let dailySummary: DailySummary;
    try {
      dailySummary = await deps.summaryService.getDailySummary(deviceId, currentAppDate());
    } catch (err) {
      const message = err instanceof Error ? err.message : "log_food dailySummary recomputation failed";
      throw new FatalToolError(message, { cause: err });
    }

    return {
      result: "食物已成功記錄",
      summary: "成功",
      dailySummary,
      loggedMeal: {
        foodName: normalizedFoodName,
        calories,
        protein,
        carbs,
        fat,
      },
    };
  }

  if (name === "get_daily_summary") {
    const summary = await deps.summaryService.getDailySummary(deviceId, currentAppDate());
    const result = JSON.stringify(summary);
    return { result, summary: `熱量 ${summary.totalCalories}kcal, P${summary.totalProtein}g, C${summary.totalCarbs}g, F${summary.totalFat}g` };
  }

  throw new Error(`Unknown tool: ${name}`);
}
