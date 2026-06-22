import { PassThrough } from "node:stream";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyBaseLogger } from "fastify";
import type { createOrchestrator, ProposalEditContext } from "../orchestrator/index.js";
import {
  composeSummaryHistoryReply,
  type SummaryHistoryFacts,
} from "../orchestrator/summary-history-renderer.js";
import { buildAssetUrl, makeAssetRef, parseAssetRef, type createAssetService } from "../services/assets.js";
import type { createChatService, MealReceiptStatus } from "../services/chat.js";
import type { createDeviceService } from "../services/device.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { DailySummary } from "../services/summary.js";
import { CHOICE_PROMPT_PATTERN } from "../orchestrator/patterns.js";
import { createStructuredHooks } from "../orchestrator/hooks.js";
import type { OrchestratorHooks } from "../orchestrator/hooks.js";
import { buildPartialSuccessLoggedReply, guardNoMutationSuccessClaim } from "../orchestrator/index.js";
import type {
  LlmTraceFinalReplyShape,
  LlmTraceFinalReplySource,
  LlmTraceRecorder,
} from "../orchestrator/llm-trace.js";
import type { ToolExecutionResult } from "../orchestrator/tools.js";
import {
  projectCommittedMutationState,
  type CommittedMutationProjection,
  type CommittedMutationState,
} from "../orchestrator/mutation-effects.js";
import { config } from "../config.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { normalizeMealPeriod } from "../lib/meal-period.js";
import { ALLOWED_IMAGE_MIME_TYPES, validateImageBytes } from "../lib/image-validation.js";
import { createStreamingSanitizer, sanitizeReply } from "../lib/reply-sanitizer.js";
import { isLLMProviderError } from "../llm/errors.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import type { SummaryOutcome } from "../services/summary-outcome.js";
import {
  logChatRouteFallback,
  logChatTurnCompleted,
  logOwnershipBypassBlocked,
  sanitizeRouteCatchError,
  type RouteCatchSite,
  type RouteFallbackReason,
  type RouteFallbackSource,
} from "../observability/events.js";
import type { ProviderErrorMetadata } from "../llm/types.js";
import type { ChatMutationOutcomeFact } from "../services/chat-mutation-outcomes.js";
import {
  projectProposalCardForClient,
  PROPOSAL_KINDS,
  type PendingProposalCardInput,
  type ProposalActionEventClientMetadata,
  type ProposalCardClientMetadata,
  type ProposalKind,
  type ProposalLane,
  type createProposalCardService,
} from "../services/proposal-cards.js";
import {
  renderProposalSupersededCopy,
} from "../orchestrator/mutation-receipts.js";
import type { createGoalProposalService } from "../services/goal-proposals.js";
import type { createMealNumericProposalService } from "../services/meal-numeric-proposals.js";
import type { createMealDeleteProposalService } from "../services/meal-delete-proposals.js";
import { DEFAULT_SESSION_ID } from "../services/turn-state.js";
import {
  getProtectedOwner,
  PROTECTED_ROUTE_META,
  registerProtectedRoute,
} from "./protected-route.js";

interface Deps {
  orchestrator: ReturnType<typeof createOrchestrator>;
  assetService: ReturnType<typeof createAssetService>;
  chatService: ReturnType<typeof createChatService>;
  proposalCardService: ReturnType<typeof createProposalCardService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  goalProposalService: ReturnType<typeof createGoalProposalService>;
  mealNumericProposalService: ReturnType<typeof createMealNumericProposalService>;
  mealDeleteProposalService: ReturnType<typeof createMealDeleteProposalService>;
  publisher: RealtimePublisher;
  /**
   * Override the upload storage directory. When undefined the route falls back
   * to `config.uploadsStagingDir` (production behaviour unchanged). Pass a
   * scenario-local temp directory in harness runs to prevent staged residue.
   */
  uploadsDir?: string;
  llmTraceRecorderFactory?: () => LlmTraceRecorder | undefined;
}

const UNIFIED_FALLBACK = "抱歉，這次無法完成請求，請稍後再試或補充描述。";
const PARTIAL_SUCCESS_FALLBACK = "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。";
const PARTIAL_MUTATION_FALLBACK = "已完成餐點調整，但回覆生成失敗，請稍後確認今日攝取摘要。";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const STOPPED_EMPTY_COPY = "已停止生成。";
const CONCRETE_DATE_PATTERN = /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\d{1,2}\/\d{1,2}(?!\/\d)|\d{1,2}月\d{1,2}日/;
type LoggedMealReceipt = NonNullable<ToolExecutionResult["loggedMeal"]>;
type RouteMutationState = CommittedMutationState<LoggedMealReceipt, ProposalActionEventClientMetadata>;
type ReceiptIdentity = {
  mealTransactionId: string;
  mealRevisionId: string;
  toolMessageId?: string;
};
type ReceiptPersistence = "not_applicable" | "persisted" | "failed_closed";
interface ActiveChatTurn {
  controller: AbortController;
  stopRequested: boolean;
  completed: boolean;
}

interface StreamingStopControl {
  turnId: string;
  signal: AbortSignal;
  isStopped(): boolean;
}

interface StreamingReplyResult {
  fullReply: string;
  didLogMeal: boolean;
  dailySummary?: unknown;
  summaryHistoryFacts?: SummaryHistoryFacts;
  stopped?: boolean;
  tokensStreamed: number;
  finalReplySource: LlmTraceFinalReplySource;
  finalReplyShape: LlmTraceFinalReplyShape;
  receiptPersistence: ReceiptPersistence;
}

type RouteProposalCard = PendingProposalCardInput | ProposalCardClientMetadata;

function isProjectedProposalCard(card: RouteProposalCard): card is ProposalCardClientMetadata {
  return "status" in card && "isActionable" in card;
}

async function loadActiveProposalSnapshots(deps: {
  goalProposalService: ReturnType<typeof createGoalProposalService>;
  mealNumericProposalService: ReturnType<typeof createMealNumericProposalService>;
  mealDeleteProposalService: ReturnType<typeof createMealDeleteProposalService>;
}, deviceId: string): Promise<Array<{
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  expiresAt?: string | null;
}>> {
  const [goal, mealNumeric, mealDelete] = await Promise.all([
    deps.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }),
    deps.mealNumericProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }),
    deps.mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }),
  ]);
  return [
    ...(goal ? [{
      proposalId: goal.proposalId,
      proposalKind: "goal" as const,
      proposalLane: "goal" as const,
    }] : []),
    ...(mealNumeric ? [{
      proposalId: mealNumeric.proposalId,
      proposalKind: mealNumeric.provenance === "model_estimate" ? "meal_estimate" as const : "meal_numeric" as const,
      proposalLane: "meal_mutation" as const,
      expiresAt: mealNumeric.expiresAt,
    }] : []),
    ...(mealDelete ? [{
      proposalId: mealDelete.proposalId,
      proposalKind: "meal_delete" as const,
      proposalLane: "meal_mutation" as const,
      expiresAt: mealDelete.expiresAt,
    }] : []),
  ];
}

async function persistProposalCardForAssistant(input: {
  proposalCardService: ReturnType<typeof createProposalCardService>;
  deviceId: string;
  assistantMessageId: string;
  proposalCard?: RouteProposalCard;
}): Promise<ProposalCardClientMetadata | undefined> {
  if (!input.proposalCard) {
    return undefined;
  }
  if (isProjectedProposalCard(input.proposalCard)) {
    return input.proposalCard;
  }
  if (input.proposalCard.proposalLane === "meal_mutation") {
    await input.proposalCardService.markSupersededInLane({
      deviceId: input.deviceId,
      proposalLane: input.proposalCard.proposalLane,
      replacementProposalId: input.proposalCard.proposalId,
      supersededByKind: input.proposalCard.proposalKind,
      lapseCopy: renderProposalSupersededCopy({
        proposalKind: input.proposalCard.proposalKind,
        supersededByKind: input.proposalCard.proposalKind,
      }),
    });
  } else {
    await input.proposalCardService.markSupersededInLane({
      deviceId: input.deviceId,
      proposalLane: "goal",
      replacementProposalId: input.proposalCard.proposalId,
      supersededByKind: "goal",
      lapseCopy: renderProposalSupersededCopy({
        proposalKind: "goal",
        supersededByKind: "goal",
      }),
    });
  }
  const saved = await input.proposalCardService.saveAssistantProposalCard({
    ...input.proposalCard,
    deviceId: input.deviceId,
    assistantMessageId: input.assistantMessageId,
  });
  return projectProposalCardForClient(saved, {
    proposalId: saved.proposalId,
    proposalKind: saved.proposalKind,
    proposalLane: saved.proposalLane,
    status: saved.status,
    isActionable: saved.status === "active",
    expiresAt: saved.expiresAt,
    lapseCopy: saved.lapseCopy,
  });
}

const activeChatTurns = new Map<string, ActiveChatTurn>();

function activeChatTurnKey(deviceId: string, turnId: string) {
  return `${deviceId}:${turnId}`;
}

function createChatTurnContext(request: FastifyRequest) {
  const turnId = crypto.randomUUID();
  const turnLog = request.log.child({ turnId });
  const orchLog = turnLog.child({ component: "orchestrator" });
  return { turnId, turnLog, orchLog };
}

function writeStatus(stream: PassThrough, label: string, turnId?: string) {
  stream.write(`event: status\ndata: ${JSON.stringify({ label, ...(turnId ? { turnId } : {}) })}\n\n`);
}

function callHookConsumer(invoke: () => void): void {
  try {
    invoke();
  } catch {
    // Hooks are best-effort observability only; consumer failures must not alter chat flow.
  }
}

export function fanOutOrchestratorHooks(
  ...hooks: Array<OrchestratorHooks | undefined>
): OrchestratorHooks | undefined {
  const activeHooks = hooks.filter((hook): hook is OrchestratorHooks => Boolean(hook));
  if (activeHooks.length === 0) {
    return undefined;
  }

  return {
    onLLMStart(round) {
      for (const hook of activeHooks) callHookConsumer(() => hook.onLLMStart?.(round));
    },
    onLLMEnd(round, hadToolCalls) {
      for (const hook of activeHooks) callHookConsumer(() => hook.onLLMEnd?.(round, hadToolCalls));
    },
    onToolReceived(tool, argsRedacted) {
      for (const hook of activeHooks) callHookConsumer(() => hook.onToolReceived?.(tool, argsRedacted));
    },
    onToolResult(payload) {
      for (const hook of activeHooks) callHookConsumer(() => hook.onToolResult?.(payload));
    },
    onLLMError(payload) {
      for (const hook of activeHooks) callHookConsumer(() => hook.onLLMError?.(payload));
    },
    onFallback(payload) {
      for (const hook of activeHooks) callHookConsumer(() => hook.onFallback?.(payload));
    },
  };
}

function formatHistoricalDateLabel(dateKey: string, currentDate = currentAppDate()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return dateKey;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return year === currentDate.getFullYear()
    ? `${month}/${day}`
    : `${year}/${month}/${day}`;
}

function appendHistoricalDateSuffixIfMissing(text: string, affectedDate?: string): string {
  if (!affectedDate || affectedDate === formatLocalDate(currentAppDate()) || CONCRETE_DATE_PATTERN.test(text)) {
    return text;
  }

  return `${text}（${formatHistoricalDateLabel(affectedDate)}）`;
}

function shouldComposeSummaryHistoryReply(
  mutationProjection: Pick<CommittedMutationProjection, "hasCommittedMutation">,
  summaryHistoryFacts: SummaryHistoryFacts | undefined,
): summaryHistoryFacts is SummaryHistoryFacts {
  return !mutationProjection.hasCommittedMutation && Boolean(summaryHistoryFacts?.dailySummary);
}

function normalizeRouteFinalReply(
  rawReply: string,
  mutationProjection: Pick<CommittedMutationProjection, "mutationKind" | "hasCommittedMutation">,
  summaryHistoryFacts: SummaryHistoryFacts | undefined,
  opts: { composeSummaryHistory?: boolean; rendererOwnedSummaryHistory?: boolean } = {},
): { reply: string; composedSummaryHistory: boolean } {
  const composedSummaryHistory = opts.composeSummaryHistory !== false
    && shouldComposeSummaryHistoryReply(mutationProjection, summaryHistoryFacts);
  const rendererOwnedSummaryHistory = opts.rendererOwnedSummaryHistory === true
    && shouldComposeSummaryHistoryReply(mutationProjection, summaryHistoryFacts);
  const reply = composedSummaryHistory
    ? composeSummaryHistoryReply(summaryHistoryFacts, rawReply)
    : rawReply;
  if (composedSummaryHistory || rendererOwnedSummaryHistory) {
    return {
      reply,
      composedSummaryHistory: true,
    };
  }
  return {
    reply: guardNoMutationSuccessClaim(reply, mutationProjection, {
      summaryHistoryFacts,
    }),
    composedSummaryHistory,
  };
}

function projectRouteMutationState(input: {
  mutationState?: RouteMutationState;
  didLogMeal: boolean;
  didMutateMeal?: boolean;
  deletedMealId?: string;
  mutationOutcomeFact?: ChatMutationOutcomeFact;
}): Pick<CommittedMutationProjection<LoggedMealReceipt, ProposalActionEventClientMetadata>, "mutationKind" | "hasCommittedMutation" | "didLogMeal" | "didMutateMeal" | "didMutateGoals" | "shouldPublishDailySummary" | "shouldPublishGoalsUpdate"> {
  if (input.mutationState) {
    return projectCommittedMutationState(input.mutationState);
  }

  const mutationKind = input.mutationOutcomeFact?.action === "log_food"
    ? "log"
    : input.mutationOutcomeFact?.action === "update_meal"
      ? "update"
      : input.mutationOutcomeFact?.action === "delete_meal"
        ? "delete"
        : input.mutationOutcomeFact?.action === "update_goals"
          ? "goals"
          : input.didLogMeal
            ? "log"
            : input.deletedMealId
              ? "delete"
              : input.didMutateMeal
                ? "update"
                : undefined;
  const didMutateMeal = mutationKind === "log" || mutationKind === "update" || mutationKind === "delete";
  return {
    ...(mutationKind ? { mutationKind } : {}),
    hasCommittedMutation: mutationKind !== undefined,
    didLogMeal: mutationKind === "log",
    didMutateMeal,
    didMutateGoals: mutationKind === "goals",
    shouldPublishDailySummary: didMutateMeal,
    shouldPublishGoalsUpdate: mutationKind === "goals",
  };
}

async function finalizeAssistantReply(
  chatService: ReturnType<typeof createChatService>,
  deviceId: string,
  rawReply: string,
  receiptIdentity?: ReceiptIdentity,
  opts?: {
    status?: "complete" | "stopped" | "error";
    mutationOutcomeFact?: ChatMutationOutcomeFact;
    log?: FastifyBaseLogger;
    transport?: "json" | "sse";
  },
): Promise<{ sanitized: string; assistantMessageId: string; receiptPersistence: ReceiptPersistence }> {
  const sanitized = sanitizeReply(rawReply);
  if (!receiptIdentity && opts?.mutationOutcomeFact === undefined) {
    const assistantMessage = await chatService.saveMessage(
      deviceId,
      "assistant",
      sanitized,
      opts?.status ? { status: opts.status } : undefined,
    );
    return {
      sanitized,
      assistantMessageId: assistantMessage.id,
      receiptPersistence: "not_applicable",
    };
  }

  try {
    const assistantMessage = await chatService.saveAssistantReplyWithReceipt({
      deviceId,
      content: sanitized,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(receiptIdentity ? { receipt: receiptIdentity } : {}),
      ...(opts?.mutationOutcomeFact ? { mutationOutcomeFact: opts.mutationOutcomeFact } : {}),
    });
    return {
      sanitized,
      assistantMessageId: assistantMessage.id,
      receiptPersistence: "persisted",
    };
  } catch (error) {
    const failureReply = sanitizeReply(
      opts?.mutationOutcomeFact?.action === "log_food"
        ? PARTIAL_SUCCESS_FALLBACK
        : opts?.mutationOutcomeFact
          ? PARTIAL_MUTATION_FALLBACK
          : receiptIdentity
            ? PARTIAL_SUCCESS_FALLBACK
            : sanitized,
    );
    const assistantMessage = await chatService.saveMessage(
      deviceId,
      "assistant",
      failureReply,
      { status: opts?.status ?? "error" },
    );
    opts?.log?.warn(
      {
        event: "chat_receipt_persistence_failed_closed",
        transport: opts.transport ?? "json",
        mutationFamily: opts.mutationOutcomeFact?.action ?? "receipt_only",
        hasReceiptIdentity: Boolean(receiptIdentity),
        hasMutationOutcomeFact: opts.mutationOutcomeFact !== undefined,
        status: opts.status ?? "complete",
        failureClass: error instanceof Error ? error.name : typeof error,
      },
      "Chat receipt persistence failed closed",
    );
    return {
      sanitized: failureReply,
      assistantMessageId: assistantMessage.id,
      receiptPersistence: "failed_closed",
    };
  }
}

function createNoMutationLoggingClaimStreamGuard() {
  const claimPattern = /已\s*(?:經\s*)?記錄|完成\s*記錄/;
  const maxHoldLength = 8;
  let tail = "";
  let detected = false;

  return {
    push(token: string): string {
      if (detected) return "";
      tail += token;
      if (claimPattern.test(tail)) {
        detected = true;
        tail = "";
        return "";
      }
      if (tail.length <= maxHoldLength) {
        return "";
      }
      const safePrefix = tail.slice(0, -maxHoldLength);
      tail = tail.slice(-maxHoldLength);
      return safePrefix;
    },
    flush(): string {
      if (detected) return "";
      const flushed = tail;
      tail = "";
      return flushed;
    },
    detected(): boolean {
      return detected;
    },
  };
}

function parseProposalContext(rawValue: unknown):
  | { proposalContext: ProposalEditContext }
  | { error: string } {
  if (typeof rawValue !== "string") {
    return { error: "Invalid proposalContext" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return { error: "Invalid proposalContext JSON" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Invalid proposalContext shape" };
  }

  const keys = Object.keys(parsed);
  if (
    keys.length !== 3
    || !keys.includes("proposalId")
    || !keys.includes("kind")
    || !keys.includes("action")
  ) {
    return { error: "Invalid proposalContext keys" };
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.proposalId !== "string" || candidate.proposalId.trim().length === 0) {
    return { error: "Invalid proposalContext proposalId" };
  }
  if (typeof candidate.kind !== "string" || !(PROPOSAL_KINDS as readonly string[]).includes(candidate.kind)) {
    return { error: "Invalid proposalContext kind" };
  }
  if (candidate.action !== "edit") {
    return { error: "Invalid proposalContext action" };
  }

  return {
    proposalContext: {
      proposalId: candidate.proposalId,
      kind: candidate.kind as ProposalKind,
      action: "edit",
    },
  };
}

async function parseMultipartRequest(
  request: FastifyRequest,
  uploadsDir: string,
): Promise<
  | {
      message: string;
      image?: { dataUri: string; path: string; mimeType: string; originalFilename?: string };
      proposalContext?: ProposalEditContext;
    }
  | { error: string; code: number }
> {
  let message = "";
  let image:
    | { dataUri: string; path: string; mimeType: string; originalFilename?: string }
    | undefined;
  let proposalContext: ProposalEditContext | undefined;
  let proposalContextSeen = false;
  const savedImagePaths: string[] = [];

  async function reject(error: string, code: number) {
    await Promise.all(savedImagePaths.map((imagePath) => cleanupUploadSafe(imagePath, request.log)));
    return { error, code };
  }

  async function rejectRawDeviceIdSelector() {
    logOwnershipBypassBlocked(request.log, {
      reason: "raw_device_id_param",
      route: PROTECTED_ROUTE_META.chatMessage.route,
      operation: PROTECTED_ROUTE_META.chatMessage.operation,
      requestId: request.id,
    });
    return reject("Raw device selector is not allowed", 400);
  }

  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { error: "Content-Type must be multipart/form-data", code: 400 };
  }

  const parts = request.parts();
  for await (const part of parts) {
    if (part.type === "field" && part.fieldname === "message") {
      message = part.value as string;
    } else if (part.type === "field" && part.fieldname === "deviceId") {
      return rejectRawDeviceIdSelector();
    } else if (part.type === "field" && part.fieldname === "proposalContext") {
      if (proposalContextSeen) {
        return reject("Only one proposalContext field is allowed", 400);
      }
      proposalContextSeen = true;
      const parsedContext = parseProposalContext(part.value);
      if ("error" in parsedContext) {
        return reject(parsedContext.error, 400);
      }
      proposalContext = parsedContext.proposalContext;
    } else if (part.type === "file" && part.fieldname === "image") {
      if (!ALLOWED_IMAGE_MIME_TYPES.includes(part.mimetype)) {
        return reject("Invalid image type. Allowed: jpeg, png, webp", 400);
      }
      if (image) {
        return reject("Only one image upload is allowed", 400);
      }
      const buffer = await part.toBuffer();
      if (buffer.length > 5 * 1024 * 1024) {
        return reject("Image too large. Max 5MB.", 400);
      }
      if (!await validateImageBytes(buffer, part.mimetype)) {
        return reject("Invalid image type. Allowed: jpeg, png, webp", 400);
      }
      const filename = `${crypto.randomUUID()}.${part.mimetype.split("/")[1]}`;
      await mkdir(uploadsDir, { recursive: true });
      const storedPath = join(uploadsDir, filename);
      await writeFile(storedPath, buffer);
      savedImagePaths.push(storedPath);
      image = {
        dataUri: `data:${part.mimetype};base64,${buffer.toString("base64")}`,
        path: storedPath,
        mimeType: part.mimetype,
        originalFilename: part.filename,
      };
    }
  }

  if (proposalContext && image) {
    return reject("proposalContext is text-only and cannot be combined with image upload", 400);
  }

  if (!message && image) {
    message = "(圖片)";
  }

  if (!message && !image) {
    return { error: "Message or image required", code: 400 };
  }

  return {
    message,
    image,
    ...(proposalContext ? { proposalContext } : {}),
  };
}

function publishSummarySafe(
  publisher: RealtimePublisher,
  deviceId: string,
  shouldPublishDailySummary: boolean,
  dailySummary: unknown,
  affectedDate: unknown,
  log: FastifyBaseLogger,
): void {
  const summaryDate = (
    dailySummary
    && typeof dailySummary === "object"
    && "date" in dailySummary
    && typeof (dailySummary as { date?: unknown }).date === "string"
  )
    ? (dailySummary as DailySummary).date
    : undefined;
  const publishAffectedDate = typeof affectedDate === "string" && affectedDate
    ? affectedDate
    : summaryDate;
  if (
    !shouldPublishDailySummary
    || !publishAffectedDate
    || !summaryDate
    || summaryDate !== publishAffectedDate
  ) {
    return;
  }
  try {
    publisher.publishDailySummary(deviceId, {
      summary: dailySummary as DailySummary,
      affectedDate: publishAffectedDate,
      source: "meal_mutation",
    });
    log.info({ event: "summary_publish_success", affectedDate: publishAffectedDate }, "Summary publish success");
  } catch (publishErr) {
    void publishErr;
    log.warn(
      { event: "summary_publish_failed", failureReason: "publisher_error", affectedDate: publishAffectedDate },
      "Summary publish failed (non-fatal)",
    );
  }
}

function projectLoggedMealReceipt(loggedMeal: LoggedMealReceipt | undefined) {
  if (!loggedMeal) return undefined;

  const {
    mealId,
    dateKey,
    mealRevisionId,
    loggedAt,
    imageAssetId,
    imageUrl,
    foodName,
    itemCount,
    calories,
    protein,
    carbs,
    fat,
  } = loggedMeal;
  const receiptMealId = typeof loggedMeal.receiptMealId === "string"
    ? loggedMeal.receiptMealId
    : undefined;
  const explicitReceiptStatus = (loggedMeal as unknown as { receiptStatus?: unknown }).receiptStatus;
  const hasActiveIdentity =
    typeof mealId === "string" &&
    typeof dateKey === "string" &&
    typeof mealRevisionId === "string";
  const receiptStatus = normalizeReceiptStatus(explicitReceiptStatus)
    ?? (hasActiveIdentity ? "active" : undefined);
  const mealPeriod = normalizeMealPeriod(loggedMeal.mealPeriod);
  const items = Array.isArray(loggedMeal.items)
    ? loggedMeal.items
        .filter((item) => (
          item &&
          typeof item.name === "string" &&
          item.name.trim().length > 0 &&
          Number.isFinite(item.position) &&
          Number.isFinite(item.calories) &&
          Number.isFinite(item.protein) &&
          Number.isFinite(item.carbs) &&
          Number.isFinite(item.fat)
        ))
        .sort((left, right) => left.position - right.position)
        .map((item) => ({
          name: item.name.trim(),
          position: item.position,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        }))
    : undefined;
  if (
    !foodName.trim() ||
    !Number.isFinite(itemCount) ||
    itemCount <= 0 ||
    !Number.isFinite(calories) ||
    !Number.isFinite(protein) ||
    !Number.isFinite(carbs) ||
    !Number.isFinite(fat) ||
    !receiptStatus
  ) {
    return undefined;
  }

  return {
    receiptStatus,
    ...(typeof receiptMealId === "string" ? { receiptMealId } : {}),
    ...(receiptStatus === "active" && typeof mealId === "string" ? { mealId } : {}),
    ...(receiptStatus === "active" && typeof dateKey === "string" ? { dateKey } : {}),
    ...(receiptStatus === "active" && typeof mealRevisionId === "string" ? { mealRevisionId } : {}),
    ...(typeof loggedAt === "string" ? { loggedAt } : {}),
    ...(mealPeriod ? { mealPeriod } : {}),
    ...(typeof imageAssetId === "string" || imageAssetId === null ? { imageAssetId } : {}),
    ...(typeof imageUrl === "string" || imageUrl === null ? { imageUrl } : {}),
    foodName,
    itemCount,
    calories,
    protein,
    carbs,
    fat,
    ...(items && items.length > 0 ? { items } : {}),
  };
}

function normalizeReceiptStatus(value: unknown): MealReceiptStatus | undefined {
  return value === "active" || value === "deleted" || value === "stale_revision"
    ? value
    : undefined;
}

function buildReceiptIdentity(
  loggedMeal: LoggedMealReceipt | undefined,
  toolMessageId: string | undefined,
): ReceiptIdentity | undefined {
  if (!loggedMeal) return undefined;

  return {
    mealTransactionId: loggedMeal.mealId,
    mealRevisionId: loggedMeal.mealRevisionId,
    ...(toolMessageId ? { toolMessageId } : {}),
  };
}

async function cleanupUploadSafe(imagePath: string | undefined, log: FastifyBaseLogger): Promise<void> {
  if (!imagePath) return;
  try {
    await unlink(imagePath);
    log.info({ event: "upload_cleanup_success" }, "Upload cleanup success");
  } catch (cleanupErr) {
    const code = cleanupErr instanceof Error && "code" in cleanupErr ? (cleanupErr as NodeJS.ErrnoException).code : "UNKNOWN";
    log.warn(
      { event: "upload_cleanup_failed", code },
      "Upload cleanup failed (non-fatal)",
    );
  }
}

function projectAssetFields(imagePath: string | null | undefined) {
  const imageAssetId = parseAssetRef(imagePath);
  return {
    imageAssetId,
    imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
  };
}

function providerStreamFallback(
  error: unknown,
  fallbackReason: "llm_error" | "partial_success" = "llm_error",
):
  | {
      fallbackSource: "orchestrator";
      reason: "llm_error";
      providerMetadata: ProviderErrorMetadata;
    }
  | {
      fallbackSource: "orchestrator";
      reason: "partial_success";
    }
  | undefined {
  if (!isLLMProviderError(error)) {
    return undefined;
  }

  if (fallbackReason === "partial_success") {
    return {
      fallbackSource: "orchestrator",
      reason: "partial_success",
    };
  }

  return {
    fallbackSource: "orchestrator",
    reason: "llm_error",
    providerMetadata: error.providerMetadata,
  };
}

async function createDurableAssetIfNeeded(
  assetService: ReturnType<typeof createAssetService>,
  deviceId: string,
  image: { path: string; mimeType: string; originalFilename?: string } | undefined,
) {
  if (!image) {
    return undefined;
  }

  const asset = await assetService.createAsset(deviceId, {
    stagedPath: image.path,
    mimeType: image.mimeType,
    originalFilename: image.originalFilename,
  });

  // The legacy imagePath column now stores an asset ref token for new uploads.
  return { assetId: asset.id, assetRef: makeAssetRef(asset.id) };
}

async function cleanupDurableAssetSafe(
  assetService: ReturnType<typeof createAssetService>,
  deviceId: string,
  assetId: string | undefined,
  assetRef: string | undefined,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!assetId || !assetRef) {
    return;
  }

  try {
    const isReferenced = await assetService.isAssetRefReferenced(assetRef);
    if (!isReferenced) {
      await assetService.deleteOwnedAsset(deviceId, assetId);
      log.info({ event: "durable_asset_cleanup_success" }, "Durable asset cleanup success");
    }
  } catch (cleanupErr) {
    log.warn(
      {
        event: "durable_asset_cleanup_failed",
        err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      },
      "Durable asset cleanup failed (non-fatal)",
    );
  }
}

async function handleStreamingReply(
  stream: PassThrough,
  streamGenerator: AsyncGenerator<string>,
  chatService: ReturnType<typeof createChatService>,
  deviceId: string,
  mutationProjection: Pick<CommittedMutationProjection, "mutationKind" | "hasCommittedMutation" | "didLogMeal" | "didMutateMeal">,
  dailySummary: unknown,
  summaryHistoryFacts: SummaryHistoryFacts | undefined,
  receiptIdentity: ReceiptIdentity | undefined,
  mutationOutcomeFact: ChatMutationOutcomeFact | undefined,
  affectedDate?: string,
  partialMutationReply?: string,
  hooks?: OrchestratorHooks,
  log?: FastifyBaseLogger,
  stopControl?: StreamingStopControl,
): Promise<StreamingReplyResult> {
  const sanitizer = createStreamingSanitizer();
  const didLogMeal = mutationProjection.didLogMeal;
  const didMutateMeal = mutationProjection.didMutateMeal;
  const hasSummaryContext = Boolean(summaryHistoryFacts?.dailySummary ?? dailySummary);
  const shouldGuardNoMutationModelText = !mutationProjection.hasCommittedMutation && !hasSummaryContext;
  const shouldHoldNoMutationSummaryText = !mutationProjection.hasCommittedMutation && hasSummaryContext;
  const noMutationClaimGuard = shouldGuardNoMutationModelText
    ? createNoMutationLoggingClaimStreamGuard()
    : undefined;
  let fullReply = "";
  let tokensStreamed = 0;
  let hallucAccum = "";
  const heldTokens: string[] = [];
  let holdingChoicePrompt = false;
  let hallucinationDetected = false;
  let noMutationLoggingClaimDetected = false;
  let receiptPersistence: ReceiptPersistence = "not_applicable";

  async function persistFinalReply(
    replyText: string,
    opts?: { status?: "complete" | "stopped" | "error" },
  ): Promise<string> {
    const result = await finalizeAssistantReply(
      chatService,
      deviceId,
      replyText,
      receiptIdentity,
      {
        ...opts,
        mutationOutcomeFact,
        log,
        transport: "sse",
      },
    );
    receiptPersistence = result.receiptPersistence;
    return result.sanitized;
  }

  function writeVisibleChunk(token: string): void {
    if (shouldHoldNoMutationSummaryText) {
      return;
    }
    const guardedToken = noMutationClaimGuard ? noMutationClaimGuard.push(token) : token;
    if (noMutationClaimGuard?.detected()) {
      noMutationLoggingClaimDetected = true;
      return;
    }
    const sanitizedChunk = sanitizer.push(guardedToken);
    if (sanitizedChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedChunk })}\n\n`);
    }
  }

  try {
    for await (const token of streamGenerator) {
      tokensStreamed += 1;
      hallucAccum += token;
      if (CHOICE_PROMPT_PATTERN.test(hallucAccum)) {
        hallucinationDetected = true;
        break;
      }
      if (holdingChoicePrompt || /方式\s*[12]/.test(hallucAccum)) {
        holdingChoicePrompt = true;
        heldTokens.push(token);
        continue;
      }
      fullReply += token;
      writeVisibleChunk(token);
      if (noMutationLoggingClaimDetected) {
        break;
      }
    }
  } catch (error) {
    if (!stopControl?.isStopped() && !stopControl?.signal.aborted) {
      throw error;
    }
  }

  if (stopControl?.isStopped() || stopControl?.signal.aborted) {
    const stoppedReply = sanitizeReply(
      guardNoMutationSuccessClaim(fullReply, mutationProjection, {
        summaryHistoryFacts,
      }),
    ) || STOPPED_EMPTY_COPY;
    const persistedReply = await persistFinalReply(stoppedReply, { status: "stopped" });
    return {
      fullReply: persistedReply,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      stopped: true,
      tokensStreamed,
      finalReplySource: "model",
      finalReplyShape: persistedReply.trim() ? "streamed_text" : "empty_or_missing",
      receiptPersistence,
    };
  }

  if (hallucinationDetected) {
    hooks?.onFallback?.({ reason: "hallucination_detected" });
    const retryMsg = didMutateMeal && partialMutationReply
      ? partialMutationReply
      : "抱歉，無法辨識這次的請求，可以再試一次或補充文字描述嗎？";
    const persistedReply = await persistFinalReply(retryMsg);
    stream.write(`event: chunk\ndata: ${JSON.stringify({ token: persistedReply })}\n\n`);
    return {
      fullReply: persistedReply,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      tokensStreamed,
      finalReplySource: "fallback",
      finalReplyShape: "fallback_text",
      receiptPersistence,
    };
  }

  for (const heldToken of heldTokens) {
    fullReply += heldToken;
    writeVisibleChunk(heldToken);
    if (noMutationLoggingClaimDetected) {
      break;
    }
  }
  const normalizedReply = appendHistoricalDateSuffixIfMissing(fullReply, affectedDate);
  const appendedText = normalizedReply.slice(fullReply.length);
  if (appendedText) {
    fullReply = normalizedReply;
    writeVisibleChunk(appendedText);
  }
  const {
    reply: guardedFullReply,
    composedSummaryHistory,
  } = normalizeRouteFinalReply(fullReply, mutationProjection, summaryHistoryFacts);
  if (noMutationLoggingClaimDetected || guardedFullReply !== fullReply) {
    const sanitizedReply = sanitizeReply(guardedFullReply);
    const finalChunk = sanitizer.flush();
    if (finalChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: finalChunk })}\n\n`);
    }
    if (sanitizedReply) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedReply })}\n\n`);
    }
    const persistedReply = await persistFinalReply(sanitizedReply);
    return {
      fullReply: persistedReply,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      tokensStreamed,
      finalReplySource: composedSummaryHistory ? "renderer" : "fallback",
      finalReplyShape: composedSummaryHistory
        ? (sanitizedReply.trim() ? "streamed_text" : "empty_or_missing")
        : (persistedReply.trim() ? "fallback_text" : "empty_or_missing"),
      receiptPersistence,
    };
  }
  if (shouldHoldNoMutationSummaryText) {
    const sanitizedReplyChunk = sanitizer.push(guardedFullReply);
    if (sanitizedReplyChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedReplyChunk })}\n\n`);
    }
    const finalHeldChunk = sanitizer.flush();
    if (finalHeldChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: finalHeldChunk })}\n\n`);
    }
    const persistedReply = await persistFinalReply(guardedFullReply);
    return {
      fullReply: persistedReply,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      tokensStreamed,
      finalReplySource: composedSummaryHistory ? "renderer" : "model",
      finalReplyShape: persistedReply.trim() ? "streamed_text" : "empty_or_missing",
      receiptPersistence,
    };
  }
  const guardedFinalChunk = noMutationClaimGuard?.flush() ?? "";
  if (guardedFinalChunk) {
    const sanitizedChunk = sanitizer.push(guardedFinalChunk);
    if (sanitizedChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedChunk })}\n\n`);
    }
  }
  const finalChunk = sanitizer.flush();
  if (finalChunk) {
    stream.write(`event: chunk\ndata: ${JSON.stringify({ token: finalChunk })}\n\n`);
  }
  const persistedReply = await persistFinalReply(fullReply);
  return {
    fullReply: persistedReply,
    didLogMeal,
    dailySummary,
    summaryHistoryFacts,
    tokensStreamed,
    finalReplySource: "model",
    finalReplyShape: persistedReply.trim() ? "streamed_text" : "empty_or_missing",
    receiptPersistence,
  };
}

async function handleOrchestratorSSE(
  stream: PassThrough,
  deps: {
    assetService: ReturnType<typeof createAssetService>;
    orchestrator: ReturnType<typeof createOrchestrator>;
    chatService: ReturnType<typeof createChatService>;
    proposalCardService: ReturnType<typeof createProposalCardService>;
    publisher: RealtimePublisher;
    log: FastifyBaseLogger;
  },
  deviceId: string,
  message: string,
  image: { dataUri: string; path: string; mimeType: string; originalFilename?: string } | undefined,
  proposalContext: ProposalEditContext | undefined,
  startedAt: number,
  hooks?: OrchestratorHooks,
  recorder?: LlmTraceRecorder,
  stopControl?: StreamingStopControl,
): Promise<void> {
  if (!stopControl) {
    throw new Error("SSE stop control is required");
  }

  let durableAssetId: string | undefined;
  let durableAssetRef: string | undefined;
  let userMessagePersisted = false;
  let streamDidLogMeal = false;
  let streamDidMutateMeal = false;
  let streamShouldPublishDailySummary = false;
  let streamDailySummary: unknown;
  let streamSummaryOutcome: SummaryOutcome | undefined;
  let streamDailyTargets: unknown;
  let streamAffectedDate: string | undefined;
  let streamDeletedMealId: string | undefined;
  let streamProposalCard: ProposalCardClientMetadata | undefined;
  let streamProposalActionEvent: ProposalActionEventClientMetadata | undefined;
  let streamLoggedMeal: ReturnType<typeof buildPartialSuccessLoggedReply> | undefined;
  let streamLoggedMealReceipt: ReturnType<typeof projectLoggedMealReceipt>;
  let streamReceiptIdentity: ReceiptIdentity | undefined;
  let streamMutationOutcomeFact: ChatMutationOutcomeFact | undefined;
  let streamReceiptPersistence: ReceiptPersistence = "not_applicable";
  const recordSseCompletion = (params: {
    didLogMeal: boolean;
    didMutateMeal: boolean;
    stopped?: boolean;
    tokensStreamed?: number;
  }) => {
    const latencyMs = Date.now() - startedAt;
    recorder?.recordRouteCompletion({
      transport: "sse",
      turnId: stopControl.turnId,
      didLogMeal: params.didLogMeal,
      didMutateMeal: params.didMutateMeal,
      completed: true,
    });
    recorder?.recordMetrics({ latencyMs });
    logChatTurnCompleted(deps.log, {
      source: "sse",
      turnId: stopControl.turnId,
      didLogMeal: params.didLogMeal,
      didMutateMeal: params.didMutateMeal,
      hadImage: Boolean(image),
      latencyMs,
      ...(params.stopped !== undefined ? { stopped: params.stopped } : {}),
      ...(params.tokensStreamed !== undefined ? { tokensStreamed: params.tokensStreamed } : {}),
    });
  };
  const recordSseFallback = (params: {
    fallbackSource: RouteFallbackSource;
    reason?: RouteFallbackReason;
    round?: number;
    lastTool?: string;
    catchSite?: RouteCatchSite;
    errorName?: string;
    errorMessage?: string;
    providerMetadata?: ProviderErrorMetadata;
    didLogMeal: boolean;
    didMutateMeal: boolean;
  }) => {
    const latencyMs = Date.now() - startedAt;
    recorder?.recordRouteFallback({
      transport: "sse",
      turnId: stopControl.turnId,
      fallbackSource: params.fallbackSource,
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
      didLogMeal: params.didLogMeal,
      didMutateMeal: params.didMutateMeal,
      ...(params.catchSite !== undefined ? { catchSite: params.catchSite } : {}),
      ...(params.providerMetadata !== undefined ? { providerMetadata: params.providerMetadata } : {}),
      ...(params.round !== undefined ? { round: params.round } : {}),
      ...(params.lastTool !== undefined ? { lastTool: params.lastTool } : {}),
      ...(params.errorName !== undefined ? { errorName: params.errorName } : {}),
      ...(params.errorMessage !== undefined ? { errorMessage: params.errorMessage } : {}),
    });
    recorder?.recordMetrics({ latencyMs });
    logChatRouteFallback(deps.log, {
      source: "sse",
      turnId: stopControl.turnId,
      fallbackSource: params.fallbackSource,
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
      ...(params.catchSite !== undefined ? { catchSite: params.catchSite } : {}),
      didLogMeal: params.didLogMeal,
      didMutateMeal: params.didMutateMeal,
      hadImage: Boolean(image),
      latencyMs,
      ...(params.round !== undefined ? { round: params.round } : {}),
      ...(params.lastTool !== undefined ? { lastTool: params.lastTool } : {}),
      ...(params.providerMetadata !== undefined ? { providerMetadata: params.providerMetadata } : {}),
      ...(params.errorName !== undefined ? { errorName: params.errorName } : {}),
      ...(params.errorMessage !== undefined ? { errorMessage: params.errorMessage } : {}),
    });
  };

  try {
    writeStatus(stream, "思考中...", stopControl.turnId);
    if (image) {
      writeStatus(stream, "分析圖片中...", stopControl.turnId);
    }

    const durableAsset = await createDurableAssetIfNeeded(
      deps.assetService,
      deviceId,
      image,
    );
    durableAssetId = durableAsset?.assetId;
    durableAssetRef = durableAsset?.assetRef;

    const result = await deps.orchestrator.handleMessage(
      deviceId,
      message,
      image?.dataUri,
      durableAssetRef,
      {
        onStatus: (label: string) => {
          writeStatus(stream, label, stopControl.turnId);
        },
        onUserMessageSaved: () => {
          userMessagePersisted = true;
        },
        hooks,
        signal: stopControl?.signal,
        turnId: stopControl.turnId,
        log: deps.log,
        proposalContext,
      }
    );

    if ("streamGenerator" in result) {
      const mutationProjection = projectRouteMutationState(result);
      const {
        streamGenerator,
        dailySummary,
        summaryOutcome,
        summaryHistoryFacts,
        affectedDate,
        deletedMealId,
        loggedMeal,
        proposalCard,
        proposalActionEvent,
      } = result;
      const didLogMeal = mutationProjection.didLogMeal;
      streamDidLogMeal = didLogMeal;
      streamDidMutateMeal = mutationProjection.didMutateMeal;
      streamShouldPublishDailySummary = mutationProjection.shouldPublishDailySummary;
      streamDailySummary = dailySummary;
      streamSummaryOutcome = summaryOutcome;
      streamDailyTargets = result.dailyTargets;
      streamAffectedDate = affectedDate;
      streamDeletedMealId = deletedMealId;
      streamLoggedMeal = loggedMeal ? buildPartialSuccessLoggedReply(loggedMeal) : undefined;
      streamLoggedMealReceipt = projectLoggedMealReceipt(loggedMeal);
      streamReceiptIdentity = buildReceiptIdentity(loggedMeal, result.loggedMealToolMessageId);
      streamMutationOutcomeFact = result.mutationOutcomeFact;
      streamProposalActionEvent = proposalActionEvent;

      const streamResult = await handleStreamingReply(
        stream,
        streamGenerator,
        deps.chatService,
        deviceId,
        mutationProjection,
        dailySummary,
        summaryHistoryFacts,
        streamReceiptIdentity,
        streamMutationOutcomeFact,
        streamAffectedDate,
        streamLoggedMeal ?? (streamDidMutateMeal ? PARTIAL_MUTATION_FALLBACK : undefined),
        hooks,
        deps.log,
        stopControl,
      );
      streamDidLogMeal = streamResult.didLogMeal;
      streamDailySummary = streamResult.dailySummary;
      streamReceiptPersistence = streamResult.receiptPersistence;
      const canProjectStreamReceipt = streamReceiptPersistence === "persisted";
      recorder?.recordFinalReply({
        source: streamResult.finalReplySource,
        shape: streamResult.finalReplyShape,
      });

      if (streamResult.stopped) {
        const stoppedData = {
          stopped: true,
          turnId: stopControl.turnId,
          tokensStreamed: streamResult.tokensStreamed,
          didLogMeal: streamDidLogMeal,
          didMutateMeal: streamDidMutateMeal,
          ...(canProjectStreamReceipt && streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
          ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
          ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
          ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
          ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
          ...(streamDeletedMealId ? { deletedMealId: streamDeletedMealId } : {}),
        };
        stream.write(`event: stopped\ndata: ${JSON.stringify(stoppedData)}\n\n`);
        recordSseCompletion({
          didLogMeal: streamDidLogMeal,
          didMutateMeal: streamDidMutateMeal,
          stopped: true,
          tokensStreamed: streamResult.tokensStreamed,
        });
        publishSummarySafe(deps.publisher, deviceId, mutationProjection.shouldPublishDailySummary, streamDailySummary, streamAffectedDate, deps.log);
        return;
      }

      const doneData = {
        turnId: stopControl.turnId,
        didLogMeal: streamDidLogMeal,
        didMutateMeal: streamDidMutateMeal,
        ...(streamResult.finalReplySource === "fallback" ? { replyText: streamResult.fullReply } : {}),
        ...(canProjectStreamReceipt && streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
        ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
        ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
        ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
        ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
        ...(streamDeletedMealId ? { deletedMealId: streamDeletedMealId } : {}),
        ...(streamProposalActionEvent ? { proposalActionEvent: streamProposalActionEvent } : {}),
      };
      stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
      if (streamResult.finalReplySource === "fallback") {
        recordSseFallback({
          fallbackSource: "route_hallucination",
          reason: "hallucination_detected",
          didLogMeal: streamDidLogMeal,
          didMutateMeal: streamDidMutateMeal,
        });
      } else {
        recordSseCompletion({
          didLogMeal: streamDidLogMeal,
          didMutateMeal: streamDidMutateMeal,
        });
      }
      publishSummarySafe(deps.publisher, deviceId, mutationProjection.shouldPublishDailySummary, streamDailySummary, streamAffectedDate, deps.log);
    } else {
      const mutationProjection = projectRouteMutationState(result);
      const {
        reply: replyText,
        dailySummary,
        summaryOutcome,
        summaryHistoryFacts,
        dailyTargets,
        affectedDate,
        deletedMealId,
        loggedMeal,
        proposalCard,
        proposalActionEvent,
      } = result;
      const didLogMeal = mutationProjection.didLogMeal;
      recorder?.recordFinalReply({
        source: result.finalReplySource ?? "model",
        shape: result.finalReplyShape ?? "empty_or_missing",
      });
      streamDidLogMeal = didLogMeal;
      streamDidMutateMeal = mutationProjection.didMutateMeal;
      streamShouldPublishDailySummary = mutationProjection.shouldPublishDailySummary;
      streamDailySummary = dailySummary;
      streamSummaryOutcome = summaryOutcome;
      streamDailyTargets = dailyTargets;
      streamAffectedDate = affectedDate;
      streamDeletedMealId = deletedMealId;
      streamLoggedMeal = loggedMeal ? buildPartialSuccessLoggedReply(loggedMeal) : undefined;
      streamLoggedMealReceipt = projectLoggedMealReceipt(loggedMeal);
      streamReceiptIdentity = buildReceiptIdentity(loggedMeal, result.loggedMealToolMessageId);
      streamMutationOutcomeFact = result.mutationOutcomeFact;
      streamProposalActionEvent = proposalActionEvent;
      const shouldComposeSummaryHistory = result.finalReplySource !== "renderer"
        && !result.fallbackOutcomeContext;
      const normalizedReply = normalizeRouteFinalReply(
        appendHistoricalDateSuffixIfMissing(replyText, affectedDate),
        mutationProjection,
        summaryHistoryFacts,
        {
          composeSummaryHistory: shouldComposeSummaryHistory,
          rendererOwnedSummaryHistory: result.finalReplySource === "renderer",
        },
      ).reply;
      const alreadyPersistedAssistantReply = result.assistantReplyPersistence === "already_persisted";
      let sanitizedFallback = sanitizeReply(normalizedReply);
      if (alreadyPersistedAssistantReply) {
        streamProposalCard = proposalCard && isProjectedProposalCard(proposalCard)
          ? proposalCard
          : undefined;
      } else {
        const finalized = await finalizeAssistantReply(
          deps.chatService,
          deviceId,
          normalizedReply,
          streamReceiptIdentity,
          {
            mutationOutcomeFact: streamMutationOutcomeFact,
            log: deps.log,
            transport: "sse",
          },
        );
        streamProposalCard = await persistProposalCardForAssistant({
          proposalCardService: deps.proposalCardService,
          deviceId,
          assistantMessageId: finalized.assistantMessageId,
          proposalCard,
        });
        sanitizedFallback = finalized.sanitized;
        streamReceiptPersistence = finalized.receiptPersistence;
      }
      const canProjectStreamReceipt = streamReceiptPersistence === "persisted";
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedFallback })}\n\n`);
      const doneData = {
        turnId: stopControl.turnId,
        didLogMeal,
        didMutateMeal: streamDidMutateMeal,
        ...(result.fallbackOutcomeContext || result.finalReplySource === "fallback"
          ? { replyText: sanitizedFallback }
          : {}),
        ...(canProjectStreamReceipt && streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
        ...(dailySummary ? { dailySummary } : {}),
        ...(summaryOutcome ? { summaryOutcome } : {}),
        ...(dailyTargets ? { dailyTargets } : {}),
        ...(affectedDate ? { affectedDate } : {}),
        ...(deletedMealId ? { deletedMealId } : {}),
        ...(streamProposalCard ? { proposalCard: streamProposalCard } : {}),
        ...(streamProposalActionEvent ? { proposalActionEvent: streamProposalActionEvent } : {}),
      };
      stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
      if (result.fallbackOutcomeContext) {
        const providerMetadata = result.providerFallbackContext?.reason === "llm_error"
          && result.fallbackOutcomeContext.reason === "llm_error"
          ? result.providerFallbackContext.providerMetadata
          : undefined;
        recordSseFallback({
          fallbackSource: result.fallbackOutcomeContext.fallbackSource,
          reason: result.fallbackOutcomeContext.reason,
          ...(result.fallbackOutcomeContext.round !== undefined ? { round: result.fallbackOutcomeContext.round } : {}),
          ...(result.fallbackOutcomeContext.lastTool !== undefined ? { lastTool: result.fallbackOutcomeContext.lastTool } : {}),
          ...(providerMetadata !== undefined ? { providerMetadata } : {}),
          didLogMeal,
          didMutateMeal: streamDidMutateMeal,
        });
      } else {
        recordSseCompletion({ didLogMeal, didMutateMeal: streamDidMutateMeal });
      }
      if (!streamProposalActionEvent) {
        publishSummarySafe(deps.publisher, deviceId, mutationProjection.shouldPublishDailySummary, dailySummary, affectedDate, deps.log);
      }
    }
  } catch (error) {
    const fallback = streamDidLogMeal
      ? (streamLoggedMeal ?? PARTIAL_SUCCESS_FALLBACK)
      : streamDidMutateMeal
        ? PARTIAL_MUTATION_FALLBACK
        : UNIFIED_FALLBACK;
    let catchSite: RouteCatchSite = "sse_outer";
    const providerFallback = providerStreamFallback(
      error,
      streamDidMutateMeal ? "partial_success" : "llm_error",
    );
    let sanitizedCatchError = providerFallback ? {} : sanitizeRouteCatchError(error);
    let terminalReplyText = "";
    recorder?.recordFinalReply({ source: "fallback", shape: "fallback_text" });
    try {
      if (!userMessagePersisted) {
        await deps.chatService.saveMessage(
          deviceId,
          "user",
          message,
          durableAssetRef ? { imagePath: durableAssetRef } : undefined,
        );
        userMessagePersisted = true;
      }
      const finalized = await finalizeAssistantReply(
        deps.chatService,
        deviceId,
        fallback,
        streamReceiptIdentity,
        {
          mutationOutcomeFact: streamMutationOutcomeFact,
          log: deps.log,
          transport: "sse",
        },
      );
      const sanitizedFallback = finalized.sanitized;
      terminalReplyText = sanitizedFallback;
      streamReceiptPersistence = finalized.receiptPersistence;
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedFallback })}\n\n`);
    } catch (persistError) {
      catchSite = "sse_persist";
      sanitizedCatchError = providerFallback ? {} : sanitizeRouteCatchError(persistError);
      if (streamReceiptIdentity || streamMutationOutcomeFact) {
        streamReceiptPersistence = "failed_closed";
      }
      const closedFallback = streamDidLogMeal
        ? PARTIAL_SUCCESS_FALLBACK
        : streamDidMutateMeal
          ? PARTIAL_MUTATION_FALLBACK
          : UNIFIED_FALLBACK;
      terminalReplyText = closedFallback;
      // If history persistence also fails, still close the stream with done.
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: closedFallback })}\n\n`);
    }
    const canProjectStreamReceipt = streamReceiptPersistence === "persisted";
    const doneData = {
      turnId: stopControl.turnId,
      didLogMeal: streamDidLogMeal,
      didMutateMeal: streamDidMutateMeal,
      replyText: terminalReplyText,
      ...(canProjectStreamReceipt && streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
      ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
      ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
      ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
      ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
      ...(streamDeletedMealId ? { deletedMealId: streamDeletedMealId } : {}),
      ...(streamProposalCard ? { proposalCard: streamProposalCard } : {}),
    };
    stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
    recordSseFallback({
      ...(providerFallback ?? {
        fallbackSource: "route_catch" as const,
        reason: "route_catch" as const,
        catchSite,
        ...sanitizedCatchError,
      }),
      didLogMeal: streamDidLogMeal,
      didMutateMeal: streamDidMutateMeal,
    });
    publishSummarySafe(deps.publisher, deviceId, streamShouldPublishDailySummary, streamDailySummary, streamAffectedDate, deps.log);
  } finally {
    await cleanupDurableAssetSafe(
      deps.assetService,
      deviceId,
      durableAssetId,
      durableAssetRef,
      deps.log,
    );
    await cleanupUploadSafe(image?.path, deps.log);
    stream.end();
  }
}

export function registerChatRoutes(app: FastifyInstance, deps: Deps) {
  const {
    orchestrator,
    assetService,
    chatService,
    proposalCardService,
    deviceService,
    guestSessionService,
    goalProposalService,
    mealNumericProposalService,
    mealDeleteProposalService,
    publisher,
    uploadsDir: injectedUploadsDir,
    llmTraceRecorderFactory,
  } = deps;

  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "POST",
    url: "/api/chat/stop",
    protectedMeta: PROTECTED_ROUTE_META.chatStop,
    handler: async (request, reply) => {
    const { deviceId } = getProtectedOwner(request);
    const body = request.body as { turnId?: unknown } | undefined;
    const turnId = body?.turnId;
    if (typeof turnId !== "string" || !turnId.trim()) {
      return reply.code(400).send({ error: "turnId is required" });
    }
    const trimmedTurnId = turnId.trim();

    const activeTurn = activeChatTurns.get(activeChatTurnKey(deviceId, trimmedTurnId));
    if (!activeTurn) {
      return reply.code(404).send({ error: "Active turn not found" });
    }

    activeTurn.stopRequested = true;
    if (!activeTurn.controller.signal.aborted) {
      activeTurn.controller.abort();
    }

    return { stopped: true, turnId: trimmedTurnId };
    },
  });

  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "POST",
    url: "/api/chat",
    protectedMeta: PROTECTED_ROUTE_META.chatMessage,
    multipartBodySelectorHandling: "route_parser",
    handler: async (request, reply) => {
    const { deviceId } = getProtectedOwner(request);
    const resolvedUploadsDir = injectedUploadsDir ?? config.uploadsStagingDir;
    const parseResult = await parseMultipartRequest(request, resolvedUploadsDir);

    if ("error" in parseResult) {
      request.log.warn({ event: "chat_multipart_rejected", reason: parseResult.error }, "Chat multipart request rejected");
      return reply.code(parseResult.code).send({ error: parseResult.error });
    }

    const { message, image, proposalContext } = parseResult;
    const chatTurnStartedAt = Date.now();
    const hadImage = Boolean(image);
    const { turnId, turnLog, orchLog } = createChatTurnContext(request);

    // Branch on SSE opt-in (T-03c-01: keep explicit JSON fallback for non-SSE callers)
    const acceptHeader = request.headers["accept"] ?? "";
    const wantsSSE = acceptHeader.includes("text/event-stream");

    if (!wantsSSE) {
      let durableAssetId: string | undefined;
      let durableAssetRef: string | undefined;
      let userMessagePersisted = false;
      let jsonDidLogMeal = false;
      let jsonDidMutateMeal = false;
      let jsonShouldPublishDailySummary = false;
      let jsonDailySummary: unknown;
      let jsonSummaryOutcome: SummaryOutcome | undefined;
      let jsonDailyTargets: unknown;
      let jsonAffectedDate: string | undefined;
      let jsonDeletedMealId: string | undefined;
      let jsonProposalCard: ProposalCardClientMetadata | undefined;
      let jsonProposalActionEvent: ProposalActionEventClientMetadata | undefined;
      let jsonLoggedMealFallback: string | undefined;
      let jsonLoggedMealReceipt: ReturnType<typeof projectLoggedMealReceipt>;
      let jsonReceiptIdentity: ReceiptIdentity | undefined;
      let jsonMutationOutcomeFact: ChatMutationOutcomeFact | undefined;
      let jsonReceiptPersistence: ReceiptPersistence = "not_applicable";
      const traceRecorder = llmTraceRecorderFactory?.();
      const hooks = fanOutOrchestratorHooks(
        createStructuredHooks(orchLog),
        traceRecorder?.asOrchestratorHooks(),
      );
      const recordJsonCompletion = (params: {
        didLogMeal: boolean;
        didMutateMeal: boolean;
      }) => {
        const latencyMs = Date.now() - chatTurnStartedAt;
        traceRecorder?.recordRouteCompletion({
          transport: "json",
          turnId,
          didLogMeal: params.didLogMeal,
          didMutateMeal: params.didMutateMeal,
          completed: true,
        });
        traceRecorder?.recordMetrics({ latencyMs });
        logChatTurnCompleted(turnLog, {
          source: "json",
          turnId,
          didLogMeal: params.didLogMeal,
          didMutateMeal: params.didMutateMeal,
          hadImage,
          latencyMs,
        });
      };
      const recordJsonFallback = (params: {
        fallbackSource: RouteFallbackSource;
        reason?: RouteFallbackReason;
        round?: number;
        lastTool?: string;
        catchSite?: RouteCatchSite;
        errorName?: string;
        errorMessage?: string;
        providerMetadata?: ProviderErrorMetadata;
        didLogMeal: boolean;
        didMutateMeal: boolean;
      }) => {
        const latencyMs = Date.now() - chatTurnStartedAt;
        traceRecorder?.recordRouteFallback({
          transport: "json",
          turnId,
          fallbackSource: params.fallbackSource,
          ...(params.reason !== undefined ? { reason: params.reason } : {}),
          didLogMeal: params.didLogMeal,
          didMutateMeal: params.didMutateMeal,
          ...(params.catchSite !== undefined ? { catchSite: params.catchSite } : {}),
          ...(params.providerMetadata !== undefined ? { providerMetadata: params.providerMetadata } : {}),
          ...(params.round !== undefined ? { round: params.round } : {}),
          ...(params.lastTool !== undefined ? { lastTool: params.lastTool } : {}),
          ...(params.errorName !== undefined ? { errorName: params.errorName } : {}),
          ...(params.errorMessage !== undefined ? { errorMessage: params.errorMessage } : {}),
        });
        traceRecorder?.recordMetrics({ latencyMs });
        logChatRouteFallback(turnLog, {
          source: "json",
          turnId,
          fallbackSource: params.fallbackSource,
          ...(params.reason !== undefined ? { reason: params.reason } : {}),
          ...(params.catchSite !== undefined ? { catchSite: params.catchSite } : {}),
          didLogMeal: params.didLogMeal,
          didMutateMeal: params.didMutateMeal,
          hadImage,
          latencyMs,
          ...(params.round !== undefined ? { round: params.round } : {}),
          ...(params.lastTool !== undefined ? { lastTool: params.lastTool } : {}),
          ...(params.providerMetadata !== undefined ? { providerMetadata: params.providerMetadata } : {}),
          ...(params.errorName !== undefined ? { errorName: params.errorName } : {}),
          ...(params.errorMessage !== undefined ? { errorMessage: params.errorMessage } : {}),
        });
      };

      try {
        const durableAsset = await createDurableAssetIfNeeded(assetService, deviceId, image);
        durableAssetId = durableAsset?.assetId;
        durableAssetRef = durableAsset?.assetRef;

        // JSON path: existing non-SSE callers remain intact
        const result = await orchestrator.handleMessage(
          deviceId,
          message,
          image?.dataUri,
          durableAssetRef,
          {
            onUserMessageSaved: () => {
              userMessagePersisted = true;
            },
            hooks,
            turnId,
            log: turnLog,
            proposalContext,
          },
        );
        const jsonMutationProjection = projectRouteMutationState(result);
        jsonDidLogMeal = jsonMutationProjection.didLogMeal;
        jsonDidMutateMeal = jsonMutationProjection.didMutateMeal;
        jsonShouldPublishDailySummary = jsonMutationProjection.shouldPublishDailySummary;
        jsonDailySummary = result.dailySummary;
        jsonSummaryOutcome = result.summaryOutcome;
        jsonDailyTargets = result.dailyTargets;
        jsonAffectedDate = result.affectedDate;
        jsonDeletedMealId = result.deletedMealId;
        jsonLoggedMealFallback = result.loggedMeal
          ? buildPartialSuccessLoggedReply(result.loggedMeal)
          : undefined;
        jsonLoggedMealReceipt = projectLoggedMealReceipt(result.loggedMeal);
        jsonReceiptIdentity = buildReceiptIdentity(result.loggedMeal, result.loggedMealToolMessageId);
        jsonMutationOutcomeFact = result.mutationOutcomeFact;
        jsonProposalActionEvent = result.proposalActionEvent;

        if ("streamGenerator" in result) {
          // Non-SSE caller received a stream result — drain and return as JSON
          const { streamGenerator, dailySummary, summaryHistoryFacts, affectedDate } = result;
          const didLogMeal = jsonMutationProjection.didLogMeal;
          const didMutateMeal = jsonMutationProjection.didMutateMeal;
          let fullReply = "";
          let hallucinationDetected = false;
          for await (const token of streamGenerator) {
            fullReply += token;
            if (CHOICE_PROMPT_PATTERN.test(fullReply)) {
              hallucinationDetected = true;
              break;
            }
          }
          const fallbackReply = didMutateMeal
            ? (jsonLoggedMealFallback ?? PARTIAL_MUTATION_FALLBACK)
            : "抱歉，無法辨識這次的請求，可以再試一次或補充文字描述嗎？";
          const modelReplyText = hallucinationDetected
            ? fallbackReply
            : appendHistoricalDateSuffixIfMissing(fullReply, affectedDate);
          const { reply: replyText, composedSummaryHistory } = normalizeRouteFinalReply(
            modelReplyText,
            jsonMutationProjection,
            summaryHistoryFacts,
            { composeSummaryHistory: !hallucinationDetected },
          );
          const finalized = await finalizeAssistantReply(
            chatService,
            deviceId,
            replyText,
            jsonReceiptIdentity,
            {
              mutationOutcomeFact: jsonMutationOutcomeFact,
              log: turnLog,
              transport: "json",
            },
          );
          const sanitized = finalized.sanitized;
          jsonReceiptPersistence = finalized.receiptPersistence;
          const canProjectJsonReceipt = jsonReceiptPersistence === "persisted";
          jsonProposalCard = await persistProposalCardForAssistant({
            proposalCardService,
            deviceId,
            assistantMessageId: finalized.assistantMessageId,
            proposalCard: result.proposalCard,
          });
          traceRecorder?.recordFinalReply({
            source: hallucinationDetected ? "fallback" : composedSummaryHistory ? "renderer" : "model",
            shape: sanitized.trim() ? (hallucinationDetected ? "fallback_text" : "streamed_text") : "empty_or_missing",
          });
          // D-03/C6: JSON path publish boundary — immediately before reply.send().
          // C1: try/catch ensures publish failure never changes the HTTP response or status code.
          publishSummarySafe(
            publisher,
            deviceId,
            jsonMutationProjection.shouldPublishDailySummary,
            dailySummary,
            affectedDate,
            turnLog,
          );
          if (hallucinationDetected) {
            recordJsonFallback({
              fallbackSource: "route_hallucination",
              reason: "hallucination_detected",
              didLogMeal,
              didMutateMeal,
            });
          } else {
            recordJsonCompletion({ didLogMeal, didMutateMeal });
          }
          return {
            turnId,
            reply: sanitized,
            didLogMeal,
            ...(result.didMutateMeal !== undefined ? { didMutateMeal: result.didMutateMeal } : {}),
            ...(canProjectJsonReceipt && jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
            ...(dailySummary ? { dailySummary } : {}),
            ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
            ...(result.dailyTargets ? { dailyTargets: result.dailyTargets } : {}),
            ...(affectedDate ? { affectedDate } : {}),
            ...(jsonDeletedMealId ? { deletedMealId: jsonDeletedMealId } : {}),
            ...(jsonProposalCard ? { proposalCard: jsonProposalCard } : {}),
            ...(jsonProposalActionEvent ? { proposalActionEvent: jsonProposalActionEvent } : {}),
          };
        }

        const { reply: replyText, dailySummary, summaryHistoryFacts, dailyTargets, affectedDate } = result;
        const didLogMeal = jsonMutationProjection.didLogMeal;
        jsonProposalActionEvent = result.proposalActionEvent;
        const shouldComposeSummaryHistory = result.finalReplySource !== "renderer"
          && !result.fallbackOutcomeContext;
        const normalizedReply = normalizeRouteFinalReply(
          appendHistoricalDateSuffixIfMissing(replyText, affectedDate),
          jsonMutationProjection,
          summaryHistoryFacts,
          {
            composeSummaryHistory: shouldComposeSummaryHistory,
            rendererOwnedSummaryHistory: result.finalReplySource === "renderer",
          },
        ).reply;
        const alreadyPersistedAssistantReply = result.assistantReplyPersistence === "already_persisted";
        let sanitizedJson = sanitizeReply(normalizedReply);
        if (alreadyPersistedAssistantReply) {
          jsonProposalCard = result.proposalCard && isProjectedProposalCard(result.proposalCard)
            ? result.proposalCard
            : undefined;
        } else {
          const finalized = await finalizeAssistantReply(
            chatService,
            deviceId,
            normalizedReply,
            jsonReceiptIdentity,
            {
              mutationOutcomeFact: jsonMutationOutcomeFact,
              log: turnLog,
              transport: "json",
            },
          );
          sanitizedJson = finalized.sanitized;
          jsonReceiptPersistence = finalized.receiptPersistence;
          jsonProposalCard = await persistProposalCardForAssistant({
            proposalCardService,
            deviceId,
            assistantMessageId: finalized.assistantMessageId,
            proposalCard: result.proposalCard,
          });
        }
        const canProjectJsonReceipt = jsonReceiptPersistence === "persisted";
        traceRecorder?.recordFinalReply({
          source: result.finalReplySource ?? "model",
          shape: result.finalReplyShape ?? "empty_or_missing",
        });
        // D-03/C6: JSON path publish boundary — immediately before reply.send().
        // C1: try/catch ensures publish failure never changes the HTTP response or status code.
        if (!jsonProposalActionEvent) {
          publishSummarySafe(publisher, deviceId, jsonMutationProjection.shouldPublishDailySummary, dailySummary, affectedDate, turnLog);
        }
        if (result.fallbackOutcomeContext) {
          const providerMetadata = result.providerFallbackContext?.reason === "llm_error"
            && result.fallbackOutcomeContext.reason === "llm_error"
            ? result.providerFallbackContext.providerMetadata
            : undefined;
          recordJsonFallback({
            fallbackSource: result.fallbackOutcomeContext.fallbackSource,
            reason: result.fallbackOutcomeContext.reason,
            ...(result.fallbackOutcomeContext.round !== undefined ? { round: result.fallbackOutcomeContext.round } : {}),
            ...(result.fallbackOutcomeContext.lastTool !== undefined ? { lastTool: result.fallbackOutcomeContext.lastTool } : {}),
            ...(providerMetadata !== undefined ? { providerMetadata } : {}),
            didLogMeal,
            didMutateMeal: jsonDidMutateMeal,
          });
        } else {
          recordJsonCompletion({ didLogMeal, didMutateMeal: jsonDidMutateMeal });
        }
        return {
          turnId,
          reply: sanitizedJson,
          didLogMeal,
          ...(result.didMutateMeal !== undefined ? { didMutateMeal: result.didMutateMeal } : {}),
          ...(canProjectJsonReceipt && jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
          ...(dailySummary ? { dailySummary } : {}),
          ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
          ...(dailyTargets ? { dailyTargets } : {}),
          ...(affectedDate ? { affectedDate } : {}),
          ...(jsonDeletedMealId ? { deletedMealId: jsonDeletedMealId } : {}),
          ...(jsonProposalCard ? { proposalCard: jsonProposalCard } : {}),
          ...(jsonProposalActionEvent ? { proposalActionEvent: jsonProposalActionEvent } : {}),
        };
      } catch (error) {
        const fallback = jsonDidLogMeal
          ? (jsonLoggedMealFallback ?? PARTIAL_SUCCESS_FALLBACK)
          : jsonDidMutateMeal
            ? PARTIAL_MUTATION_FALLBACK
            : UNIFIED_FALLBACK;
        const providerFallback = providerStreamFallback(
          error,
          jsonDidMutateMeal ? "partial_success" : "llm_error",
        );
        const sanitizedCatchError = providerFallback ? {} : sanitizeRouteCatchError(error);
        if (!userMessagePersisted) {
          await chatService.saveMessage(
            deviceId,
            "user",
            message,
            durableAssetRef ? { imagePath: durableAssetRef } : undefined,
          );
          userMessagePersisted = true;
        }
        const finalized = await finalizeAssistantReply(
          chatService,
          deviceId,
          fallback,
          jsonReceiptIdentity,
          {
            mutationOutcomeFact: jsonMutationOutcomeFact,
            log: turnLog,
            transport: "json",
          },
        );
        const sanitizedJson = finalized.sanitized;
        jsonReceiptPersistence = finalized.receiptPersistence;
        // D-03/C6: JSON catch path publish boundary — immediately before reply.send().
        // C1: try/catch ensures publish failure never changes the HTTP response or status code.
        publishSummarySafe(publisher, deviceId, jsonShouldPublishDailySummary, jsonDailySummary, jsonAffectedDate, turnLog);
        traceRecorder?.recordFinalReply({ source: "fallback", shape: "fallback_text" });
        recordJsonFallback({
          ...(providerFallback ?? {
            fallbackSource: "route_catch" as const,
            reason: "route_catch" as const,
            catchSite: "json_outer" as const,
            ...sanitizedCatchError,
          }),
          didLogMeal: jsonDidLogMeal,
          didMutateMeal: jsonDidMutateMeal,
        });
        return {
          turnId,
          reply: sanitizedJson,
          didLogMeal: jsonDidLogMeal,
          ...(jsonDidMutateMeal ? { didMutateMeal: true } : {}),
          ...(jsonReceiptPersistence === "persisted" && jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
          ...(jsonDailySummary ? { dailySummary: jsonDailySummary } : {}),
          ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
          ...(jsonDailyTargets ? { dailyTargets: jsonDailyTargets } : {}),
          ...(jsonAffectedDate ? { affectedDate: jsonAffectedDate } : {}),
          ...(jsonDeletedMealId ? { deletedMealId: jsonDeletedMealId } : {}),
          ...(jsonProposalCard ? { proposalCard: jsonProposalCard } : {}),
          ...(jsonProposalActionEvent ? { proposalActionEvent: jsonProposalActionEvent } : {}),
        };
      } finally {
        await cleanupDurableAssetSafe(
          assetService,
          deviceId,
          durableAssetId,
          durableAssetRef,
          turnLog,
        );
        // D-08: Delete upload file after processing completes (success or failure).
        await cleanupUploadSafe(image?.path, turnLog);
      }
    }

    // SSE path: open stream BEFORE awaiting orchestrator so status labels are
    // visible during the real waiting period (D-03, D-04, D-05).
    const stream = new PassThrough();
    const turnKey = activeChatTurnKey(deviceId, turnId);
    const activeTurn: ActiveChatTurn = {
      controller: new AbortController(),
      stopRequested: false,
      completed: false,
    };
    activeChatTurns.set(turnKey, activeTurn);

    request.raw.on("close", () => {
      if (!activeTurn.completed && !activeTurn.stopRequested && !activeTurn.controller.signal.aborted) {
        activeTurn.controller.abort();
      }
    });

    reply
      .code(200)
      .type("text/event-stream")
      .header("cache-control", "no-cache")
      .send(stream);

    stream.write(`event: start\ndata: ${JSON.stringify({ turnId })}\n\n`);

    const traceRecorder = llmTraceRecorderFactory?.();
    const hooks = fanOutOrchestratorHooks(
      createStructuredHooks(orchLog),
      traceRecorder?.asOrchestratorHooks(),
    );

    setImmediate(() => {
      void handleOrchestratorSSE(
        stream,
        { assetService, orchestrator, chatService, proposalCardService, publisher, log: turnLog },
        deviceId,
        message,
        image,
        proposalContext,
        chatTurnStartedAt,
        hooks,
        traceRecorder,
        {
          turnId,
          signal: activeTurn.controller.signal,
          isStopped: () => activeTurn.stopRequested,
        },
      ).finally(() => {
        activeTurn.completed = true;
        activeChatTurns.delete(turnKey);
      });
    });

    return reply;
    },
  });

  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "GET",
    url: "/api/chat/history",
    protectedMeta: PROTECTED_ROUTE_META.chatHistory,
    handler: async (request, reply) => {
    const { deviceId } = getProtectedOwner(request);
    const { limit } = request.query as { limit?: string };
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      return reply.code(400).send({ error: "Invalid limit. Must be an integer between 1 and 200." });
    }
    const activeProposals = await loadActiveProposalSnapshots(
      { goalProposalService, mealNumericProposalService, mealDeleteProposalService },
      deviceId,
    );
    const messages = await chatService.getHistory(deviceId, parsedLimit, { activeProposals });
    return {
      messages: messages.map((message) => {
        const { deviceId: _deviceId, ...publicMessage } = message;
        void _deviceId;
        return {
          ...publicMessage,
          ...projectAssetFields(message.imagePath),
        };
      }),
    };
    },
  });
}
