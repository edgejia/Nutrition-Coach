import type { ToolDefinition, ToolCall } from "../llm/types.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService } from "../services/summary.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
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
  publisher: RealtimePublisher;
  imagePath?: string;
}

export async function executeTool(
  toolCall: ToolCall,
  deviceId: string,
  deps: ToolDeps
): Promise<{ result: string; summary: string }> {
  const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  const name = toolCall.function.name;

  if (name === "log_food") {
    const foodName = String(args.food_name ?? "");
    const calories = Number(args.calories);
    const protein = Number(args.protein);
    const carbs = Number(args.carbs);
    const fat = Number(args.fat);
    if (!foodName || ![calories, protein, carbs, fat].every(Number.isFinite)) {
      throw new Error("Invalid log_food arguments");
    }

    await deps.foodLoggingService.logFood(deviceId, {
      foodName,
      calories,
      protein,
      carbs,
      fat,
      imagePath: deps.imagePath,
    });
    // Trigger SSE update
    const dailySummary = await deps.summaryService.getDailySummary(deviceId, currentAppDate());
    deps.publisher.publishDailySummary(deviceId, dailySummary);
    return { result: "食物已成功記錄", summary: "成功" };
  }

  if (name === "get_daily_summary") {
    const summary = await deps.summaryService.getDailySummary(deviceId, currentAppDate());
    const result = JSON.stringify(summary);
    return { result, summary: `熱量 ${summary.totalCalories}kcal, P${summary.totalProtein}g, C${summary.totalCarbs}g, F${summary.totalFat}g` };
  }

  throw new Error(`Unknown tool: ${name}`);
}
