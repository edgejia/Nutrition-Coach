import type { FastifyBaseLogger } from "fastify";
import type { LLMProvider, ChatMessage, ProviderErrorMetadata } from "../llm/types.js";
import { isLLMProviderError } from "../llm/errors.js";
import type { createChatService } from "../services/chat.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { SummaryOutcome } from "../services/summary-outcome.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createDeviceService, DailyTargets } from "../services/device.js";
import type { ChatMutationOutcomeFact } from "../services/chat-mutation-outcomes.js";
import type { createMealCorrectionService } from "../services/meal-correction.js";
import type { createGoalProposalService } from "../services/goal-proposals.js";
import type { createMealDeleteProposalService } from "../services/meal-delete-proposals.js";
import type {
  createMealNumericProposalService,
  MealNumericProposalPayload,
} from "../services/meal-numeric-proposals.js";
import type {
  createProposalActionService,
  ProposalActionRequestAction,
} from "../services/proposal-actions.js";
import type {
  PendingProposalCardInput,
  ProposalActionEventClientMetadata,
  ProposalCardClientMetadata,
  ProposalKind,
} from "../services/proposal-cards.js";
import { MealRevisionPreconditionError } from "../services/meal-transactions.js";
import { DEFAULT_SESSION_ID } from "../services/turn-state.js";
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
import type { ToolPolicyDecisionFact } from "./tool-contract.js";
import type {
  LlmTraceFinalReplyShape,
  LlmTraceFinalReplySource,
} from "./llm-trace.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import {
  createEmptyCommittedMutationState,
  hasCommittedMutationKind,
  mutationOutcomeFactFromEffects,
  projectCommittedMutationState,
  type CommittedMutationProjection,
  type CommittedMutationState,
  type MutationEffects,
} from "./mutation-effects.js";
import {
  renderGoalAuthorityFailureCopy,
  renderGoalCancelCopy,
  renderMealDeleteAuthorityFailureCopy,
  renderMealDeleteCancelCopy,
  renderMealDeleteStaleCopy,
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericCancelCopy,
  renderGuardedMutationReceipt,
  renderProposalKindAmbiguityCopy,
} from "./mutation-receipts.js";
import { isGoalProposalCancel, isGoalProposalConsent } from "./source-text-guard.js";
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
  mealDeleteProposalService?: ReturnType<typeof createMealDeleteProposalService>;
  mealNumericProposalService?: ReturnType<typeof createMealNumericProposalService>;
  proposalActionService?: ReturnType<typeof createProposalActionService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
}

const FALLBACK = "抱歉，我現在無法完成這個請求，請稍後再試。";
const MAX_ROUNDS = 3;
const IMAGE_PLACEHOLDER = "(圖片)";
const CHOICE_CONFIRM_MESSAGES = new Set(["2", "方式2"]);
const HALLUCINATED_CHOICE_RECOVERY_REPLY = "這餐剛剛已先依目前估算完成記錄。若你想更精準，我可以再依份量幫你調整。";
const COMMITTED_MEAL_MUTATION_HISTORY_PATTERN =
  /\[系統已(?:完成餐點(?:記錄|修改|刪除)|(?:記錄|更新|刪除)餐點[：:])/;
const MUTATION_SUCCESS_CLAIM_PATTERNS = {
  goals: /已\s*(?:經\s*)?更新\s*每日目標|已\s*(?:經\s*)?(?:套用|更新)[^。！？\n]{0,12}目標|(?:每日)?目標[^。！？\n]{0,8}已\s*(?:經\s*)?(?:更新|套用)/,
  log: /已\s*(?:經\s*)?記錄|完成\s*記錄/,
  update: /已\s*(?:經\s*)?更新(?!\s*每日目標)|完成\s*更新/,
  delete: /已\s*(?:經\s*)?刪除|完成\s*刪除/,
} as const;
const NO_MUTATION_MEAL_SUCCESS_FALLBACK = "我還沒有把這餐寫入紀錄。請再提供餐點或份量，我再幫你估算。";
// Summary replies often use approximate wording after totals are rounded by the model.
const SUMMARY_HISTORY_CALORIE_TOLERANCE_KCAL = 10;

interface NoMutationSuccessGuardContext {
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

function policyFactPayload(
  policyFact: ToolPolicyDecisionFact | undefined,
  turnId: string | undefined,
) {
  if (!policyFact) {
    return {};
  }
  return {
    policyClass: policyFact.policyClass,
    decision: policyFact.decision,
    ruleId: policyFact.ruleId,
    ...(policyFact.proposalId !== undefined ? { proposalId: policyFact.proposalId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
  };
}

export type OrchestratorResult =
  | ({
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      summaryOutcome?: SummaryOutcome;
      summaryHistoryFacts?: SummaryHistoryFacts;
      dailyTargets?: DailyTargets;
      affectedDate?: string;
      deletedMealId?: string;
      loggedMeal?: LoggedMealReceipt;
      loggedMealToolMessageId?: string;
      mutationState?: CommittedMutationState<LoggedMealReceipt, ProposalActionEventClientMetadata>;
      mutationOutcomeFact?: ChatMutationOutcomeFact;
      proposalCard?: PendingProposalCardInput | ProposalCardClientMetadata;
      proposalActionEvent?: ProposalActionEventClientMetadata;
      assistantReplyPersistence?: "already_persisted";
    } & FinalReplyTraceMetadata)
  | ({
      streamGenerator: AsyncGenerator<string>;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: DailySummary;
      summaryOutcome?: SummaryOutcome;
      summaryHistoryFacts?: SummaryHistoryFacts;
      dailyTargets?: DailyTargets;
      affectedDate?: string;
      deletedMealId?: string;
      loggedMeal?: LoggedMealReceipt;
      loggedMealToolMessageId?: string;
      mutationState?: CommittedMutationState<LoggedMealReceipt, ProposalActionEventClientMetadata>;
      mutationOutcomeFact?: ChatMutationOutcomeFact;
      proposalCard?: PendingProposalCardInput | ProposalCardClientMetadata;
      proposalActionEvent?: ProposalActionEventClientMetadata;
      assistantReplyPersistence?: "already_persisted";
    } & FinalReplyTraceMetadata);

type LoggedMealReceipt = NonNullable<ToolExecutionResult["loggedMeal"]>;

function requireSummaryOutcomeForMealMutation(
  summaryOutcome: SummaryOutcome | undefined,
): SummaryOutcome {
  if (!summaryOutcome) {
    throw new Error("meal mutation succeeded without summaryOutcome");
  }

  return summaryOutcome;
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

function normalizeProposalDecisionText(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, "");
}

function isMealProposalKindText(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /(餐點|餐|meal).*(修正|修改|更新|提案)|(?:修正|修改|更新).*(餐點|餐|meal)/i.test(normalized);
}

function isGoalProposalKindText(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /(每日)?目標|goal/i.test(normalized);
}

function isMealDeleteKindText(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /(刪除|删除|移除|delete).*(餐點|餐|meal)|(?:餐點|餐|meal).*(刪除|删除|移除|delete)/i.test(normalized);
}

function hasMealDeleteVerb(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /(刪除|删除|移除|delete)/i.test(normalized);
}

function isBareProposalConfirmation(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /^(確認|確定)$/.test(normalized);
}

function isMealProposalCancel(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /(取消|不要|不用|不套用|先不用|先不要|no)/i.test(normalized)
    && isMealProposalKindText(message);
}

function isMealDeleteProposalCancel(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /(取消|不要|不用|不刪|不删|不移除|別刪|别删|先別刪|先别删|不想刪|不想删|先不用|先不要|no|not)/i.test(normalized)
    && (isMealDeleteKindText(message) || hasMealDeleteVerb(message));
}

function isGoalKindCancel(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /(取消|不要|不用|不套用|先不用|先不要|no)/i.test(normalized)
    && isGoalProposalKindText(message);
}

function isMealProposalApproval(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  if (isGoalProposalCancel(message)) return false;
  if (/套用(?:這組)?(?:餐點)?(?:修正|修改)|套用餐點|applymeal/i.test(normalized)) return true;
  return isMealProposalKindText(message) && isGoalProposalConsent(message);
}

function isMealDeleteProposalApproval(
  message: string,
  options: { requireExplicitDelete?: boolean } = {},
): boolean {
  const normalized = normalizeProposalDecisionText(message);
  if (isGoalProposalCancel(message) || isMealDeleteProposalCancel(message)) return false;
  const explicitDelete = /(確認|確定)?(刪除|删除|移除)(這筆|該筆)?(餐點|餐|meal)?|delete(?:this)?meal/i.test(normalized);
  if (explicitDelete) {
    return true;
  }
  if (options.requireExplicitDelete) {
    return false;
  }
  if (isBareProposalConfirmation(message)) return true;
  return isMealDeleteKindText(message) && isGoalProposalConsent(message);
}

function isGoalKindApproval(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  if (isGoalProposalCancel(message)) return false;
  return /套用(?:每日)?目標|目標更新|applygoal/i.test(normalized);
}

function buildMealNumericProposalUpdateInput(
  proposal: MealNumericProposalPayload,
): Parameters<ReturnType<typeof createMealCorrectionService>["updateMeal"]>[2] {
  return proposal.updateInput
    ? { patch: proposal.updateInput }
    : { items: proposal.items?.map((item) => ({
      foodName: item.foodName,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    })) ?? [] };
}

function buildLoggedMealFromMealProposalUpdate(
  updatedMeal: Awaited<ReturnType<ReturnType<typeof createMealCorrectionService>["updateMeal"]>>["updatedMeal"],
): LoggedMealReceipt {
  return {
    mealId: updatedMeal.id,
    mealRevisionId: updatedMeal.mealRevisionId,
    dateKey: formatLocalDate(new Date(updatedMeal.loggedAt)),
    loggedAt: updatedMeal.loggedAt,
    ...(updatedMeal.mealPeriod ? { mealPeriod: updatedMeal.mealPeriod } : {}),
    imageAssetId: null,
    imageUrl: null,
    foodName: updatedMeal.foodName,
    calories: updatedMeal.calories,
    protein: updatedMeal.protein,
    carbs: updatedMeal.carbs,
    fat: updatedMeal.fat,
    itemCount: updatedMeal.itemCount,
    items: updatedMeal.items,
    countedSources: [],
    excludedSources: [],
    usedConservativeAssumption: false,
  };
}

function renderMealProposalStaleCopy(): string {
  return "這筆餐點已經有較新的紀錄，請重新整理後再修改。";
}

export function buildPartialSuccessLoggedReply(loggedMeal: LoggedMealReceipt): string {
  return `已完成記錄，但回覆生成失敗。${buildTrustedProteinExplanation(loggedMeal)} 請稍後確認今日攝取摘要。`;
}

function appendMutationReceiptText(reply: string, receipt: string | undefined): string {
  if (!receipt) return reply;
  if (reply.includes(receipt)) return reply;
  return `${reply}\n\n${receipt}`;
}

function mutationOutcomeFactFields(
  mutationOutcomeFact: ChatMutationOutcomeFact | undefined,
): { mutationOutcomeFact?: ChatMutationOutcomeFact } {
  return mutationOutcomeFact ? { mutationOutcomeFact } : {};
}

function deletedMealIdFields(deletedMealId: string | undefined): { deletedMealId?: string } {
  return deletedMealId ? { deletedMealId } : {};
}

function mutationStateFields(
  mutationState: CommittedMutationState<LoggedMealReceipt, ProposalActionEventClientMetadata>,
): { mutationState?: CommittedMutationState<LoggedMealReceipt, ProposalActionEventClientMetadata> } {
  return hasCommittedMutationKind(mutationState) ? { mutationState } : {};
}

function projectedMutationResultFields(
  mutationState: CommittedMutationState<LoggedMealReceipt, ProposalActionEventClientMetadata>,
) {
  const projection = projectCommittedMutationState(mutationState);
  return {
    didLogMeal: projection.didLogMeal,
    didMutateMeal: projection.didMutateMeal,
    ...(projection.dailySummary ? { dailySummary: projection.dailySummary } : {}),
    ...(projection.summaryOutcome ? { summaryOutcome: projection.summaryOutcome } : {}),
    ...(projection.dailyTargets ? { dailyTargets: projection.dailyTargets } : {}),
    ...(projection.affectedDate ? { affectedDate: projection.affectedDate } : {}),
    ...(projection.deletedMealId ? { deletedMealId: projection.deletedMealId } : {}),
    ...(projection.loggedMeal ? { loggedMeal: projection.loggedMeal } : {}),
    ...(projection.loggedMealToolMessageId ? { loggedMealToolMessageId: projection.loggedMealToolMessageId } : {}),
    ...(projection.mutationOutcomeFact ? { mutationOutcomeFact: projection.mutationOutcomeFact } : {}),
    ...mutationStateFields(mutationState),
  };
}

function classifyPlainReplyShape(reply: string): LlmTraceFinalReplyShape {
  return reply.trim().length > 0 ? "plain_text" : "empty_or_missing";
}

function classifyFallbackReplyShape(reply: string): LlmTraceFinalReplyShape {
  return reply.trim().length > 0 ? "fallback_text" : "empty_or_missing";
}

export function guardNoMutationSuccessClaim(
  reply: string,
  mutationProjection: Pick<CommittedMutationProjection, "mutationKind" | "hasCommittedMutation">,
  context: NoMutationSuccessGuardContext = {},
): string {
  const claimedKinds = detectMutationSuccessClaimKinds(reply);
  if (claimedKinds.length === 0) {
    return reply;
  }
  if (
    claimedKinds.every((kind) => kind === "log")
    && !mutationProjection.hasCommittedMutation
    && isFactGroundedSummaryHistoryReply(reply, context.summaryHistoryFacts)
  ) {
    return reply;
  }
  if (
    mutationProjection.mutationKind
    && claimedKinds.every((kind) => kind === mutationProjection.mutationKind)
  ) {
    return reply;
  }
  return noMutationSuccessFallback(claimedKinds);
}

function detectMutationSuccessClaimKinds(reply: string): Array<NonNullable<CommittedMutationProjection["mutationKind"]>> {
  const kinds: Array<NonNullable<CommittedMutationProjection["mutationKind"]>> = [];
  for (const kind of ["goals", "log", "update", "delete"] as const) {
    MUTATION_SUCCESS_CLAIM_PATTERNS[kind].lastIndex = 0;
    if (MUTATION_SUCCESS_CLAIM_PATTERNS[kind].test(reply)) {
      kinds.push(kind);
    }
  }
  return kinds;
}

function noMutationSuccessFallback(
  claimedKinds: Array<NonNullable<CommittedMutationProjection["mutationKind"]>>,
): string {
  const uniqueKinds = new Set(claimedKinds);
  if (uniqueKinds.size === 1) {
    if (uniqueKinds.has("goals")) {
      return renderGoalAuthorityFailureCopy();
    }
    if (uniqueKinds.has("delete")) {
      return renderMealDeleteAuthorityFailureCopy();
    }
    if (uniqueKinds.has("update")) {
      return renderMealNumericAuthorityFailureCopy();
    }
  }
  return NO_MUTATION_MEAL_SUCCESS_FALLBACK;
}

function isFactGroundedSummaryHistoryReply(reply: string, facts: SummaryHistoryFacts | undefined): boolean {
  if (!facts?.dailySummary) {
    return false;
  }

  const claimedMealCount = extractClaimedMealCount(reply);
  const claimedCalories = extractClaimedCalories(reply);
  const claimedMealFacts = extractClaimedMealFacts(reply);
  if (
    claimedMealFacts.length === 0
    && claimedMealCount !== undefined
    && claimedCalories !== undefined
    && claimedMealCount === facts.dailySummary.mealCount
    && caloriesCloseEnough(claimedCalories, facts.dailySummary.totalCalories)
  ) {
    return true;
  }
  if (facts.dailySummary.mealCount <= 0 || facts.meals.length === 0) {
    return false;
  }
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
    const hasRecentMealMutationSummary = COMMITTED_MEAL_MUTATION_HISTORY_PATTERN.test(lastAssistantContent);
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
  turnId?: string;
  log?: FastifyBaseLogger;
  proposalContext?: ProposalEditContext;
}

export interface ProposalEditContext {
  proposalId: string;
  kind: ProposalKind;
  action: "edit";
}

interface TypedProposalDecision {
  proposalId: string;
  kind: ProposalKind;
  action: ProposalActionRequestAction;
}

function mealProposalKind(proposal: MealNumericProposalPayload): Extract<ProposalKind, "meal_numeric" | "meal_estimate"> {
  return proposal.provenance === "model_estimate" ? "meal_estimate" : "meal_numeric";
}

function isSelectedProposalGenericReject(message: string): boolean {
  const normalized = normalizeProposalDecisionText(message);
  return /^(取消(?:這個|此)?提案|不要(?:這個|此)?提案|不套用|先不用|先不要)$/i.test(normalized);
}

function selectedProposalReject(message: string, kind: ProposalKind): boolean {
  if (isSelectedProposalGenericReject(message)) {
    return true;
  }
  if (kind === "goal") {
    return isGoalProposalCancel(message) || isGoalKindCancel(message);
  }
  if (kind === "meal_delete") {
    return isGoalProposalCancel(message) || isMealDeleteProposalCancel(message);
  }
  return isGoalProposalCancel(message) || isMealProposalCancel(message);
}

function selectedProposalApprove(message: string, kind: ProposalKind): boolean {
  if (kind === "goal") {
    return isGoalProposalConsent(message) || isGoalKindApproval(message);
  }
  if (kind === "meal_delete") {
    return isMealDeleteProposalApproval(message, { requireExplicitDelete: true });
  }
  return isGoalProposalConsent(message) || isMealProposalApproval(message);
}

function selectedProposalToolName(kind: ProposalKind): string {
  if (kind === "goal") return "update_goals";
  if (kind === "meal_delete") return "delete_meal";
  return "propose_meal_numeric_correction";
}

function selectedProposalFallbackReply(kind: ProposalKind, action: ProposalActionRequestAction): string {
  if (action === "approve") {
    if (kind === "goal") return renderGoalAuthorityFailureCopy();
    if (kind === "meal_delete") return renderMealDeleteAuthorityFailureCopy();
    return renderMealNumericAuthorityFailureCopy();
  }
  if (kind === "goal") return renderGoalCancelCopy();
  if (kind === "meal_delete") return renderMealDeleteCancelCopy();
  return renderMealNumericCancelCopy();
}

function buildTypedActionResult(input: {
  actionResult: Awaited<ReturnType<ReturnType<typeof createProposalActionService>["handleAction"]>>;
  fallbackReply: string;
}): OrchestratorResult {
  const reply = input.actionResult.ok
    ? input.actionResult.reply ?? input.actionResult.proposalActionEvent.transcriptCopy
    : input.actionResult.proposalCard?.lapseCopy ?? input.fallbackReply;

  return {
    reply,
    didLogMeal: false,
    didMutateMeal: input.actionResult.didMutateMeal,
    ...(input.actionResult.ok && input.actionResult.dailyTargets ? { dailyTargets: input.actionResult.dailyTargets } : {}),
    ...(input.actionResult.ok && input.actionResult.deletedMealId ? { deletedMealId: input.actionResult.deletedMealId } : {}),
    ...(input.actionResult.ok && input.actionResult.affectedDate ? { affectedDate: input.actionResult.affectedDate } : {}),
    ...(input.actionResult.ok && input.actionResult.summaryOutcome ? { summaryOutcome: input.actionResult.summaryOutcome } : {}),
    ...(input.actionResult.ok && input.actionResult.dailySummary ? { dailySummary: input.actionResult.dailySummary } : {}),
    ...(input.actionResult.ok && input.actionResult.mutationOutcomeFact ? { mutationOutcomeFact: input.actionResult.mutationOutcomeFact } : {}),
    ...(input.actionResult.proposalCard ? { proposalCard: input.actionResult.proposalCard } : {}),
    ...(input.actionResult.ok ? { proposalActionEvent: input.actionResult.proposalActionEvent } : {}),
    ...(input.actionResult.ok && input.actionResult.reply ? { assistantReplyPersistence: "already_persisted" as const } : {}),
    finalReplySource: "renderer",
    finalReplyShape: classifyPlainReplyShape(reply),
  };
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
      const savedUserMessage = await chatService.saveMessage(deviceId, "user", userMessage, { imagePath });
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

      const activeGoalProposal = deps.goalProposalService
        ? await deps.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID })
        : undefined;
      const activeMealProposal = deps.mealNumericProposalService
        ? await deps.mealNumericProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID })
        : undefined;
      const activeMealDeleteProposal = deps.mealDeleteProposalService
        ? await deps.mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID })
        : undefined;
      const activeMealMutationProposal = activeMealProposal || activeMealDeleteProposal;

      const activeProposalCount = [
        activeGoalProposal,
        activeMealProposal,
        activeMealDeleteProposal,
      ].filter(Boolean).length;

      const runTypedProposalDecision = async (
        decision: TypedProposalDecision,
        fallbackReply: string,
        toolName: string,
      ) => {
        if (!deps.proposalActionService) {
          return undefined;
        }
        const actionResult = await deps.proposalActionService.handleAction({
          deviceId,
          proposalId: decision.proposalId,
          kind: decision.kind,
          action: decision.action,
          actionMessageId: savedUserMessage.id,
        });
        opts?.hooks?.onToolResult?.({
          tool: toolName,
          success: actionResult.ok,
          executed: actionResult.ok && decision.action === "approve",
          summary: `proposalAction: ${actionResult.status}`,
          ...policyFactPayload({
            tool: toolName,
            policyClass: "confirm-first",
            decision: actionResult.ok ? "allowed" : "blocked",
            ruleId: `typed_${decision.kind}_${decision.action}`,
            proposalId: decision.proposalId,
          }, opts?.turnId),
        });
        return buildTypedActionResult({ actionResult, fallbackReply });
      };

      if (opts?.proposalContext) {
        const validation = await deps.proposalActionService?.validateEditContext({
          deviceId,
          proposalId: opts.proposalContext.proposalId,
          kind: opts.proposalContext.kind,
        });
        if (validation && !validation.ok) {
          return buildTypedActionResult({
            actionResult: validation,
            fallbackReply: validation.proposalCard?.lapseCopy ?? renderProposalKindAmbiguityCopy(),
          });
        }
        const selectedAction = selectedProposalReject(userMessage, opts.proposalContext.kind)
          ? "reject"
          : selectedProposalApprove(userMessage, opts.proposalContext.kind)
            ? "approve"
            : undefined;
        if (selectedAction) {
          const typedResult = await runTypedProposalDecision(
            {
              proposalId: opts.proposalContext.proposalId,
              kind: opts.proposalContext.kind,
              action: selectedAction,
            },
            selectedProposalFallbackReply(opts.proposalContext.kind, selectedAction),
            selectedProposalToolName(opts.proposalContext.kind),
          );
          if (typedResult) return typedResult;
        }
      }

      if (activeMealDeleteProposal && isMealDeleteProposalCancel(userMessage)) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeMealDeleteProposal.proposalId, kind: "meal_delete", action: "reject" },
          renderMealDeleteCancelCopy(),
          "delete_meal",
        );
        if (typedResult) return typedResult;
      }

      if (activeMealProposal && isMealProposalCancel(userMessage)) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeMealProposal.proposalId, kind: mealProposalKind(activeMealProposal), action: "reject" },
          renderMealNumericCancelCopy(),
          "propose_meal_numeric_correction",
        );
        if (typedResult) return typedResult;
      }

      if (activeGoalProposal && isGoalKindCancel(userMessage)) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeGoalProposal.proposalId, kind: "goal", action: "reject" },
          renderGoalCancelCopy(),
          "update_goals",
        );
        if (typedResult) return typedResult;
      }

      if (isGoalProposalCancel(userMessage) && activeProposalCount > 1) {
        const reply = renderProposalKindAmbiguityCopy();
        return {
          reply,
          didLogMeal: false,
          didMutateMeal: false,
          finalReplySource: "renderer",
          finalReplyShape: classifyPlainReplyShape(reply),
        };
      }

      if (isGoalProposalCancel(userMessage) && activeGoalProposal) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeGoalProposal.proposalId, kind: "goal", action: "reject" },
          renderGoalCancelCopy(),
          "update_goals",
        );
        if (typedResult) return typedResult;
      }

      if (isGoalProposalCancel(userMessage) && activeMealProposal) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeMealProposal.proposalId, kind: mealProposalKind(activeMealProposal), action: "reject" },
          renderMealNumericCancelCopy(),
          "propose_meal_numeric_correction",
        );
        if (typedResult) return typedResult;
      }

      if (isGoalProposalCancel(userMessage) && activeMealDeleteProposal) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeMealDeleteProposal.proposalId, kind: "meal_delete", action: "reject" },
          renderMealDeleteCancelCopy(),
          "delete_meal",
        );
        if (typedResult) return typedResult;
      }

      if (
        activeMealDeleteProposal
        && (
          isMealDeleteProposalApproval(userMessage, { requireExplicitDelete: Boolean(activeGoalProposal) })
          || (!activeGoalProposal && isGoalProposalConsent(userMessage))
        )
      ) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeMealDeleteProposal.proposalId, kind: "meal_delete", action: "approve" },
          renderMealDeleteAuthorityFailureCopy(),
          "delete_meal",
        );
        if (typedResult) return typedResult;
      }

      if (
        activeGoalProposal
        && activeMealMutationProposal
        && (isGoalProposalConsent(userMessage) || isBareProposalConfirmation(userMessage))
        && !isMealProposalApproval(userMessage)
        && !isMealDeleteProposalApproval(userMessage, { requireExplicitDelete: true })
        && !isGoalKindApproval(userMessage)
      ) {
        const reply = renderProposalKindAmbiguityCopy();
        return {
          reply,
          didLogMeal: false,
          didMutateMeal: false,
          finalReplySource: "renderer",
          finalReplyShape: classifyPlainReplyShape(reply),
        };
      }

      if (
        activeMealProposal
        && (isMealProposalApproval(userMessage) || (!activeGoalProposal && isGoalProposalConsent(userMessage)))
      ) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeMealProposal.proposalId, kind: mealProposalKind(activeMealProposal), action: "approve" },
          renderMealNumericAuthorityFailureCopy(),
          "propose_meal_numeric_correction",
        );
        if (typedResult) return typedResult;
      }

      if (
        activeGoalProposal
        && !activeMealMutationProposal
        && (isGoalProposalConsent(userMessage) || isGoalKindApproval(userMessage))
      ) {
        const typedResult = await runTypedProposalDecision(
          { proposalId: activeGoalProposal.proposalId, kind: "goal", action: "approve" },
          renderGoalAuthorityFailureCopy(),
          "update_goals",
        );
        if (typedResult) return typedResult;
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
      const toolSessionState = {
        resolvedMealTargets: [] as Array<{ mealId: string; mealRevisionId: string }>,
      };

      let didLogMeal = false;
      let didMutateMeal = false;
      let logMealSummary: DailySummary | undefined;
      let mealSummaryOutcome: SummaryOutcome | undefined;
      let summaryHistoryFacts: SummaryHistoryFacts | undefined;
      let shouldStreamFinalReply = false;
      let successfulGoalTargets: DailyTargets | undefined;
      let mutationEffects: MutationEffects | undefined;
      let mutationOutcomeFact: ChatMutationOutcomeFact | undefined;
      let deletedMealId: string | undefined;
      let mutationReceiptText: string | undefined;
      let resolvedAffectedDate: string | undefined;
      let committedMutationState = createEmptyCommittedMutationState<LoggedMealReceipt, ProposalActionEventClientMetadata>();
      let loggedMeal:
        | LoggedMealReceipt
        | undefined;
      let loggedMealToolMessageId: string | undefined;
      let lastTool: string | undefined;
      let lastValidationFailureTool: string | undefined;
      const renderReceipt = (effects: MutationEffects) =>
        renderGuardedMutationReceipt(effects, {
          operation: "orchestrator_receipt",
          verb: effects.kind,
          ...(opts?.turnId !== undefined ? { turnId: opts.turnId } : {}),
          ...(opts?.log !== undefined ? { log: opts.log } : {}),
        });
      const updateCommittedMutationState = () => {
        committedMutationState = {
          ...(mutationEffects ? { effects: mutationEffects } : {}),
          ...(mutationReceiptText ? { receiptText: mutationReceiptText } : {}),
          ...(mutationOutcomeFact ? { mutationOutcomeFact } : {}),
          ...(resolvedAffectedDate ? { affectedDate: resolvedAffectedDate } : {}),
          ...(deletedMealId ? { deletedMealId } : {}),
          ...(loggedMeal ? { loggedMeal } : {}),
          ...(loggedMealToolMessageId ? { loggedMealToolMessageId } : {}),
          ...(logMealSummary ? { dailySummary: logMealSummary } : {}),
          ...(mealSummaryOutcome ? { summaryOutcome: mealSummaryOutcome } : {}),
          ...(successfulGoalTargets ? { dailyTargets: successfulGoalTargets } : {}),
        };
        const projection = projectCommittedMutationState(committedMutationState);
        didLogMeal = projection.didLogMeal;
        didMutateMeal = projection.didMutateMeal;
      };

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
                summaryOutcome: mealSummaryOutcome,
                summaryHistoryFacts,
                dailyTargets: successfulGoalTargets,
                affectedDate: resolvedAffectedDate,
                loggedMeal,
                loggedMealToolMessageId,
                ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
                summaryOutcome: mealSummaryOutcome,
                summaryHistoryFacts,
                dailyTargets: successfulGoalTargets,
                affectedDate: resolvedAffectedDate,
                loggedMeal,
                loggedMealToolMessageId,
                ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
              summaryOutcome: mealSummaryOutcome,
              dailyTargets: successfulGoalTargets,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
              dailySummary: logMealSummary,
              summaryOutcome: mealSummaryOutcome,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
            summaryOutcome: mealSummaryOutcome,
            affectedDate: resolvedAffectedDate,
            loggedMeal,
            loggedMealToolMessageId,
            ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
            finalReplySource: "fallback",
            finalReplyShape: classifyFallbackReplyShape(errorMsg),
            providerFallbackContext,
            fallbackOutcomeContext,
          };
        }

        if (response.content !== undefined) {
          opts?.hooks?.onLLMEnd?.(round + 1, false);
          const rawReply = summaryHistoryFacts
            ? composeSummaryHistoryReply(summaryHistoryFacts, response.content)
            : response.content;
          const reply = guardNoMutationSuccessClaim(
            rawReply,
            projectCommittedMutationState(committedMutationState),
            { summaryHistoryFacts },
          );
          const finalReplySource = summaryHistoryFacts && reply === rawReply
            ? "renderer"
            : reply === response.content ? "model" : "fallback";
          return {
            reply,
            didLogMeal,
            didMutateMeal,
            dailySummary: logMealSummary,
            summaryOutcome: mealSummaryOutcome,
            summaryHistoryFacts,
            dailyTargets: successfulGoalTargets,
            affectedDate: resolvedAffectedDate,
            loggedMeal,
            loggedMealToolMessageId,
            ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
                opts?.onStatus?.("準備刪除確認...");
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
                summaryOutcome: toolSummaryOutcome,
                loggedMeal: toolLoggedMeal,
                success,
                executed,
                failureReason,
                updatedFields,
                publishedEvents,
                dailyTargets,
                affectedDate,
                mealMutationKind,
                deletedMeal,
                summaryHistoryFacts: toolSummaryHistoryFacts,
                controlledReply,
                proposalCard,
                validationDiagnostic,
                policyFact,
              } = await executeTool(toolCall, deviceId, {
                foodLoggingService: deps.foodLoggingService,
                summaryService: deps.summaryService,
                mealCorrectionService: deps.mealCorrectionService,
                deviceService: deps.deviceService,
                goalProposalService: deps.goalProposalService,
                mealDeleteProposalService: deps.mealDeleteProposalService,
                mealNumericProposalService: deps.mealNumericProposalService,
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
                  executed: executed ?? success !== false,
                  failureReason,
                  summary,
                  updatedFields,
                  publishedEvents,
                  ...policyFactPayload(policyFact, opts?.turnId),
                });
                opts?.hooks?.onLLMEnd?.(round + 1, true);
                if (hasCommittedMutationKind(committedMutationState)) {
                  return {
                    reply: controlledReply.text,
                    ...projectedMutationResultFields(committedMutationState),
                    ...(proposalCard ? { proposalCard } : {}),
                    finalReplySource: controlledReply.source,
                    finalReplyShape: classifyPlainReplyShape(controlledReply.text),
                  };
                }
                return {
                  reply: controlledReply.text,
                  didLogMeal: false,
                  didMutateMeal: false,
                  ...(proposalCard ? { proposalCard } : {}),
                  finalReplySource: controlledReply.source,
                  finalReplyShape: classifyPlainReplyShape(controlledReply.text),
                };
              }
              if (success === false) {
                lastValidationFailureTool = validationDiagnostic ? toolCall.function.name : undefined;
                // Phase 83 (D-02): log_food schema_validation failures now reach
                // this controlled feedback path instead of the FatalToolError
                // catch below. executeTool supplies typed, redacted diagnostics
                // (no serialized tool JSON is reparsed here — Phase 68 D-01) so
                // the log_food_validation_failed event keeps its sanitized
                // field metadata (T-83-03).
                opts?.hooks?.onToolResult?.({
                  tool: toolCall.function.name,
                  success: false,
                  executed: false,
                  failureReason,
                  summary,
                  updatedFields,
                  ...(validationDiagnostic ? { reason: validationDiagnostic.reason } : {}),
                  ...(validationDiagnostic?.fields ? { fields: validationDiagnostic.fields } : {}),
                  ...policyFactPayload(policyFact, opts?.turnId),
                });
                await chatService.saveMessage(deviceId, "tool", summary, { toolName: toolCall.function.name });
                toolResults.push({ toolCall, result });
                continue;
              }
              lastValidationFailureTool = undefined;
              if (affectedDate) {
                resolvedAffectedDate = affectedDate;
              }
              if (toolCall.function.name === "log_food") {
                didLogMeal = true;
                didMutateMeal = true;
                mealSummaryOutcome = requireSummaryOutcomeForMealMutation(toolSummaryOutcome);
                logMealSummary = dailySummary;
                loggedMeal = toolLoggedMeal;
                if (!toolLoggedMeal) {
                  throw new Error("log_food succeeded without loggedMeal");
                }
                mutationEffects = {
                  kind: "log",
                  affectedDate: affectedDate ?? toolLoggedMeal.dateKey,
                  summaryOutcome: mealSummaryOutcome,
                  committedTargets: getDeviceTargets(device),
                  meal: toolLoggedMeal,
                };
                mutationOutcomeFact = mutationOutcomeFactFromEffects(mutationEffects);
                mutationReceiptText = renderReceipt(mutationEffects);
                updateCommittedMutationState();
              }
              if (toolCall.function.name === "get_daily_summary" && dailySummary) {
                logMealSummary = dailySummary;
                summaryHistoryFacts = toolSummaryHistoryFacts
                  ?? await buildSummaryHistoryFacts(deps, deviceId, dailySummary);
              }
              if (mealMutationKind === "update" || mealMutationKind === "delete") {
                didMutateMeal = true;
                mealSummaryOutcome = requireSummaryOutcomeForMealMutation(toolSummaryOutcome);
                logMealSummary = dailySummary;
                if (mealMutationKind === "update") {
                  loggedMeal = toolLoggedMeal;
                  if (!toolLoggedMeal) {
                    throw new Error("update_meal succeeded without loggedMeal");
                  }
                  mutationEffects = {
                    kind: "update",
                    affectedDate: affectedDate ?? toolLoggedMeal.dateKey,
                    summaryOutcome: mealSummaryOutcome,
                    committedTargets: getDeviceTargets(device),
                    meal: toolLoggedMeal,
                  };
                  mutationOutcomeFact = mutationOutcomeFactFromEffects(mutationEffects);
                  mutationReceiptText = renderReceipt(mutationEffects);
                  updateCommittedMutationState();
                } else {
                  if (!deletedMeal) {
                    throw new Error("delete_meal succeeded without deletedMeal");
                  }
                  mutationEffects = {
                    kind: "delete",
                    affectedDate: affectedDate ?? deletedMeal.dateKey,
                    summaryOutcome: mealSummaryOutcome,
                    committedTargets: getDeviceTargets(device),
                    deletedMeal,
                  };
                  deletedMealId = deletedMeal.mealId;
                  mutationOutcomeFact = mutationOutcomeFactFromEffects(mutationEffects);
                  mutationReceiptText = renderReceipt(mutationEffects);
                  updateCommittedMutationState();
                }
              }
              if (toolCall.function.name === "update_goals") {
                successfulGoalTargets = dailyTargets;
                if (!dailyTargets) {
                  throw new Error("update_goals succeeded without dailyTargets");
                }
                let committedSummary: DailySummary | undefined;
                try {
                  committedSummary = await deps.summaryService.getDailySummary(deviceId, currentAppDate());
                } catch {
                  // Goal targets are already committed; summary lookup is only receipt context.
                }
                mutationEffects = {
                  kind: "goals",
                  affectedDate: formatLocalDate(currentAppDate()),
                  ...(committedSummary ? { committedSummary } : {}),
                  committedTargets: dailyTargets,
                  targets: dailyTargets,
                  updatedFields: updatedFields as Array<keyof DailyTargets>,
                };
                mutationOutcomeFact = mutationOutcomeFactFromEffects(mutationEffects);
                mutationReceiptText = renderReceipt(mutationEffects);
                updateCommittedMutationState();
              }
              opts?.hooks?.onToolResult?.({
                tool: toolCall.function.name,
                success: true,
                executed: true,
                summary,
                updatedFields,
                publishedEvents,
                ...policyFactPayload(policyFact, opts?.turnId),
              });
              const toolMessage = await chatService.saveMessage(deviceId, "tool", summary, { toolName: toolCall.function.name });
              if (toolLoggedMeal) {
                loggedMealToolMessageId = toolMessage.id;
                updateCommittedMutationState();
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
                  ...policyFactPayload(toolErr.diagnostic?.policyFact, opts?.turnId),
                });
                if (mutationReceiptText && mutationEffects) {
                  return {
                    reply: mutationReceiptText,
                    didLogMeal,
                    didMutateMeal,
                    dailySummary: logMealSummary,
                    summaryOutcome: mealSummaryOutcome,
                    dailyTargets: successfulGoalTargets,
                    affectedDate: resolvedAffectedDate,
                    loggedMeal,
                    loggedMealToolMessageId,
                    ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
                    finalReplySource: "renderer",
                    finalReplyShape: classifyPlainReplyShape(mutationReceiptText),
                  };
                }
                throw toolErr;
              }
              opts?.hooks?.onToolResult?.({
                tool: toolCall.function.name,
                success: false,
                executed: true,
                failureReason: errorStr,
              });
              toolResults.push({ toolCall, result: `Error: ${errorStr}` });
            }
          }
          messages.push({ role: "assistant", content: null, tool_calls: response.toolCalls });
          for (const { toolCall, result } of toolResults) {
            messages.push({ role: "tool", content: result, tool_call_id: toolCall.id });
          }
          if (mutationEffects) {
            const reply = mutationReceiptText ?? renderReceipt(mutationEffects);
            opts?.hooks?.onLLMEnd?.(round + 1, true);
            return {
              reply,
              didLogMeal,
              didMutateMeal,
              dailySummary: logMealSummary,
              summaryOutcome: mealSummaryOutcome,
              dailyTargets: successfulGoalTargets,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
              summaryOutcome: mealSummaryOutcome,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
              summaryOutcome: mealSummaryOutcome,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
              summaryOutcome: mealSummaryOutcome,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
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
              summaryOutcome: mealSummaryOutcome,
              affectedDate: resolvedAffectedDate,
              loggedMeal,
              loggedMealToolMessageId,
              ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
              finalReplySource: "renderer",
              finalReplyShape: classifyPlainReplyShape(reply),
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
          summaryOutcome: mealSummaryOutcome,
          dailyTargets: successfulGoalTargets,
          affectedDate: resolvedAffectedDate,
          loggedMeal,
          loggedMealToolMessageId,
          ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
          finalReplySource: "renderer",
          finalReplyShape: classifyPlainReplyShape(mutationReceiptText),
          fallbackOutcomeContext: maxRoundsFallbackOutcomeContext,
        };
      }
      if (lastValidationFailureTool === "propose_meal_estimate") {
        const reply = renderMealNumericAuthorityFailureCopy();
        return {
          reply,
          didLogMeal,
          didMutateMeal,
          dailySummary: logMealSummary,
          summaryOutcome: mealSummaryOutcome,
          affectedDate: resolvedAffectedDate,
          loggedMeal,
          loggedMealToolMessageId,
          ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
          finalReplySource: "renderer",
          finalReplyShape: classifyPlainReplyShape(reply),
          fallbackOutcomeContext: maxRoundsFallbackOutcomeContext,
        };
      }
      return {
        reply: FALLBACK,
        didLogMeal,
        didMutateMeal,
        dailySummary: logMealSummary,
        summaryOutcome: mealSummaryOutcome,
        affectedDate: resolvedAffectedDate,
        loggedMeal,
        loggedMealToolMessageId,
        ...mutationOutcomeFactFields(mutationOutcomeFact),
                ...deletedMealIdFields(deletedMealId),
                ...mutationStateFields(committedMutationState),
        finalReplySource: "fallback",
        finalReplyShape: classifyFallbackReplyShape(FALLBACK),
        fallbackOutcomeContext: maxRoundsFallbackOutcomeContext,
      };
    },
  };
}
