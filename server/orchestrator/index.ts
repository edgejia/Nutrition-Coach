import type { LLMProvider, ChatMessage } from "../llm/types.js";
import type { createChatService } from "../services/chat.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createDeviceService } from "../services/device.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { loadHistory } from "./history.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolDefinitions, executeTool, isFatalToolError } from "./tools.js";

export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

interface OrchestratorDeps {
  llmProvider: LLMProvider;
  chatService: ReturnType<typeof createChatService>;
  summaryService: ReturnType<typeof createSummaryService>;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  deviceService: ReturnType<typeof createDeviceService>;
  publisher: RealtimePublisher;
  logger?: Logger;
}

const FALLBACK = "抱歉，我現在無法完成這個請求，請稍後再試。";
const MAX_ROUNDS = 3;

function requireDailySummaryForLoggedMeal(dailySummary: DailySummary | undefined): DailySummary {
  if (!dailySummary) {
    throw new Error("log_food succeeded without dailySummary");
  }

  return dailySummary;
}

export function createOrchestrator(deps: OrchestratorDeps) {
  return {
    async handleMessage(
      deviceId: string,
      userMessage: string,
      imageBase64?: string,
      imagePath?: string
    ): Promise<{ reply: string; didLogMeal: boolean; dailySummary?: DailySummary }> {
      const { llmProvider, chatService, deviceService } = deps;

      // Load device info
      const device = await deviceService.getDevice(deviceId);
      if (!device) throw new Error("Device not found");

      // Load history BEFORE saving current user message to avoid duplication
      const history = await loadHistory(chatService, deviceId, 10);

      // Save user message after loading history
      await chatService.saveMessage(deviceId, "user", userMessage, { imagePath });
      deps.logger?.info(`[user] ${userMessage}${imageBase64 ? " [+image]" : ""}`);
      const systemMsg: ChatMessage = {
        role: "system",
        content: buildSystemPrompt(device.goal, {
          calories: device.dailyCalories,
          protein: device.dailyProtein,
          carbs: device.dailyCarbs,
          fat: device.dailyFat,
        }),
      };

      const userContent: ChatMessage = imageBase64
        ? {
            role: "user",
            content: [
              { type: "text", text: userMessage },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          }
        : { role: "user", content: userMessage };

      const messages: ChatMessage[] = [systemMsg, ...history, userContent];

      let didLogMeal = false;
      let logMealSummary: DailySummary | undefined;

      // The orchestrator may use tools in the first completion, then produce the
      // final assistant reply in a follow-up completion on the same model.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let response;
        try {
          response = await llmProvider.chat(messages, toolDefinitions);
        } catch (err) {
          deps.logger?.error(`LLM chat failed for device ${deviceId}:`, err);
          const errorMsg = "抱歉，目前無法處理您的請求，請稍後再試。";
          await chatService.saveMessage(deviceId, "assistant", errorMsg);
          return { reply: errorMsg, didLogMeal, dailySummary: logMealSummary };
        }

        if (response.content) {
          deps.logger?.info(`[assistant] ${response.content}`);
          await chatService.saveMessage(deviceId, "assistant", response.content);
          return { reply: response.content, didLogMeal, dailySummary: logMealSummary };
        }

        if (response.toolCalls) {
          for (const tc of response.toolCalls) {
            deps.logger?.info(`[tool_call] ${tc.function.name} ${tc.function.arguments}`);
          }
          const toolResults: Array<{ toolCall: typeof response.toolCalls[number]; result: string }> = [];
          for (const toolCall of response.toolCalls) {
            try {
              const { result, summary, dailySummary } = await executeTool(toolCall, deviceId, {
                foodLoggingService: deps.foodLoggingService,
                summaryService: deps.summaryService,
                publisher: deps.publisher,
                imagePath,
                logger: deps.logger,
              });
              if (toolCall.function.name === "log_food") {
                didLogMeal = true;
                logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
              }
              deps.logger?.info(`[tool_result] ${toolCall.function.name} → ${summary}`);
              await chatService.saveMessage(deviceId, "tool", summary, { toolName: toolCall.function.name });
              toolResults.push({ toolCall, result });
            } catch (err) {
              if (isFatalToolError(err)) {
                throw err;
              }

              const errorStr = err instanceof Error ? err.message : "Tool execution failed";
              deps.logger?.error(`Tool ${toolCall.function.name} failed for device ${deviceId}: ${errorStr}`, err);
              toolResults.push({ toolCall, result: `Error: ${errorStr}` });
            }
          }
          messages.push({ role: "assistant", content: null, tool_calls: response.toolCalls });
          for (const { toolCall, result } of toolResults) {
            messages.push({ role: "tool", content: result, tool_call_id: toolCall.id });
          }
        }
      }

      // Fallback after MAX_ROUNDS
      await chatService.saveMessage(deviceId, "assistant", FALLBACK);
      return { reply: FALLBACK, didLogMeal, dailySummary: logMealSummary };
    },
  };
}
