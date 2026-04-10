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
const IMAGE_PLACEHOLDER = "(圖片)";
const CHOICE_PROMPT_PATTERN = /方式\s*1[\s\S]*方式\s*2|方式\s*2[\s\S]*方式\s*1/;
const CHOICE_CONFIRM_MESSAGES = new Set(["2", "方式2"]);
const HALLUCINATED_CHOICE_RECOVERY_REPLY = "這餐剛剛已先依目前估算完成記錄。若你想更精準，我可以再依份量幫你調整。";

export type OrchestratorResult =
  | { reply: string; didLogMeal: boolean; dailySummary?: DailySummary }
  | { streamGenerator: AsyncGenerator<string>; didLogMeal: boolean; dailySummary?: DailySummary };

function requireDailySummaryForLoggedMeal(dailySummary: DailySummary | undefined): DailySummary {
  if (!dailySummary) {
    throw new Error("log_food succeeded without dailySummary");
  }

  return dailySummary;
}

function formatCalories(calories: number): string {
  return Number.isInteger(calories) ? String(calories) : calories.toFixed(1).replace(/\.0$/, "");
}

function isImageOnlyMessage(userMessage: string, imageBase64?: string): boolean {
  return Boolean(imageBase64) && userMessage.trim() === IMAGE_PLACEHOLDER;
}

function buildImageLoggedReply(loggedMeal: { foodName: string; calories: number }): string {
  return `已先依照片做保守估算並完成記錄：${loggedMeal.foodName}，約 ${formatCalories(loggedMeal.calories)} kcal。若你想更精準，我可以再依份量幫你調整。`;
}

function detectHallucinatedChoiceFollowUp(
  userMessage: string,
  recentMessages: Array<{ role: string; content: string; didLogMeal?: boolean }>
): string | undefined {
  const trimmedMessage = userMessage.trim();
  if (!CHOICE_CONFIRM_MESSAGES.has(trimmedMessage)) {
    return undefined;
  }

  const lastAssistant = [...recentMessages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant?.didLogMeal) {
    return undefined;
  }

  if (!CHOICE_PROMPT_PATTERN.test(lastAssistant.content)) {
    return undefined;
  }

  return HALLUCINATED_CHOICE_RECOVERY_REPLY;
}

export interface HandleMessageOpts {
  onStatus?: (label: string) => void;
}

export function createOrchestrator(deps: OrchestratorDeps) {
  return {
    async handleMessage(
      deviceId: string,
      userMessage: string,
      imageBase64?: string,
      imagePath?: string,
      opts?: HandleMessageOpts
    ): Promise<OrchestratorResult> {
      const { llmProvider, chatService, deviceService } = deps;

      // Load device info
      const device = await deviceService.getDevice(deviceId);
      if (!device) throw new Error("Device not found");

      // Load history BEFORE saving current user message to avoid duplication
      const history = await loadHistory(chatService, deviceId, 10);
      const recentMessages = await chatService.getHistory(deviceId, 3);
      const hallucinatedChoiceRecovery = detectHallucinatedChoiceFollowUp(userMessage, recentMessages);

      // Save user message after loading history
      await chatService.saveMessage(deviceId, "user", userMessage, { imagePath });
      deps.logger?.info(`[user] ${userMessage}${imageBase64 ? " [+image]" : ""}`);
      if (hallucinatedChoiceRecovery) {
        deps.logger?.info(`[assistant] ${hallucinatedChoiceRecovery}`);
        return { reply: hallucinatedChoiceRecovery, didLogMeal: false };
      }
      const systemMsg: ChatMessage = {
        role: "system",
        content: buildSystemPrompt(
          device.goal,
          {
            calories: device.dailyCalories,
            protein: device.dailyProtein,
            carbs: device.dailyCarbs,
            fat: device.dailyFat,
          },
          {
            sex: device.sex,
            age: device.age,
            heightCm: device.heightCm,
            weightKg: device.weightKg,
            activityLevel: device.activityLevel,
            trainingFrequency: device.trainingFrequency,
            allergies: device.allergies,
            goalClarification: device.goalClarification,
            bodyFatPercent: device.bodyFatPercent,
            tdee: device.tdee,
            advancedNotes: device.advancedNotes,
          },
        ),
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
      let shouldStreamFinalReply = false;
      let loggedMeal:
        | {
            foodName: string;
            calories: number;
            protein: number;
            carbs: number;
            fat: number;
          }
        | undefined;

      // The orchestrator may use tools in the first completion, then produce the
      // final assistant reply in a follow-up completion on the same model.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let response;
        try {
          if (typeof llmProvider.chatRound === "function") {
            const roundResult = await llmProvider.chatRound(messages, toolDefinitions);
            if (roundResult.kind === "stream") {
              deps.logger?.info("[assistant] streaming final reply");
              return {
                streamGenerator: roundResult.streamGenerator,
                didLogMeal,
                dailySummary: logMealSummary,
              };
            }
            response = roundResult.response;
          } else {
            if (shouldStreamFinalReply && typeof llmProvider.chatStream === "function") {
              deps.logger?.info("[assistant] streaming final reply");
              return {
                streamGenerator: llmProvider.chatStream(messages, []),
                didLogMeal,
                dailySummary: logMealSummary,
              };
            }

            response = await llmProvider.chat(messages, toolDefinitions);
          }
        } catch (err) {
          deps.logger?.error(`LLM chat failed for device ${deviceId}:`, err);
          const errorMsg = "抱歉，目前無法處理您的請求，請稍後再試。";
          return { reply: errorMsg, didLogMeal, dailySummary: logMealSummary };
        }

        if (response.content !== undefined) {
          deps.logger?.info(`[assistant] ${response.content}`);
          return { reply: response.content, didLogMeal, dailySummary: logMealSummary };
        }

        if (response.toolCalls?.length) {
          for (const tc of response.toolCalls) {
            deps.logger?.info(`[tool_call] ${tc.function.name} ${tc.function.arguments}`);
          }
          const toolResults: Array<{ toolCall: typeof response.toolCalls[number]; result: string }> = [];
          for (const toolCall of response.toolCalls) {
            try {
              // D-03: emit progress label before executing log_food so the route
              // can surface it during the real waiting period, before tokens arrive.
              if (toolCall.function.name === "log_food") {
                opts?.onStatus?.("記錄餐點中...");
              }
              const { result, summary, dailySummary, loggedMeal: toolLoggedMeal } = await executeTool(toolCall, deviceId, {
                foodLoggingService: deps.foodLoggingService,
                summaryService: deps.summaryService,
                publisher: deps.publisher,
                imagePath,
                logger: deps.logger,
              });
              if (toolCall.function.name === "log_food") {
                didLogMeal = true;
                logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
                loggedMeal = toolLoggedMeal;
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
          if (didLogMeal && loggedMeal && isImageOnlyMessage(userMessage, imageBase64)) {
            const reply = buildImageLoggedReply(loggedMeal);
            deps.logger?.info(`[assistant] ${reply}`);
            return { reply, didLogMeal, dailySummary: logMealSummary };
          }
          shouldStreamFinalReply = true;
        }
      }

      // Fallback after MAX_ROUNDS
      return { reply: FALLBACK, didLogMeal, dailySummary: logMealSummary };
    },
  };
}
