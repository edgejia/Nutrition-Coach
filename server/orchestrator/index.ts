import type { LLMProvider, ChatMessage, ProviderErrorMetadata } from "../llm/types.js";
import { isLLMProviderError } from "../llm/errors.js";
import type { createChatService } from "../services/chat.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createDeviceService, DailyTargets } from "../services/device.js";
import type { createMealCorrectionService } from "../services/meal-correction.js";
import type { createGoalProposalService } from "../services/goal-proposals.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { loadHistory } from "./history.js";
import { buildSystemPrompt } from "./system-prompt.js";
import {
  getToolDefinitions,
  executeTool,
  isFatalToolError,
  redactToolArgsForHook,
  type ToolExecutionResult,
} from "./tools.js";
import { CHOICE_PROMPT_PATTERN } from "./patterns.js";
import type { OrchestratorHooks } from "./hooks.js";
import type { FallbackPayload } from "./hooks.js";
import type {
  LlmTraceFinalReplyShape,
  LlmTraceFinalReplySource,
} from "./llm-trace.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import type { MutationEffects } from "./mutation-effects.js";
import {
  assertNoForbiddenReceiptTerms,
  renderGoalCancelCopy,
  renderMutationReceipt,
} from "./mutation-receipts.js";
import { isGoalProposalCancel } from "./source-text-guard.js";
import {
  composeSummaryHistoryReply,
  type SummaryHistoryFacts,
} from "./summary-history-renderer.js";
export type { SummaryHistoryFacts } from "./summary-history-renderer.js";

interface OrchestratorDeps {
  llmProvider: LLMProvider;
  chatService: ReturnType<typeof createChatService>;
  summaryService: ReturnType<typeof createSummaryService>;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  deviceService: ReturnType<typeof createDeviceService>;
  goalProposalService?: ReturnType<typeof createGoalProposalService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
}

const FALLBACK = "抱歉，我現在無法完成這個請求，請稍後再試。";
const MAX_ROUNDS = 3;
const IMAGE_PLACEHOLDER = "(圖片)";
const CHOICE_CONFIRM_MESSAGES = new Set(["2", "方式2"]);
const HALLUCINATED_CHOICE_RECOVERY_REPLY = "這餐剛剛已先依目前估算完成記錄。若你想更精準，我可以再依份量幫你調整。";
const NO_MUTATION_LOGGING_CLAIM_PATTERN = /已\s*(?:經\s*)?記錄|完成\s*記錄/;
const NO_MUTATION_LOGGING_FALLBACK = "我還沒有把這餐寫入紀錄。請再提供餐點或份量，我再幫你估算。";
// Summary replies often use approximate wording after totals are rounded by the model.
const SUMMARY_HISTORY_CALORIE_TOLERANCE_KCAL = 10;

interface NoMutationLoggingGuardContext {
  summaryHistoryFacts?: SummaryHistoryFacts;
}

interface ClaimedMealFact {
  name: string;
  calories?: number;
}

export interface ProviderFallbackContext {
  reason: "llm_error";
  round: number;
  providerMetadata: ProviderErrorMetadata;
  lastTool?: string;
}

export interface FallbackOutcomeContext {
  fallbackSource: "orchestrator";
  reason: "llm_error" | "partial_success" | "max_rounds";
  round?: number;
  lastTool?: string;
}

interface FinalReplyTraceMetadata {
  finalReplySource?: LlmTraceFinalReplySource;
  finalReplyShape?: LlmTraceFinalReplyShape;
  providerFallbackContext?: ProviderFallbackContext;
  fallbackOutcomeContext?: FallbackOutcomeContext;
}

export type OrchestratorResult =
  | ({
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      summaryHistoryFacts?: SummaryHistoryFacts;
      dailyTargets?: DailyTargets;
      affectedDate?: string;
      loggedMeal?: LoggedMealReceipt;
      loggedMealToolMessageId?: string;
    } & FinalReplyTraceMetadata)
  | ({
      streamGenerator: AsyncGenerator<string>;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      summaryHistoryFacts?: SummaryHistoryFacts;
      dailyTargets?: DailyTargets;
      affectedDate?: string;
      loggedMeal?: LoggedMealReceipt;
      loggedMealToolMessageId?: string;
    } & FinalReplyTraceMetadata);

type LoggedMealReceipt = NonNullable<ToolExecutionResult["loggedMeal"]>;

interface CorrectionClarificationCandidate {
  foodName: string;
  loggedAt: string;
  dateKey: string;
}

interface CorrectionToolResult {
  status: "resolved" | "needs_clarification" | "not_found";
  action: "update" | "delete";
  candidates?: CorrectionClarificationCandidate[];
}

function requireDailySummaryForLoggedMeal(dailySummary: DailySummary | undefined): DailySummary {
  if (!dailySummary) {
    throw new Error("log_food succeeded without dailySummary");
  }

  return dailySummary;
}

function formatCalories(calories: number): string {
  return Number.isInteger(calories) ? String(calories) : calories.toFixed(1).replace(/\.0$/, "");
}

function buildLocalMidpointDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

async function buildSummaryHistoryFacts(
  deps: OrchestratorDeps,
  deviceId: string,
  dailySummary: DailySummary,
): Promise<SummaryHistoryFacts> {
  const meals = await deps.foodLoggingService.getMealsByDate(
    deviceId,
    buildLocalMidpointDate(dailySummary.date),
  );
  return {
    dailySummary,
    meals: meals.map((meal) => ({
      foodName: meal.foodName,
      calories: meal.calories,
    })),
  };
}

function isImageOnlyMessage(userMessage: string, imageBase64?: string): boolean {
  return Boolean(imageBase64) && userMessage.trim() === IMAGE_PLACEHOLDER;
}

function joinProteinSourceNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]}和${names[1]}`;
  }
  return `${names[0]}、${names[1]}等主要來源`;
}

function formatProteinGrams(protein: number): string {
  return Number.isInteger(protein) ? String(protein) : protein.toFixed(1).replace(/\.0$/, "");
}

function formatReceiptDateLabel(dateKey: string, currentDate = currentAppDate()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return dateKey;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year === currentDate.getFullYear()
    ? `${month}/${day}`
    : `${year}/${month}/${day}`;
}

function buildTrustedProteinExplanation(loggedMeal: LoggedMealReceipt): string {
  const countedSourceNames = [...new Set(
    loggedMeal.countedSources
      .map((source) => source.name.trim())
      .filter(Boolean),
  )].slice(0, 3);

  if (countedSourceNames.length === 0) {
    return loggedMeal.usedConservativeAssumption
      ? "蛋白質目前缺少清楚主來源，先用偏低方式估算，未把配菜列入主要蛋白質。"
      : "蛋白質目前沒有明確主來源，未把配菜列入主要蛋白質。";
  }

  const sourceLabel = joinProteinSourceNames(countedSourceNames);
  if (loggedMeal.usedConservativeAssumption) {
    return `蛋白質先按${sourceLabel}作為主要來源估算；其他配菜不列入主要蛋白質，份量不清楚時用偏低值。`;
  }
  if (loggedMeal.excludedSources.length > 0) {
    return `蛋白質先按${sourceLabel}作為主要來源估算，其他配菜不列入主要蛋白質。`;
  }
  return `蛋白質先按${sourceLabel}作為主要來源估算。`;
}

function getUniqueCountedProteinNames(loggedMeal: LoggedMealReceipt): string[] {
  return [...new Set(
    loggedMeal.countedSources
      .map((source) => source.name.trim())
      .filter(Boolean),
  )];
}

function buildCompactProteinSuffix(loggedMeal: LoggedMealReceipt): string {
  const countedSourceNames = getUniqueCountedProteinNames(loggedMeal);
  if (loggedMeal.usedConservativeAssumption) {
    return "（偏低估）";
  }
  if (countedSourceNames.length > 1) {
    return `（${joinProteinSourceNames(countedSourceNames.slice(0, 3))}）`;
  }
  if (loggedMeal.excludedSources.length > 0 && countedSourceNames.length === 1) {
    return `（以${countedSourceNames[0]}為主）`;
  }
  return "";
}

function getHighVarianceErrorSource(foodName: string): "湯底與份量" | "油脂與飯量" | "份量" | undefined {
  if (/(湯|麵|noodle|soup)/i.test(foodName)) {
    return "湯底與份量";
  }
  if (/(便當|飯盒|lunchbox|bento)/i.test(foodName)) {
    return "油脂與飯量";
  }
  if (/(buffet|自助餐)/i.test(foodName)) {
    return "份量";
  }
  return undefined;
}

function buildImageLoggedReply(loggedMeal: LoggedMealReceipt): string {
  const todayKey = formatLocalDate(currentAppDate());
  const datePrefix = loggedMeal.dateKey !== todayKey ? `${formatReceiptDateLabel(loggedMeal.dateKey)} ` : "";
  const calories = formatCalories(loggedMeal.calories);
  const protein = formatProteinGrams(loggedMeal.protein);
  const highVarianceErrorSource = getHighVarianceErrorSource(loggedMeal.foodName);
  const uncertaintyErrorSource = highVarianceErrorSource
    ?? (loggedMeal.usedConservativeAssumption || loggedMeal.quantityUncertaintyReason === "missing_quantity"
      ? "份量"
      : undefined);
  const proteinSuffix = buildCompactProteinSuffix(loggedMeal);
  const receipt = uncertaintyErrorSource
    ? `已記錄${datePrefix}${loggedMeal.foodName}，估約 ${calories} kcal（區間 ${Math.floor(loggedMeal.calories * 0.85)}-${Math.ceil(loggedMeal.calories * 1.15)}），蛋白質 ${protein} g${proteinSuffix}`
    : `已記錄${datePrefix}${loggedMeal.foodName}，${calories} kcal，蛋白質 ${protein} g${proteinSuffix}`;
  const nextStep = loggedMeal.usedConservativeAssumption || loggedMeal.quantityUncertaintyReason === "missing_quantity"
    ? "，可再補份量修正"
    : "";
  return uncertaintyErrorSource
    ? `${receipt}。${uncertaintyErrorSource}是主要誤差${nextStep}。`
    : `${receipt}。`;
}

function buildUpdatedMealReply(loggedMeal: LoggedMealReceipt): string {
  const todayKey = formatLocalDate(currentAppDate());
  const datePrefix = loggedMeal.dateKey !== todayKey ? `${formatReceiptDateLabel(loggedMeal.dateKey)} ` : "";
  const calories = formatCalories(loggedMeal.calories);
  const protein = formatProteinGrams(loggedMeal.protein);
  return `已更新${datePrefix}${loggedMeal.foodName}，${calories} kcal，蛋白質 ${protein} g。`;
}

function buildMutationSuccessReply(affectedDate?: string): string {
  const todayKey = formatLocalDate(currentAppDate());
  if (affectedDate && affectedDate !== todayKey) {
    return `已完成 ${formatReceiptDateLabel(affectedDate)} 餐點調整，請稍後確認該日攝取摘要。`;
  }
  return "已完成餐點調整，請稍後確認今日攝取摘要。";
}

function getDeviceTargets(device: Awaited<ReturnType<ReturnType<typeof createDeviceService>["getDevice"]>>): DailyTargets {
  if (!device) {
    throw new Error("Device not found");
  }

  return {
    calories: device.dailyCalories,
    protein: device.dailyProtein,
    carbs: device.dailyCarbs,
    fat: device.dailyFat,
  };
}

function extractUserCorrectionTarget(userMessage: string): string {
  const targetSide = userMessage.match(/^(.*?)(?:改成|改為|改到|變成|換成|調成)/)?.[1] ?? userMessage;
  return targetSide
    .replace(/^(?:請|麻煩|幫我)?把?/, "")
    .replace(/(?:的)?$/, "")
    .trim();
}

function formatCorrectionCandidate(candidate: CorrectionClarificationCandidate, index: number): string {
  const local = new Date(candidate.loggedAt);
  const hour = `${local.getHours()}`.padStart(2, "0");
  const minute = `${local.getMinutes()}`.padStart(2, "0");
  return `${index + 1}. ${candidate.dateKey} ${hour}:${minute} ${candidate.foodName}`;
}

function buildCorrectionClarificationReply(result: CorrectionToolResult, userMessage: string): string | undefined {
  if (result.status === "resolved") {
    return undefined;
  }

  const verb = result.action === "update" ? "修改" : "刪除";
  const userTarget = extractUserCorrectionTarget(userMessage);
  const targetLabel = userTarget ? `「${userTarget}」` : "這筆餐點";
  const candidates = result.candidates ?? [];

  if (result.status === "needs_clarification" && candidates.length > 0) {
    const lines = candidates.map((candidate, index) => formatCorrectionCandidate(candidate, index));
    return `我找到多筆可能要${verb}的${targetLabel}，請直接回覆編號：\n${lines.join("\n")}`;
  }

  return `我還不能確定你要${verb}哪一筆${targetLabel}，請補充日期、餐別或食物名稱。`;
}

function parseCorrectionToolResult(toolName: string, result: string): CorrectionToolResult | undefined {
  if (toolName !== "find_meals") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result) as CorrectionToolResult;
    if (
      (parsed.status === "resolved" || parsed.status === "needs_clarification" || parsed.status === "not_found")
      && (parsed.action === "update" || parsed.action === "delete")
    ) {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function buildPartialSuccessLoggedReply(loggedMeal: LoggedMealReceipt): string {
  return `已完成記錄，但回覆生成失敗。${buildTrustedProteinExplanation(loggedMeal)} 請稍後確認今日攝取摘要。`;
}

function appendMutationReceiptText(reply: string, receipt: string | undefined): string {
  if (!receipt) return reply;
  if (reply.includes(receipt)) return reply;
  return `${reply}\n\n${receipt}`;
}

function renderCheckedMutationReceipt(effects: MutationEffects): string {
  const reply = renderMutationReceipt(effects);
  const forbiddenTerms = assertNoForbiddenReceiptTerms(reply);
  if (forbiddenTerms.length > 0) {
    throw new Error(`Mutation receipt contains forbidden terms: ${forbiddenTerms.join(", ")}`);
  }
  return reply;
}

function classifyPlainReplyShape(reply: string): LlmTraceFinalReplyShape {
  return reply.trim().length > 0 ? "plain_text" : "empty_or_missing";
}

function classifyFallbackReplyShape(reply: string): LlmTraceFinalReplyShape {
  return reply.trim().length > 0 ? "fallback_text" : "empty_or_missing";
}

export function guardNoMutationLoggingClaim(
  reply: string,
  didLogMeal: boolean,
  didMutateMeal: boolean,
  context: NoMutationLoggingGuardContext = {},
): string {
  const hasNoMutationLoggingClaim = !didLogMeal && !didMutateMeal && NO_MUTATION_LOGGING_CLAIM_PATTERN.test(reply);
  if (!hasNoMutationLoggingClaim) {
    return reply;
  }
  if (isFactGroundedSummaryHistoryReply(reply, context.summaryHistoryFacts)) {
    return reply;
  }
  return NO_MUTATION_LOGGING_FALLBACK;
}

function isFactGroundedSummaryHistoryReply(reply: string, facts: SummaryHistoryFacts | undefined): boolean {
  if (!facts?.dailySummary || facts.dailySummary.mealCount <= 0 || facts.meals.length === 0) {
    return false;
  }

  const claimedMealCount = extractClaimedMealCount(reply);
  const claimedCalories = extractClaimedCalories(reply);
  const claimedMealFacts = extractClaimedMealFacts(reply);
  const matchedClaims = claimedMealFacts.map((claim) => ({
    claim,
    meal: findMatchingFactMeal(claim.name, facts.meals),
  }));
  if (matchedClaims.some(({ meal }) => meal === undefined)) {
    return false;
  }
  if (matchedClaims.some(({ claim, meal }) => (
    claim.calories !== undefined && !caloriesCloseEnough(claim.calories, meal?.calories ?? Number.NaN)
  ))) {
    return false;
  }

  if (
    claimedMealCount !== undefined
    && claimedCalories !== undefined
    && claimedMealCount === facts.dailySummary.mealCount
    && caloriesCloseEnough(claimedCalories, facts.dailySummary.totalCalories)
  ) {
    return true;
  }

  if (claimedMealFacts.length === 0) {
    return false;
  }

  if (claimedCalories === undefined) {
    return true;
  }

  return matchedClaims.some(({ meal }) => caloriesCloseEnough(claimedCalories, meal?.calories ?? Number.NaN));
}

function extractClaimedMealCount(reply: string): number | undefined {
  const match = reply.match(/(\d+)\s*餐/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function extractClaimedCalories(reply: string): number | undefined {
  const match = reply.match(/(?:約\s*)?(\d+(?:\.\d+)?)\s*(?:kcal|大卡|卡)/i);
  return match?.[1] ? Number(match[1]) : undefined;
}

function extractClaimedMealFacts(reply: string): ClaimedMealFact[] {
  const claims: ClaimedMealFact[] = [];
  const patterns = [
    /已\s*(?:經\s*)?記錄(?:的餐點(?:有|包含)?|(?:的)?餐點有)?\s*([^，。,.;；]+)/g,
    /完成\s*記錄\s*([^，。,.;；]+)/g,
    /(?:其中)?(?:包含|含有|有)\s*([^，。,.;；]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of reply.matchAll(pattern)) {
      const raw = match[1]?.trim();
      if (!raw || /^\d+\s*餐/.test(raw)) {
        continue;
      }
      for (const part of raw.split(/[、和與及]/)) {
        const calorieMatch = part.match(/(?:約\s*)?(\d+(?:\.\d+)?)\s*(?:kcal|大卡|卡)/i);
        const name = part
          .replace(/(?:約\s*)?\d+(?:\.\d+)?\s*(?:kcal|大卡|卡)/ig, "")
          .trim();
        if (name && !/^(?:餐點|今天|目前|共|總共)$/.test(name) && !/^\d+\s*餐/.test(name)) {
          claims.push({
            name,
            calories: calorieMatch?.[1] ? Number(calorieMatch[1]) : undefined,
          });
        }
      }
    }
  }

  return [...new Map(claims.map((claim) => [normalizeClaimText(claim.name), claim])).values()];
}

function findMatchingFactMeal(
  claim: string,
  meals: SummaryHistoryFacts["meals"],
): SummaryHistoryFacts["meals"][number] | undefined {
  const normalizedClaim = normalizeClaimText(claim);
  return meals.find((meal) => {
    const normalizedFactName = normalizeClaimText(meal.foodName);
    return normalizedFactName.includes(normalizedClaim) || normalizedClaim.includes(normalizedFactName);
  });
}

function normalizeClaimText(value: string): string {
  return value
    .toLocaleLowerCase("zh-TW")
    .replace(/[ \t\n\r，。,.;；:：()（）「」『』]/g, "")
    .replace(/^的餐點有/, "")
    .trim();
}

function caloriesCloseEnough(claimed: number, actual: number): boolean {
  return Number.isFinite(claimed)
    && Number.isFinite(actual)
    && Math.abs(claimed - actual) <= SUMMARY_HISTORY_CALORIE_TOLERANCE_KCAL;
}

async function* appendMutationReceiptStream(
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

function observeProviderStream(
  stream: AsyncGenerator<string>,
  hooks: OrchestratorHooks | undefined,
  round: number,
  fallbackReason: FallbackPayload["reason"],
  lastTool: string | undefined,
): AsyncGenerator<string> {
  async function* observed() {
    try {
      yield* stream;
    } catch (err) {
      if (isLLMProviderError(err)) {
        const providerPayload = {
          round,
          providerMetadata: err.providerMetadata,
          ...(lastTool !== undefined ? { lastTool } : {}),
        };
        hooks?.onLLMError?.(providerPayload);
        hooks?.onFallback?.({
          reason: fallbackReason,
          round,
          ...(lastTool !== undefined ? { lastTool } : {}),
          providerMetadata: err.providerMetadata,
        });
      }
      throw err;
    }
  }

  return observed();
}

function detectHallucinatedChoiceFollowUp(
  userMessage: string,
  recentMessages: Array<{ role: string; content: unknown; didLogMeal?: boolean }>
): string | undefined {
  const trimmedMessage = userMessage.trim();
  if (!CHOICE_CONFIRM_MESSAGES.has(trimmedMessage)) {
    return undefined;
  }

  const lastAssistant = [...recentMessages].reverse().find((message) => message.role === "assistant");
  const lastAssistantContent = typeof lastAssistant?.content === "string" ? lastAssistant.content : "";
  if (!lastAssistant?.didLogMeal) {
    const hasRecentMealMutationSummary =
      lastAssistantContent.includes("[系統已完成餐點記錄]") ||
      lastAssistantContent.includes("[系統已完成餐點修改]") ||
      lastAssistantContent.includes("[系統已完成餐點刪除]");
    if (!hasRecentMealMutationSummary) {
      return undefined;
    }
  }

  if (!CHOICE_PROMPT_PATTERN.test(lastAssistantContent)) {
    return undefined;
  }

  return HALLUCINATED_CHOICE_RECOVERY_REPLY;
}

export interface HandleMessageOpts {
  onStatus?: (label: string) => void;
  hooks?: OrchestratorHooks;  // injected per-call; per-request reqId binding via createStructuredHooks
  onUserMessageSaved?: () => void;
  signal?: AbortSignal;
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
      const displayHistory = await chatService.getHistory(deviceId, 3);
      const hallucinatedChoiceRecovery = detectHallucinatedChoiceFollowUp(userMessage, history);
      const previousAssistantMessage = [...displayHistory]
        .reverse()
        .find((message) => message.role === "assistant")?.content;

      // Save user message after loading history
      await chatService.saveMessage(deviceId, "user", userMessage, { imagePath });
      opts?.onUserMessageSaved?.();
      if (hallucinatedChoiceRecovery) {
        opts?.hooks?.onFallback?.({ reason: "hallucination_detected" });
        return {
          reply: hallucinatedChoiceRecovery,
          didLogMeal: false,
          finalReplySource: "fallback",
          finalReplyShape: classifyFallbackReplyShape(hallucinatedChoiceRecovery),
        };
      }
      if (isGoalProposalCancel(userMessage) && deps.goalProposalService) {
        const proposal = await deps.goalProposalService.getLatest(deviceId);
        if (proposal) {
          await deps.goalProposalService.clear(deviceId);
          const reply = renderGoalCancelCopy();
          return {
            reply,
            didLogMeal: false,
            didMutateMeal: false,
            finalReplySource: "renderer",
            finalReplyShape: classifyPlainReplyShape(reply),
          };
        }
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
      const safeToolNames = new Set(toolDefinitions.map((definition) => definition.function.name));
      const toolSessionState = { resolvedMealIds: [] as string[] };

      let didLogMeal = false;
      let didMutateMeal = false;
      let logMealSummary: DailySummary | undefined;
      let summaryHistoryFacts: SummaryHistoryFacts | undefined;
      let shouldStreamFinalReply = false;
      let successfulGoalTargets: DailyTargets | undefined;
      let mutationEffects: MutationEffects | undefined;
      let mutationReceiptText: string | undefined;
      let resolvedAffectedDate: string | undefined;
      let loggedMeal:
        | LoggedMealReceipt
        | undefined;
      let loggedMealToolMessageId: string | undefined;
      let correctionClarificationReply: string | undefined;
      let lastTool: string | undefined;

      // The orchestrator may use tools in the first completion, then produce the
      // final assistant reply in a follow-up completion on the same model.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        opts?.hooks?.onLLMStart?.(round + 1);
        let response;
        try {
          if (typeof llmProvider.chatRound === "function") {
            const roundResult = await llmProvider.chatRound(messages, toolDefinitions, {
              signal: opts?.signal,
            });
            if (roundResult.kind === "stream") {
              const fallbackReason: FallbackPayload["reason"] = didMutateMeal ? "partial_success" : "llm_error";
              opts?.hooks?.onLLMEnd?.(round + 1, false);
              return {
                streamGenerator: appendMutationReceiptStream(
                  observeProviderStream(
                    roundResult.streamGenerator,
                    opts?.hooks,
                    round + 1,
                    fallbackReason,
                    lastTool,
                  ),
                  mutationReceiptText,
                ),
                didLogMeal,
                didMutateMeal,
                dailySummary: logMealSummary,
                summaryHistoryFacts,
                dailyTargets: successfulGoalTargets,
                affectedDate: resolvedAffectedDate,
                loggedMeal,
                loggedMealToolMessageId,
              };
            }
            response = roundResult.response;
          } else {
            if (shouldStreamFinalReply && typeof llmProvider.chatStream === "function") {
              const fallbackReason: FallbackPayload["reason"] = didMutateMeal ? "partial_success" : "llm_error";
              opts?.hooks?.onLLMEnd?.(round + 1, false);
              return {
                streamGenerator: appendMutationReceiptStream(
                  observeProviderStream(
                    llmProvider.chatStream(messages, [], { signal: opts?.signal }),
                    opts?.hooks,
                    round + 1,
                    fallbackReason,
                    lastTool,
                  ),
                  mutationReceiptText,
                ),
                didLogMeal,
                didMutateMeal,
                dailySummary: logMealSummary,
                summaryHistoryFacts,
                dailyTargets: successfulGoalTargets,
                affectedDate: resolvedAffectedDate,
                loggedMeal,
                loggedMealToolMessageId,
              };
            }

            response = await llmProvider.chat(messages, toolDefinitions, { signal: opts?.signal });
          }
        } catch (err) {
          const fallbackReason: FallbackPayload["reason"] = didMutateMeal ? "partial_success" : "llm_error";
          const fallbackPayload: FallbackPayload = {
            reason: fallbackReason,
            round: round + 1,
            ...(lastTool !== undefined ? { lastTool } : {}),
          };
          const fallbackOutcomeContext: FallbackOutcomeContext = {
            fallbackSource: "orchestrator",
            reason: fallbackReason,
            round: round + 1,
            ...(lastTool !== undefined ? { lastTool } : {}),
          };
          let providerFallbackContext: ProviderFallbackContext | undefined;

          if (isLLMProviderError(err)) {
            const providerPayload = {
              round: round + 1,
              providerMetadata: err.providerMetadata,
              ...(lastTool !== undefined ? { lastTool } : {}),
            };
            if (fallbackReason === "llm_error") {
              providerFallbackContext = {
                reason: fallbackReason,
                round: round + 1,
                providerMetadata: err.providerMetadata,
                ...(lastTool !== undefined ? { lastTool } : {}),
              };
            }
            opts?.hooks?.onLLMError?.(providerPayload);
            opts?.hooks?.onFallback?.({
              ...fallbackPayload,
              providerMetadata: providerPayload.providerMetadata,
            });
          } else {
            opts?.hooks?.onFallback?.(fallbackPayload);
          }
          if (mutationReceiptText && mutationEffects) {
            return {
              reply: mutationReceiptText,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              dailyTargets: successfulGoalTargets,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(mutationReceiptText),
              providerFallbackContext,
              fallbackOutcomeContext,
            };
          }
          if (didMutateMeal) {
            const partialFallback = didLogMeal
              ? (loggedMeal ? buildPartialSuccessLoggedReply(loggedMeal) : "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。")
              : "已完成餐點調整，但回覆生成失敗，請稍後確認今日攝取摘要。";
            return {
              reply: partialFallback,
              didLogMeal,
              didMutateMeal: true,
              dailySummary: requireDailySummaryForLoggedMeal(logMealSummary),
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "fallback",
              finalReplyShape: classifyFallbackReplyShape(partialFallback),
              providerFallbackContext,
              fallbackOutcomeContext,
            };
          }
          const errorMsg = "抱歉，目前無法處理您的請求，請稍後再試。";
          return {
            reply: errorMsg,
            didLogMeal,
            didMutateMeal,
            dailySummary: logMealSummary,
            affectedDate: resolvedAffectedDate,
            loggedMeal,
            loggedMealToolMessageId,
            finalReplySource: "fallback",
            finalReplyShape: classifyFallbackReplyShape(errorMsg),
            providerFallbackContext,
            fallbackOutcomeContext,
          };
        }

        if (response.content !== undefined) {
          opts?.hooks?.onLLMEnd?.(round + 1, false);
          const reply = summaryHistoryFacts
            ? composeSummaryHistoryReply(summaryHistoryFacts, response.content)
            : guardNoMutationLoggingClaim(response.content, didLogMeal, didMutateMeal, {
              summaryHistoryFacts,
            });
          const finalReplySource = summaryHistoryFacts
            ? "renderer"
            : reply === response.content ? "model" : "fallback";
          return {
            reply,
            didLogMeal,
            didMutateMeal,
            dailySummary: logMealSummary,
            summaryHistoryFacts,
            dailyTargets: successfulGoalTargets,
            affectedDate: resolvedAffectedDate,
            loggedMeal,
            loggedMealToolMessageId,
            finalReplySource,
            finalReplyShape: finalReplySource === "fallback"
              ? classifyFallbackReplyShape(reply)
              : classifyPlainReplyShape(reply),
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
              if (safeToolNames.has(toolCall.function.name)) {
                lastTool = toolCall.function.name;
              }
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
                affectedDate,
                mealMutationKind,
                deletedMeal,
                summaryHistoryFacts: toolSummaryHistoryFacts,
                controlledReply,
              } = await executeTool(toolCall, deviceId, {
                foodLoggingService: deps.foodLoggingService,
                summaryService: deps.summaryService,
                mealCorrectionService: deps.mealCorrectionService,
                deviceService: deps.deviceService,
                goalProposalService: deps.goalProposalService,
                publisher: deps.publisher,
                imagePath,
                toolSessionState,
              }, {
                currentUserMessage: userMessage,
                previousAssistantMessage,
              });
              if (controlledReply) {
                opts?.hooks?.onToolResult?.({
                  tool: toolCall.function.name,
                  success: success !== false,
                  executed: success !== false,
                  failureReason,
                  summary,
                  updatedFields,
                  publishedEvents,
                });
                opts?.hooks?.onLLMEnd?.(round + 1, true);
                return {
                  reply: controlledReply.text,
                  didLogMeal: false,
                  didMutateMeal: false,
                  finalReplySource: controlledReply.source,
                  finalReplyShape: classifyPlainReplyShape(controlledReply.text),
                };
              }
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
              if (affectedDate) {
                resolvedAffectedDate = affectedDate;
              }
              if (toolCall.function.name === "log_food") {
                didLogMeal = true;
                didMutateMeal = true;
                logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
                loggedMeal = toolLoggedMeal;
                if (!toolLoggedMeal) {
                  throw new Error("log_food succeeded without loggedMeal");
                }
                mutationEffects = {
                  kind: "log",
                  affectedDate: affectedDate ?? toolLoggedMeal.dateKey,
                  committedSummary: logMealSummary,
                  committedTargets: getDeviceTargets(device),
                  meal: toolLoggedMeal,
                };
                mutationReceiptText = renderCheckedMutationReceipt(mutationEffects);
              }
              if (toolCall.function.name === "get_daily_summary" && dailySummary) {
                logMealSummary = dailySummary;
                summaryHistoryFacts = toolSummaryHistoryFacts
                  ?? await buildSummaryHistoryFacts(deps, deviceId, dailySummary);
              }
              if (mealMutationKind === "update" || mealMutationKind === "delete") {
                didMutateMeal = true;
                logMealSummary = requireDailySummaryForLoggedMeal(dailySummary);
                if (mealMutationKind === "update") {
                  loggedMeal = toolLoggedMeal;
                  if (!toolLoggedMeal) {
                    throw new Error("update_meal succeeded without loggedMeal");
                  }
                  mutationEffects = {
                    kind: "update",
                    affectedDate: affectedDate ?? toolLoggedMeal.dateKey,
                    committedSummary: logMealSummary,
                    committedTargets: getDeviceTargets(device),
                    meal: toolLoggedMeal,
                  };
                  mutationReceiptText = renderCheckedMutationReceipt(mutationEffects);
                } else {
                  if (!deletedMeal) {
                    throw new Error("delete_meal succeeded without deletedMeal");
                  }
                  mutationEffects = {
                    kind: "delete",
                    affectedDate: affectedDate ?? deletedMeal.dateKey,
                    committedSummary: logMealSummary,
                    committedTargets: getDeviceTargets(device),
                    deletedMeal,
                  };
                  mutationReceiptText = renderCheckedMutationReceipt(mutationEffects);
                }
              }
              if (toolCall.function.name === "update_goals") {
                successfulGoalTargets = dailyTargets;
                if (!dailyTargets) {
                  throw new Error("update_goals succeeded without dailyTargets");
                }
                mutationEffects = {
                  kind: "goals",
                  affectedDate: formatLocalDate(currentAppDate()),
                  committedSummary: await deps.summaryService.getDailySummary(deviceId, currentAppDate()),
                  committedTargets: dailyTargets,
                  targets: dailyTargets,
                  updatedFields: updatedFields as Array<keyof DailyTargets>,
                };
                mutationReceiptText = renderCheckedMutationReceipt(mutationEffects);
              }
              const correctionResult = parseCorrectionToolResult(toolCall.function.name, result);
              if (correctionResult) {
                correctionClarificationReply = buildCorrectionClarificationReply(correctionResult, userMessage);
              }
              opts?.hooks?.onToolResult?.({
                tool: toolCall.function.name,
                success: true,
                executed: true,
                summary,
                updatedFields,
                publishedEvents,
              });
              const toolMessage = await chatService.saveMessage(deviceId, "tool", summary, { toolName: toolCall.function.name });
              if (toolLoggedMeal) {
                loggedMealToolMessageId = toolMessage.id;
              }
              toolResults.push({ toolCall, result });
            } catch (toolErr) {
              const errorStr = toolErr instanceof Error ? toolErr.message : "Tool execution failed";
              if (isFatalToolError(toolErr)) {
                // Validation failed before execution — emit executed:false BEFORE propagating
                opts?.hooks?.onToolResult?.({
                  tool: toolCall.function.name,
                  success: false,
                  executed: false,
                  failureReason: toolErr.diagnostic?.failureReason ?? errorStr,
                  reason: toolErr.diagnostic?.reason,
                  fields: toolErr.diagnostic?.fields,
                });
                if (mutationReceiptText && mutationEffects) {
                  return {
                    reply: mutationReceiptText,
                    didLogMeal,
                    didMutateMeal,
                    dailySummary: logMealSummary,
                    dailyTargets: successfulGoalTargets,
                    affectedDate: resolvedAffectedDate,
                    loggedMeal,
                    loggedMealToolMessageId,
                    finalReplySource: "renderer",
                    finalReplyShape: classifyPlainReplyShape(mutationReceiptText),
                  };
                }
                throw toolErr;
              }
              opts?.hooks?.onToolResult?.({ tool: toolCall.function.name, success: false, executed: true, failureReason: errorStr });
              toolResults.push({ toolCall, result: `Error: ${errorStr}` });
            }
          }
          messages.push({ role: "assistant", content: null, tool_calls: response.toolCalls });
          for (const { toolCall, result } of toolResults) {
            messages.push({ role: "tool", content: result, tool_call_id: toolCall.id });
          }
          if (mutationEffects) {
            const reply = mutationReceiptText ?? renderCheckedMutationReceipt(mutationEffects);
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return {
              reply,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              dailyTargets: successfulGoalTargets,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(reply),
            };
          }
          if (didLogMeal && loggedMeal && isImageOnlyMessage(userMessage, imageBase64)) {
            const reply = buildImageLoggedReply(loggedMeal);
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return {
              reply,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(reply),
            };
          }
          if (didLogMeal && loggedMeal) {
            const reply = buildImageLoggedReply(loggedMeal);
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return {
              reply,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(reply),
            };
          }
          if (didMutateMeal && loggedMeal) {
            const reply = buildUpdatedMealReply(loggedMeal);
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return {
              reply,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(reply),
            };
          }
          if (didMutateMeal) {
            const reply = buildMutationSuccessReply(resolvedAffectedDate);
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return {
              reply,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(reply),
            };
          }
          if (correctionClarificationReply) {
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return {
              reply: correctionClarificationReply,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(correctionClarificationReply),
            };
          }
          shouldStreamFinalReply = true;
          // Complete the tool-round LLM lifecycle event
          opts?.hooks?.onLLMEnd?.(round + 1, true);
        }
      }

      // Fallback after MAX_ROUNDS
      opts?.hooks?.onFallback?.({ reason: "max_rounds" });
      const maxRoundsFallbackOutcomeContext: FallbackOutcomeContext = {
        fallbackSource: "orchestrator",
        reason: "max_rounds",
      };
      if (mutationReceiptText && mutationEffects) {
        return {
          reply: mutationReceiptText,
          didLogMeal,
          didMutateMeal,
          dailySummary: logMealSummary,
          dailyTargets: successfulGoalTargets,
          affectedDate: resolvedAffectedDate,
          loggedMeal,
          loggedMealToolMessageId,
          finalReplySource: "renderer",
          finalReplyShape: classifyPlainReplyShape(mutationReceiptText),
          fallbackOutcomeContext: maxRoundsFallbackOutcomeContext,
        };
      }
      return {
        reply: FALLBACK,
        didLogMeal,
        didMutateMeal,
        dailySummary: logMealSummary,
        affectedDate: resolvedAffectedDate,
        loggedMeal,
        loggedMealToolMessageId,
        finalReplySource: "fallback",
        finalReplyShape: classifyFallbackReplyShape(FALLBACK),
        fallbackOutcomeContext: maxRoundsFallbackOutcomeContext,
      };
    },
  };
}
