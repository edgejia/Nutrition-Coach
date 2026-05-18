import { PassThrough } from "node:stream";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyBaseLogger } from "fastify";
import type { createOrchestrator } from "../orchestrator/index.js";
import {
  composeSummaryHistoryReply,
  type SummaryHistoryFacts,
} from "../orchestrator/summary-history-renderer.js";
import { buildAssetUrl, makeAssetRef, parseAssetRef, type createAssetService } from "../services/assets.js";
import type { createChatService } from "../services/chat.js";
import type { createDeviceService } from "../services/device.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { DailySummary } from "../services/summary.js";
import { CHOICE_PROMPT_PATTERN } from "../orchestrator/patterns.js";
import { createStructuredHooks } from "../orchestrator/hooks.js";
import type { OrchestratorHooks } from "../orchestrator/hooks.js";
import { buildPartialSuccessLoggedReply, guardNoMutationLoggingClaim } from "../orchestrator/index.js";
import type {
  LlmTraceFinalReplyShape,
  LlmTraceFinalReplySource,
  LlmTraceRecorder,
} from "../orchestrator/llm-trace.js";
import type { ToolExecutionResult } from "../orchestrator/tools.js";
import { config } from "../config.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import { isLLMProviderError } from "../llm/errors.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import type { SummaryOutcome } from "../services/summary-outcome.js";
import {
  logChatRouteFallback,
  logChatTurnCompleted,
  sanitizeRouteCatchError,
  type RouteCatchSite,
  type RouteFallbackReason,
  type RouteFallbackSource,
} from "../observability/events.js";
import type { ProviderErrorMetadata } from "../llm/types.js";

interface Deps {
  orchestrator: ReturnType<typeof createOrchestrator>;
  assetService: ReturnType<typeof createAssetService>;
  chatService: ReturnType<typeof createChatService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  publisher: RealtimePublisher;
  /**
   * Override the upload storage directory. When undefined the route falls back
   * to `config.uploadsStagingDir` (production behaviour unchanged). Pass a
   * scenario-local temp directory in harness runs to prevent staged residue.
   */
  uploadsDir?: string;
  llmTraceRecorderFactory?: () => LlmTraceRecorder | undefined;
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SENSITIVE_IDENTIFIERS = [
  "log_food",
  "get_daily_summary",
  "protein_sources",
  "usedConservativeAssumption",
  "quantityUncertaintyReason",
  "missing_quantity",
];
const UNIFIED_FALLBACK = "抱歉，這次無法完成請求，請稍後再試或補充描述。";
const PARTIAL_SUCCESS_FALLBACK = "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。";
const PARTIAL_MUTATION_FALLBACK = "已完成餐點調整，但回覆生成失敗，請稍後確認今日攝取摘要。";
const CONCRETE_DATE_PATTERN = /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\d{1,2}\/\d{1,2}(?!\/\d)|\d{1,2}月\d{1,2}日/;
type LoggedMealReceipt = NonNullable<ToolExecutionResult["loggedMeal"]>;
type ReceiptIdentity = {
  mealTransactionId: string;
  mealRevisionId: string;
  toolMessageId?: string;
};
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

// Last-gate filter: strip internal tool identifiers even when the model ignores
// the system prompt rule. Applied to every reply before DB write and client emit.
function sanitizeReply(text: string): string {
  return text
    .replace(/log_food/g, "完成記錄")
    .replace(/get_daily_summary/g, "查詢今日攝取")
    .replace(/protein_sources/g, "蛋白質來源")
    .replace(/usedConservativeAssumption/g, "保守假設")
    .replace(/quantityUncertaintyReason/g, "份量不確定原因")
    .replace(/missing_quantity/g, "缺少份量")
    .replace(/[（(]\s*\d+\s*\/\s*\d+\s*[）)]/g, "");
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
  didLogMeal: boolean,
  didMutateMeal: boolean,
  summaryHistoryFacts: SummaryHistoryFacts | undefined,
): summaryHistoryFacts is SummaryHistoryFacts {
  return !didLogMeal && !didMutateMeal && Boolean(summaryHistoryFacts?.dailySummary);
}

function normalizeRouteFinalReply(
  rawReply: string,
  didLogMeal: boolean,
  didMutateMeal: boolean,
  summaryHistoryFacts: SummaryHistoryFacts | undefined,
  opts: { composeSummaryHistory?: boolean; rendererOwnedSummaryHistory?: boolean } = {},
): { reply: string; composedSummaryHistory: boolean } {
  const composedSummaryHistory = opts.composeSummaryHistory !== false
    && shouldComposeSummaryHistoryReply(didLogMeal, didMutateMeal, summaryHistoryFacts);
  const rendererOwnedSummaryHistory = opts.rendererOwnedSummaryHistory === true
    && shouldComposeSummaryHistoryReply(didLogMeal, didMutateMeal, summaryHistoryFacts);
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
    reply: guardNoMutationLoggingClaim(reply, didLogMeal, didMutateMeal, {
      summaryHistoryFacts,
    }),
    composedSummaryHistory,
  };
}

async function finalizeAssistantReply(
  chatService: ReturnType<typeof createChatService>,
  deviceId: string,
  rawReply: string,
  receiptIdentity?: ReceiptIdentity,
  opts?: { status?: "complete" | "stopped" | "error" },
): Promise<{ sanitized: string; assistantMessageId: string }> {
  const sanitized = sanitizeReply(rawReply);
  const assistantMessage = await chatService.saveMessage(
    deviceId,
    "assistant",
    sanitized,
    opts?.status ? { status: opts.status } : undefined,
  );
  if (receiptIdentity) {
    await chatService.saveMealReceiptReference({
      deviceId,
      assistantMessageId: assistantMessage.id,
      toolMessageId: receiptIdentity.toolMessageId,
      mealTransactionId: receiptIdentity.mealTransactionId,
      mealRevisionId: receiptIdentity.mealRevisionId,
    });
  }
  return { sanitized, assistantMessageId: assistantMessage.id };
}

function createStreamingSanitizer() {
  let tail = "";

  return {
    push(token: string): string {
      tail += token;
      const endsWithCompleteIdentifier = SENSITIVE_IDENTIFIERS.some((identifier) => tail.endsWith(identifier));
      const overlapLength = endsWithCompleteIdentifier
        ? 0
        : SENSITIVE_IDENTIFIERS.reduce((maxOverlap, identifier) => {
          for (let prefixLength = identifier.length - 1; prefixLength > 0; prefixLength -= 1) {
            if (tail.endsWith(identifier.slice(0, prefixLength))) {
              return Math.max(maxOverlap, prefixLength);
            }
          }

          return maxOverlap;
        }, 0);

      if (tail.length <= overlapLength) {
        return "";
      }

      const safePrefix = tail.slice(0, tail.length - overlapLength);
      tail = tail.slice(tail.length - overlapLength);
      return sanitizeReply(safePrefix);
    },
    flush(): string {
      const finalChunk = sanitizeReply(tail);
      tail = "";
      return finalChunk;
    },
  };
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

async function parseMultipartRequest(
  request: FastifyRequest,
  uploadsDir: string,
): Promise<
  | {
      message: string;
      image?: { dataUri: string; path: string; mimeType: string; originalFilename?: string };
    }
  | { error: string; code: number }
> {
  let message = "";
  let image:
    | { dataUri: string; path: string; mimeType: string; originalFilename?: string }
    | undefined;
  const savedImagePaths: string[] = [];

  async function reject(error: string, code: number) {
    await Promise.all(savedImagePaths.map((imagePath) => cleanupUploadSafe(imagePath, request.log)));
    return { error, code };
  }

  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { error: "Content-Type must be multipart/form-data", code: 400 };
  }

  const parts = request.parts();
  for await (const part of parts) {
    if (part.type === "field" && part.fieldname === "message") {
      message = part.value as string;
    } else if (part.type === "file" && part.fieldname === "image") {
      if (!ALLOWED_TYPES.includes(part.mimetype)) {
        return reject("Invalid image type. Allowed: jpeg, png, webp", 400);
      }
      if (image) {
        return reject("Only one image upload is allowed", 400);
      }
      const buffer = await part.toBuffer();
      if (buffer.length > 5 * 1024 * 1024) {
        return reject("Image too large. Max 5MB.", 400);
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

  if (!message && image) {
    message = "(圖片)";
  }

  if (!message && !image) {
    return { error: "Message or image required", code: 400 };
  }

  return { message, image };
}

function publishSummarySafe(
  publisher: RealtimePublisher,
  deviceId: string,
  didMutateMeal: boolean,
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
    !didMutateMeal
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
    !Number.isFinite(fat)
  ) {
    return undefined;
  }

  return {
    ...(typeof mealId === "string" ? { mealId } : {}),
    ...(typeof dateKey === "string" ? { dateKey } : {}),
    ...(typeof mealRevisionId === "string" ? { mealRevisionId } : {}),
    ...(typeof loggedAt === "string" ? { loggedAt } : {}),
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

function providerStreamFallback(error: unknown):
  | {
      fallbackSource: "orchestrator";
      reason: "llm_error";
      providerMetadata: ProviderErrorMetadata;
    }
  | undefined {
  if (!isLLMProviderError(error)) {
    return undefined;
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
  didLogMeal: boolean,
  didMutateMeal: boolean,
  dailySummary: unknown,
  summaryHistoryFacts: SummaryHistoryFacts | undefined,
  receiptIdentity: ReceiptIdentity | undefined,
  affectedDate?: string,
  partialMutationReply?: string,
  hooks?: OrchestratorHooks,
  stopControl?: StreamingStopControl,
): Promise<StreamingReplyResult> {
  const sanitizer = createStreamingSanitizer();
  const hasSummaryContext = Boolean(summaryHistoryFacts?.dailySummary ?? dailySummary);
  const shouldGuardNoMutationModelText = !didLogMeal && !didMutateMeal && !hasSummaryContext;
  const shouldHoldNoMutationSummaryText = !didLogMeal && !didMutateMeal && hasSummaryContext;
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
      guardNoMutationLoggingClaim(fullReply, didLogMeal, didMutateMeal, {
        summaryHistoryFacts,
      }),
    ) || "（已停止）";
    await finalizeAssistantReply(chatService, deviceId, stoppedReply, receiptIdentity, { status: "stopped" });
    return {
      fullReply: stoppedReply,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      stopped: true,
      tokensStreamed,
      finalReplySource: "model",
      finalReplyShape: stoppedReply.trim() ? "streamed_text" : "empty_or_missing",
    };
  }

  if (hallucinationDetected) {
    hooks?.onFallback?.({ reason: "hallucination_detected" });
    const retryMsg = didMutateMeal && partialMutationReply
      ? partialMutationReply
      : "抱歉，無法辨識這次的請求，可以再試一次或補充文字描述嗎？";
    await finalizeAssistantReply(chatService, deviceId, retryMsg, receiptIdentity);
    stream.write(`event: chunk\ndata: ${JSON.stringify({ token: retryMsg })}\n\n`);
    return {
      fullReply: retryMsg,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      tokensStreamed,
      finalReplySource: "fallback",
      finalReplyShape: "fallback_text",
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
  } = normalizeRouteFinalReply(fullReply, didLogMeal, didMutateMeal, summaryHistoryFacts);
  if (noMutationLoggingClaimDetected || guardedFullReply !== fullReply) {
    const sanitizedReply = sanitizeReply(guardedFullReply);
    const finalChunk = sanitizer.flush();
    if (finalChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: finalChunk })}\n\n`);
    }
    if (sanitizedReply) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedReply })}\n\n`);
    }
    await finalizeAssistantReply(chatService, deviceId, sanitizedReply, receiptIdentity);
    return {
      fullReply: sanitizedReply,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      tokensStreamed,
      finalReplySource: composedSummaryHistory ? "renderer" : "fallback",
      finalReplyShape: composedSummaryHistory
        ? (sanitizedReply.trim() ? "streamed_text" : "empty_or_missing")
        : (sanitizedReply.trim() ? "fallback_text" : "empty_or_missing"),
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
    await finalizeAssistantReply(chatService, deviceId, guardedFullReply, receiptIdentity);
    return {
      fullReply: guardedFullReply,
      didLogMeal,
      dailySummary,
      summaryHistoryFacts,
      tokensStreamed,
      finalReplySource: composedSummaryHistory ? "renderer" : "model",
      finalReplyShape: guardedFullReply.trim() ? "streamed_text" : "empty_or_missing",
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
  await finalizeAssistantReply(chatService, deviceId, fullReply, receiptIdentity);
  return {
    fullReply,
    didLogMeal,
    dailySummary,
    summaryHistoryFacts,
    tokensStreamed,
    finalReplySource: "model",
    finalReplyShape: fullReply.trim() ? "streamed_text" : "empty_or_missing",
  };
}

async function handleOrchestratorSSE(
  stream: PassThrough,
  deps: {
    assetService: ReturnType<typeof createAssetService>;
    orchestrator: ReturnType<typeof createOrchestrator>;
    chatService: ReturnType<typeof createChatService>;
    publisher: RealtimePublisher;
    log: FastifyBaseLogger;
  },
  deviceId: string,
  message: string,
  image: { dataUri: string; path: string; mimeType: string; originalFilename?: string } | undefined,
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
  let streamDailySummary: unknown;
  let streamSummaryOutcome: SummaryOutcome | undefined;
  let streamDailyTargets: unknown;
  let streamAffectedDate: string | undefined;
  let streamLoggedMeal: ReturnType<typeof buildPartialSuccessLoggedReply> | undefined;
  let streamLoggedMealReceipt: ReturnType<typeof projectLoggedMealReceipt>;
  let streamReceiptIdentity: ReceiptIdentity | undefined;
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
      }
    );

    if ("streamGenerator" in result) {
      const { streamGenerator, didLogMeal, dailySummary, summaryOutcome, summaryHistoryFacts, affectedDate, loggedMeal } = result;
      streamDidLogMeal = didLogMeal;
      streamDidMutateMeal = result.didMutateMeal ?? didLogMeal;
      streamDailySummary = dailySummary;
      streamSummaryOutcome = summaryOutcome;
      streamDailyTargets = result.dailyTargets;
      streamAffectedDate = affectedDate;
      streamLoggedMeal = loggedMeal ? buildPartialSuccessLoggedReply(loggedMeal) : undefined;
      streamLoggedMealReceipt = projectLoggedMealReceipt(loggedMeal);
      streamReceiptIdentity = buildReceiptIdentity(loggedMeal, result.loggedMealToolMessageId);

      const streamResult = await handleStreamingReply(
        stream,
        streamGenerator,
        deps.chatService,
        deviceId,
        didLogMeal,
        streamDidMutateMeal,
        dailySummary,
        summaryHistoryFacts,
        streamReceiptIdentity,
        streamAffectedDate,
        streamLoggedMeal ?? (streamDidMutateMeal ? PARTIAL_MUTATION_FALLBACK : undefined),
        hooks,
        stopControl,
      );
      streamDidLogMeal = streamResult.didLogMeal;
      streamDailySummary = streamResult.dailySummary;
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
          ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
          ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
          ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
          ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
          ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
        };
        stream.write(`event: stopped\ndata: ${JSON.stringify(stoppedData)}\n\n`);
        recordSseCompletion({
          didLogMeal: streamDidLogMeal,
          didMutateMeal: streamDidMutateMeal,
          stopped: true,
          tokensStreamed: streamResult.tokensStreamed,
        });
        publishSummarySafe(deps.publisher, deviceId, streamDidMutateMeal, streamDailySummary, streamAffectedDate, deps.log);
        return;
      }

      const doneData = {
        turnId: stopControl.turnId,
        didLogMeal: streamDidLogMeal,
        didMutateMeal: streamDidMutateMeal,
        ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
        ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
        ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
        ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
        ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
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
      publishSummarySafe(deps.publisher, deviceId, streamDidMutateMeal, streamDailySummary, streamAffectedDate, deps.log);
    } else {
      const { reply: replyText, didLogMeal, dailySummary, summaryOutcome, summaryHistoryFacts, dailyTargets, affectedDate, loggedMeal } = result;
      recorder?.recordFinalReply({
        source: result.finalReplySource ?? "model",
        shape: result.finalReplyShape ?? "empty_or_missing",
      });
      streamDidLogMeal = didLogMeal;
      streamDidMutateMeal = result.didMutateMeal ?? didLogMeal;
      streamDailySummary = dailySummary;
      streamSummaryOutcome = summaryOutcome;
      streamDailyTargets = dailyTargets;
      streamAffectedDate = affectedDate;
      streamLoggedMeal = loggedMeal ? buildPartialSuccessLoggedReply(loggedMeal) : undefined;
      streamLoggedMealReceipt = projectLoggedMealReceipt(loggedMeal);
      streamReceiptIdentity = buildReceiptIdentity(loggedMeal, result.loggedMealToolMessageId);
      const shouldComposeSummaryHistory = result.finalReplySource !== "renderer"
        && !result.fallbackOutcomeContext;
      const normalizedReply = normalizeRouteFinalReply(
        appendHistoricalDateSuffixIfMissing(replyText, affectedDate),
        didLogMeal,
        streamDidMutateMeal,
        summaryHistoryFacts,
        {
          composeSummaryHistory: shouldComposeSummaryHistory,
          rendererOwnedSummaryHistory: result.finalReplySource === "renderer",
        },
      ).reply;
      const { sanitized: sanitizedFallback } = await finalizeAssistantReply(
        deps.chatService,
        deviceId,
        normalizedReply,
        streamReceiptIdentity,
      );
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedFallback })}\n\n`);
      const doneData = {
        turnId: stopControl.turnId,
        didLogMeal,
        didMutateMeal: streamDidMutateMeal,
        ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
        ...(dailySummary ? { dailySummary } : {}),
        ...(summaryOutcome ? { summaryOutcome } : {}),
        ...(dailyTargets ? { dailyTargets } : {}),
        ...(affectedDate ? { affectedDate } : {}),
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
      publishSummarySafe(deps.publisher, deviceId, streamDidMutateMeal, dailySummary, affectedDate, deps.log);
    }
  } catch (error) {
    const fallback = streamDidLogMeal
      ? (streamLoggedMeal ?? PARTIAL_SUCCESS_FALLBACK)
      : streamDidMutateMeal
        ? PARTIAL_MUTATION_FALLBACK
        : UNIFIED_FALLBACK;
    let catchSite: RouteCatchSite = "sse_outer";
    const providerFallback = providerStreamFallback(error);
    let sanitizedCatchError = providerFallback ? {} : sanitizeRouteCatchError(error);
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
      const { sanitized: sanitizedFallback } = await finalizeAssistantReply(
        deps.chatService,
        deviceId,
        fallback,
        streamReceiptIdentity,
      );
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedFallback })}\n\n`);
    } catch (persistError) {
      catchSite = "sse_persist";
      sanitizedCatchError = providerFallback ? {} : sanitizeRouteCatchError(persistError);
      // If history persistence also fails, still close the stream with done.
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: fallback })}\n\n`);
    }
    const doneData = {
      turnId: stopControl.turnId,
      didLogMeal: streamDidLogMeal,
      didMutateMeal: streamDidMutateMeal,
      ...(streamLoggedMealReceipt ? { loggedMeal: streamLoggedMealReceipt } : {}),
      ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
      ...(streamSummaryOutcome ? { summaryOutcome: streamSummaryOutcome } : {}),
      ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
      ...(streamAffectedDate ? { affectedDate: streamAffectedDate } : {}),
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
    publishSummarySafe(deps.publisher, deviceId, streamDidMutateMeal, streamDailySummary, streamAffectedDate, deps.log);
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
    deviceService,
    guestSessionService,
    publisher,
    uploadsDir: injectedUploadsDir,
    llmTraceRecorderFactory,
  } = deps;

  app.post("/api/chat/stop", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const body = request.body as { turnId?: unknown } | undefined;
    const turnId = body?.turnId;
    if (typeof turnId !== "string" || !turnId.trim()) {
      return reply.code(400).send({ error: "turnId is required" });
    }

    const activeTurn = activeChatTurns.get(activeChatTurnKey(session.deviceId, turnId));
    if (!activeTurn) {
      return reply.code(404).send({ error: "Active turn not found" });
    }

    activeTurn.stopRequested = true;
    if (!activeTurn.controller.signal.aborted) {
      activeTurn.controller.abort();
    }

    return { stopped: true, turnId };
  });

  app.post("/api/chat", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const resolvedUploadsDir = injectedUploadsDir ?? config.uploadsStagingDir;
    const parseResult = await parseMultipartRequest(request, resolvedUploadsDir);

    if ("error" in parseResult) {
      request.log.warn({ event: "chat_multipart_rejected", reason: parseResult.error }, "Chat multipart request rejected");
      return reply.code(parseResult.code).send({ error: parseResult.error });
    }

    const { message, image } = parseResult;
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
      let jsonDailySummary: unknown;
      let jsonSummaryOutcome: SummaryOutcome | undefined;
      let jsonDailyTargets: unknown;
      let jsonAffectedDate: string | undefined;
      let jsonLoggedMealFallback: string | undefined;
      let jsonLoggedMealReceipt: ReturnType<typeof projectLoggedMealReceipt>;
      let jsonReceiptIdentity: ReceiptIdentity | undefined;
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
          },
        );
        jsonDidLogMeal = result.didLogMeal;
        jsonDidMutateMeal = result.didMutateMeal ?? result.didLogMeal;
        jsonDailySummary = result.dailySummary;
        jsonSummaryOutcome = result.summaryOutcome;
        jsonDailyTargets = result.dailyTargets;
        jsonAffectedDate = result.affectedDate;
        jsonLoggedMealFallback = result.loggedMeal
          ? buildPartialSuccessLoggedReply(result.loggedMeal)
          : undefined;
        jsonLoggedMealReceipt = projectLoggedMealReceipt(result.loggedMeal);
        jsonReceiptIdentity = buildReceiptIdentity(result.loggedMeal, result.loggedMealToolMessageId);

        if ("streamGenerator" in result) {
          // Non-SSE caller received a stream result — drain and return as JSON
          const { streamGenerator, didLogMeal, dailySummary, summaryHistoryFacts, affectedDate } = result;
          const didMutateMeal = result.didMutateMeal ?? didLogMeal;
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
            didLogMeal,
            didMutateMeal,
            summaryHistoryFacts,
            { composeSummaryHistory: !hallucinationDetected },
          );
          const { sanitized } = await finalizeAssistantReply(
            chatService,
            deviceId,
            replyText,
            jsonReceiptIdentity,
          );
          traceRecorder?.recordFinalReply({
            source: hallucinationDetected ? "fallback" : composedSummaryHistory ? "renderer" : "model",
            shape: sanitized.trim() ? (hallucinationDetected ? "fallback_text" : "streamed_text") : "empty_or_missing",
          });
          // D-03/C6: JSON path publish boundary — immediately before reply.send().
          // C1: try/catch ensures publish failure never changes the HTTP response or status code.
          publishSummarySafe(
            publisher,
            deviceId,
            didMutateMeal,
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
            ...(jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
            ...(dailySummary ? { dailySummary } : {}),
            ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
            ...(result.dailyTargets ? { dailyTargets: result.dailyTargets } : {}),
            ...(affectedDate ? { affectedDate } : {}),
          };
        }

        const { reply: replyText, didLogMeal, dailySummary, summaryHistoryFacts, dailyTargets, affectedDate } = result;
        const shouldComposeSummaryHistory = result.finalReplySource !== "renderer"
          && !result.fallbackOutcomeContext;
        const normalizedReply = normalizeRouteFinalReply(
          appendHistoricalDateSuffixIfMissing(replyText, affectedDate),
          didLogMeal,
          jsonDidMutateMeal,
          summaryHistoryFacts,
          {
            composeSummaryHistory: shouldComposeSummaryHistory,
            rendererOwnedSummaryHistory: result.finalReplySource === "renderer",
          },
        ).reply;
        const { sanitized: sanitizedJson } = await finalizeAssistantReply(
          chatService,
          deviceId,
          normalizedReply,
          jsonReceiptIdentity,
        );
        traceRecorder?.recordFinalReply({
          source: result.finalReplySource ?? "model",
          shape: result.finalReplyShape ?? "empty_or_missing",
        });
        // D-03/C6: JSON path publish boundary — immediately before reply.send().
        // C1: try/catch ensures publish failure never changes the HTTP response or status code.
        publishSummarySafe(publisher, deviceId, jsonDidMutateMeal, dailySummary, affectedDate, turnLog);
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
          ...(jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
          ...(dailySummary ? { dailySummary } : {}),
          ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
          ...(dailyTargets ? { dailyTargets } : {}),
          ...(affectedDate ? { affectedDate } : {}),
        };
      } catch (error) {
        const fallback = jsonDidLogMeal
          ? (jsonLoggedMealFallback ?? PARTIAL_SUCCESS_FALLBACK)
          : jsonDidMutateMeal
            ? PARTIAL_MUTATION_FALLBACK
            : UNIFIED_FALLBACK;
        const providerFallback = providerStreamFallback(error);
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
        const { sanitized: sanitizedJson } = await finalizeAssistantReply(
          chatService,
          deviceId,
          fallback,
          jsonReceiptIdentity,
        );
        // D-03/C6: JSON catch path publish boundary — immediately before reply.send().
        // C1: try/catch ensures publish failure never changes the HTTP response or status code.
        publishSummarySafe(publisher, deviceId, jsonDidMutateMeal, jsonDailySummary, jsonAffectedDate, turnLog);
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
          ...(jsonLoggedMealReceipt ? { loggedMeal: jsonLoggedMealReceipt } : {}),
          ...(jsonDailySummary ? { dailySummary: jsonDailySummary } : {}),
          ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
          ...(jsonDailyTargets ? { dailyTargets: jsonDailyTargets } : {}),
          ...(jsonAffectedDate ? { affectedDate: jsonAffectedDate } : {}),
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
        { assetService, orchestrator, chatService, publisher, log: turnLog },
        deviceId,
        message,
        image,
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
  });

  app.get("/api/chat/history", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const { limit } = request.query as { limit?: string };
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      return reply.code(400).send({ error: "Invalid limit. Must be an integer between 1 and 200." });
    }
    const messages = await chatService.getHistory(deviceId, parsedLimit);
    return {
      messages: messages.map((message) => ({
        ...message,
        ...projectAssetFields(message.imagePath),
      })),
    };
  });
}
