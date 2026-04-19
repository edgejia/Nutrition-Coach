import type { LLMProvider, ChatMessage } from "../llm/types.js";
import type { createChatService } from "../services/chat.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createDeviceService, DailyTargets } from "../services/device.js";
import type { createMealCorrectionService } from "../services/meal-correction.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { loadHistory } from "./history.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getToolDefinitions, executeTool, isFatalToolError, redactToolArgsForHook } from "./tools.js";
import { CHOICE_PROMPT_PATTERN } from "./patterns.js";
import type { OrchestratorHooks } from "./hooks.js";

interface OrchestratorDeps {
  llmProvider: LLMProvider;
  chatService: ReturnType<typeof createChatService>;
  summaryService: ReturnType<typeof createSummaryService>;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  deviceService: ReturnType<typeof createDeviceService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
}

const FALLBACK = "抱歉，我現在無法完成這個請求，請稍後再試。";
const MAX_ROUNDS = 3;
const IMAGE_PLACEHOLDER = "(圖片)";
const CHOICE_CONFIRM_MESSAGES = new Set(["2", "方式2"]);
const HALLUCINATED_CHOICE_RECOVERY_REPLY = "這餐剛剛已先依目前估算完成記錄。若你想更精準，我可以再依份量幫你調整。";

export type OrchestratorResult =
  | {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      dailyTargets?: DailyTargets;
    }
  | {
      streamGenerator: AsyncGenerator<string>;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      dailyTargets?: DailyTargets;
    };

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

function ensureGoalReceipt(reply: string, receipt: string | undefined): string {
  if (!receipt) return reply;
  if (reply.includes(receipt)) return reply;
  return `${reply}\n\n${receipt}`;
}

async function* ensureGoalReceiptStream(
  stream: AsyncGenerator<string>,
  receipt: string | undefined,
): AsyncGenerator<string> {
  if (!receipt) {
    yield* stream;
    return;
  }

  let fullReply = "";
  try {
    for await (const token of stream) {
      fullReply += token;
      yield token;
    }
  } catch {
    if (!fullReply.includes(receipt)) {
      yield `${fullReply ? "\n\n" : ""}${receipt}`;
    }
    return;
  }

  if (!fullReply.includes(receipt)) {
    yield `${fullReply ? "\n\n" : ""}${receipt}`;
  }
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
  hooks?: OrchestratorHooks;  // injected per-call; per-request reqId binding via createStructuredHooks
  onUserMessageSaved?: () => void;
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
      const previousAssistantMessage = [...recentMessages]
        .reverse()
        .find((message) => message.role === "assistant")?.content;

      // Save user message after loading history
      await chatService.saveMessage(deviceId, "user", userMessage, { imagePath });
      opts?.onUserMessageSaved?.();
      if (hallucinatedChoiceRecovery) {
        opts?.hooks?.onFallback?.("hallucination_detected");
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
      const toolDefinitions = getToolDefinitions();
      const toolSessionState = { resolvedMealIds: [] as string[] };

      let didLogMeal = false;
      let didMutateMeal = false;
      let logMealSummary: DailySummary | undefined;
      let shouldStreamFinalReply = false;
      let successfulGoalReceipt: string | undefined;
      let successfulGoalTargets: DailyTargets | undefined;
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
        opts?.hooks?.onLLMStart?.(round + 1);
        let response;
        try {
          if (typeof llmProvider.chatRound === "function") {
            const roundResult = await llmProvider.chatRound(messages, toolDefinitions);
            if (roundResult.kind === "stream") {
              opts?.hooks?.onLLMEnd?.(round + 1, false);
              return {
                streamGenerator: ensureGoalReceiptStream(
                  roundResult.streamGenerator,
                  successfulGoalReceipt,
                ),
                didLogMeal,
                didMutateMeal,
                dailySummary: logMealSummary,
                dailyTargets: successfulGoalTargets,
              };
            }
            response = roundResult.response;
          } else {
            if (shouldStreamFinalReply && typeof llmProvider.chatStream === "function") {
              opts?.hooks?.onLLMEnd?.(round + 1, false);
              return {
                streamGenerator: ensureGoalReceiptStream(
                  llmProvider.chatStream(messages, []),
                  successfulGoalReceipt,
                ),
                didLogMeal,
                didMutateMeal,
                dailySummary: logMealSummary,
                dailyTargets: successfulGoalTargets,
              };
            }

            response = await llmProvider.chat(messages, toolDefinitions);
          }
        } catch (err) {
          opts?.hooks?.onFallback?.(didMutateMeal ? "partial_success" : "llm_error");
          if (successfulGoalReceipt) {
            return {
              reply: successfulGoalReceipt,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              dailyTargets: successfulGoalTargets,
            };
          }
          if (didMutateMeal) {
            const partialFallback = didLogMeal
              ? "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。"
              : "已完成餐點調整，但回覆生成失敗，請稍後確認今日攝取摘要。";
            return {
              reply: partialFallback,
              didLogMeal,
              didMutateMeal: true,
              dailySummary: requireDailySummaryForLoggedMeal(logMealSummary),
            };
          }
          const errorMsg = "抱歉，目前無法處理您的請求，請稍後再試。";
          return { reply: errorMsg, didLogMeal, didMutateMeal, dailySummary: logMealSummary };
        }

        if (response.content !== undefined) {
          opts?.hooks?.onLLMEnd?.(round + 1, false);
          return {
            reply: ensureGoalReceipt(response.content, successfulGoalReceipt),
            didLogMeal,
            didMutateMeal,
            dailySummary: logMealSummary,
            dailyTargets: successfulGoalTargets,
          };
        }

        if (response.toolCalls?.length) {
          const toolResults: Array<{ toolCall: typeof response.toolCalls[number]; result: string }> = [];
          for (const toolCall of response.toolCalls) {
            try {
              // D-03: emit progress label before executing log_food so the route
              // can surface it during the real waiting period, before tokens arrive.
              if (toolCall.function.name === "log_food") {
                opts?.onStatus?.("記錄餐點中...");
              } else if (toolCall.function.name === "update_meal") {
                opts?.onStatus?.("調整餐點中...");
              } else if (toolCall.function.name === "delete_meal") {
                opts?.onStatus?.("刪除餐點中...");
              }
              const argsRedacted = redactToolArgsForHook(toolCall.function.name, toolCall.function.arguments);
              opts?.hooks?.onToolReceived?.(toolCall.function.name, argsRedacted);
              const {
                result,
                summary,
                dailySummary,
                loggedMeal: toolLoggedMeal,
                success,
                failureReason,
                updatedFields,
                publishedEvents,
                dailyTargets,
                mealMutationKind,
              } = await executeTool(toolCall, deviceId, {
                foodLoggingService: deps.foodLoggingService,
                summaryService: deps.summaryService,
                mealCorrectionService: deps.mealCorrectionService,
                deviceService: deps.deviceService,
                publisher: deps.publisher,
                imagePath,
                toolSessionState,
              }, {
                currentUserMessage: userMessage,
                previousAssistantMessage,
              });
              if (success === false) {
                opts?.hooks?.onToolResult?.({
                  tool: toolCall.function.name,
                  success: false,
                  executed: false,
                  failureReason,
                  summary,
                  updatedFields,
                });
                await chatService.saveMessage(deviceId, "tool", summary, { toolName: toolCall.function.name });
                toolResults.push({ toolCall, result });
                continue;
              }
              if (toolCall.function.name === "log_food") {
                didLogMeal = true;
                didMutateMeal = true;
                logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
                loggedMeal = toolLoggedMeal;
              }
              if (mealMutationKind === "update" || mealMutationKind === "delete") {
                didMutateMeal = true;
                logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
              }
              if (toolCall.function.name === "update_goals") {
                successfulGoalReceipt = result;
                successfulGoalTargets = dailyTargets;
              }
              opts?.hooks?.onToolResult?.({
                tool: toolCall.function.name,
                success: true,
                executed: true,
                summary,
                updatedFields,
                publishedEvents,
              });
              await chatService.saveMessage(deviceId, "tool", summary, { toolName: toolCall.function.name });
              toolResults.push({ toolCall, result });
            } catch (err) {
              const errorStr = err instanceof Error ? err.message : "Tool execution failed";
              if (isFatalToolError(err)) {
                // Validation failed before execution — emit executed:false BEFORE propagating
                opts?.hooks?.onToolResult?.({ tool: toolCall.function.name, success: false, executed: false, failureReason: errorStr });
                if (successfulGoalReceipt) {
                  return {
                    reply: successfulGoalReceipt,
                    didLogMeal,
                    didMutateMeal,
                    dailySummary: logMealSummary,
                    dailyTargets: successfulGoalTargets,
                  };
                }
                throw err;
              }
              opts?.hooks?.onToolResult?.({ tool: toolCall.function.name, success: false, executed: true, failureReason: errorStr });
              toolResults.push({ toolCall, result: `Error: ${errorStr}` });
            }
          }
          messages.push({ role: "assistant", content: null, tool_calls: response.toolCalls });
          for (const { toolCall, result } of toolResults) {
            messages.push({ role: "tool", content: result, tool_call_id: toolCall.id });
          }
          if (didLogMeal && loggedMeal && isImageOnlyMessage(userMessage, imageBase64)) {
            const reply = buildImageLoggedReply(loggedMeal);
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return { reply, didLogMeal, didMutateMeal, dailySummary: logMealSummary };
          }
          shouldStreamFinalReply = true;
          // Complete the tool-round LLM lifecycle event
          opts?.hooks?.onLLMEnd?.(round + 1, true);
        }
      }

      // Fallback after MAX_ROUNDS
      opts?.hooks?.onFallback?.("max_rounds");
      if (successfulGoalReceipt) {
        return {
          reply: successfulGoalReceipt,
          didLogMeal,
          didMutateMeal,
          dailySummary: logMealSummary,
          dailyTargets: successfulGoalTargets,
        };
      }
      return { reply: FALLBACK, didLogMeal, didMutateMeal, dailySummary: logMealSummary };
    },
  };
}
