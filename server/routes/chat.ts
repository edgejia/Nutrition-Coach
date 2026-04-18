import { PassThrough } from "node:stream";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest, FastifyBaseLogger } from "fastify";
import type { createOrchestrator } from "../orchestrator/index.js";
import type { createChatService } from "../services/chat.js";
import type { createDeviceService } from "../services/device.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { DailySummary } from "../services/summary.js";
import { CHOICE_PROMPT_PATTERN } from "../orchestrator/patterns.js";
import { createStructuredHooks } from "../orchestrator/hooks.js";
import type { OrchestratorHooks } from "../orchestrator/hooks.js";

interface Deps {
  orchestrator: ReturnType<typeof createOrchestrator>;
  chatService: ReturnType<typeof createChatService>;
  deviceService: ReturnType<typeof createDeviceService>;
  publisher: RealtimePublisher;
  /**
   * Override the upload storage directory. When undefined the route falls back
   * to the default `server/uploads/` path (production behaviour unchanged).
   * Pass a scenario-local temp directory in harness runs to prevent residue.
   */
  uploadsDir?: string;
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SENSITIVE_IDENTIFIERS = ["log_food", "get_daily_summary"];
const UNIFIED_FALLBACK = "抱歉，這次無法完成請求，請稍後再試或補充描述。";
const PARTIAL_SUCCESS_FALLBACK = "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。";

// Last-gate filter: strip internal tool identifiers even when the model ignores
// the system prompt rule. Applied to every reply before DB write and client emit.
function sanitizeReply(text: string): string {
  return text
    .replace(/log_food/g, "完成記錄")
    .replace(/get_daily_summary/g, "查詢今日攝取");
}

async function finalizeAssistantReply(
  chatService: ReturnType<typeof createChatService>,
  deviceId: string,
  rawReply: string,
): Promise<string> {
  const sanitized = sanitizeReply(rawReply);
  await chatService.saveMessage(deviceId, "assistant", sanitized);
  return sanitized;
}

function createStreamingSanitizer() {
  let tail = "";

  return {
    push(token: string): string {
      tail += token;
      const overlapLength = SENSITIVE_IDENTIFIERS.reduce((maxOverlap, identifier) => {
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

async function parseMultipartRequest(
  request: FastifyRequest,
  uploadsDir: string,
): Promise<{ message: string; image?: { dataUri: string; path: string } } | { error: string; code: number }> {
  let message = "";
  let image: { dataUri: string; path: string } | undefined;

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
        return { error: "Invalid image type. Allowed: jpeg, png, webp", code: 400 };
      }
      const buffer = await part.toBuffer();
      if (buffer.length > 5 * 1024 * 1024) {
        return { error: "Image too large. Max 5MB.", code: 400 };
      }
      const filename = `${crypto.randomUUID()}.${part.mimetype.split("/")[1]}`;
      await mkdir(uploadsDir, { recursive: true });
      const storedPath = join(uploadsDir, filename);
      await writeFile(storedPath, buffer);
      image = {
        dataUri: `data:${part.mimetype};base64,${buffer.toString("base64")}`,
        path: storedPath,
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
  didLogMeal: boolean,
  dailySummary: unknown,
  log: FastifyBaseLogger,
): void {
  if (!didLogMeal || !dailySummary) return;
  try {
    publisher.publishDailySummary(deviceId, dailySummary as DailySummary);
    log.info({ event: "summary_publish_success" }, "Summary publish success");
  } catch (publishErr) {
    log.warn(
      { event: "summary_publish_failed", err: publishErr instanceof Error ? publishErr.message : String(publishErr) },
      "Summary publish failed (non-fatal)",
    );
  }
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

async function handleStreamingReply(
  stream: PassThrough,
  streamGenerator: AsyncGenerator<string>,
  chatService: ReturnType<typeof createChatService>,
  deviceId: string,
  didLogMeal: boolean,
  dailySummary: unknown,
  hooks?: OrchestratorHooks,
): Promise<{ fullReply: string; didLogMeal: boolean; dailySummary?: unknown }> {
  const sanitizer = createStreamingSanitizer();
  let fullReply = "";
  let hallucAccum = "";
  const heldTokens: string[] = [];
  let holdingChoicePrompt = false;
  let hallucinationDetected = false;

  for await (const token of streamGenerator) {
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
    const sanitizedChunk = sanitizer.push(token);
    if (sanitizedChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedChunk })}\n\n`);
    }
  }

  if (hallucinationDetected) {
    hooks?.onFallback?.("hallucination_detected");
    const retryMsg = "抱歉，無法辨識這次的請求，可以再試一次或補充文字描述嗎？";
    await finalizeAssistantReply(chatService, deviceId, retryMsg);
    stream.write(`event: chunk\ndata: ${JSON.stringify({ token: retryMsg })}\n\n`);
    return { fullReply: retryMsg, didLogMeal, dailySummary };
  }

  for (const heldToken of heldTokens) {
    fullReply += heldToken;
    const sanitizedChunk = sanitizer.push(heldToken);
    if (sanitizedChunk) {
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedChunk })}\n\n`);
    }
  }
  const finalChunk = sanitizer.flush();
  if (finalChunk) {
    stream.write(`event: chunk\ndata: ${JSON.stringify({ token: finalChunk })}\n\n`);
  }
  await finalizeAssistantReply(chatService, deviceId, fullReply);
  return { fullReply, didLogMeal, dailySummary };
}

async function handleOrchestratorSSE(
  stream: PassThrough,
  deps: {
    orchestrator: ReturnType<typeof createOrchestrator>;
    chatService: ReturnType<typeof createChatService>;
    publisher: RealtimePublisher;
    log: FastifyBaseLogger;
  },
  deviceId: string,
  message: string,
  image: { dataUri: string; path: string } | undefined,
  hooks?: OrchestratorHooks,
): Promise<void> {
  let streamDidLogMeal = false;
  let streamDailySummary: unknown;
  let streamDailyTargets: unknown;

  try {
    if (image) {
      stream.write(`event: status\ndata: ${JSON.stringify({ label: "分析圖片中..." })}\n\n`);
    }

    const result = await deps.orchestrator.handleMessage(
      deviceId,
      message,
      image?.dataUri,
      image?.path,
      {
        onStatus: (label: string) => {
          stream.write(`event: status\ndata: ${JSON.stringify({ label })}\n\n`);
        },
        hooks,
      }
    );

    if ("streamGenerator" in result) {
      const { streamGenerator, didLogMeal, dailySummary } = result;
      streamDidLogMeal = didLogMeal;
      streamDailySummary = dailySummary;
      streamDailyTargets = result.dailyTargets;

      const streamResult = await handleStreamingReply(
        stream,
        streamGenerator,
        deps.chatService,
        deviceId,
        didLogMeal,
        dailySummary,
        hooks,
      );
      streamDidLogMeal = streamResult.didLogMeal;
      streamDailySummary = streamResult.dailySummary;

      const doneData = {
        didLogMeal: streamDidLogMeal,
        ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
        ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
      };
      stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
      publishSummarySafe(deps.publisher, deviceId, streamDidLogMeal, streamDailySummary, deps.log);
    } else {
      const { reply: replyText, didLogMeal, dailySummary, dailyTargets } = result;
      streamDidLogMeal = didLogMeal;
      streamDailySummary = dailySummary;
      streamDailyTargets = dailyTargets;
      const sanitizedFallback = await finalizeAssistantReply(deps.chatService, deviceId, replyText);
      stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedFallback })}\n\n`);
      const doneData = {
        didLogMeal,
        ...(dailySummary ? { dailySummary } : {}),
        ...(dailyTargets ? { dailyTargets } : {}),
      };
      stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
      publishSummarySafe(deps.publisher, deviceId, didLogMeal, dailySummary, deps.log);
    }
  } catch {
    const fallback = streamDidLogMeal ? PARTIAL_SUCCESS_FALLBACK : UNIFIED_FALLBACK;
    try {
      await finalizeAssistantReply(deps.chatService, deviceId, fallback);
    } catch {
      // If history persistence also fails, still close the stream with done.
    }
    const doneData = {
      didLogMeal: streamDidLogMeal,
      ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}),
      ...(streamDailyTargets ? { dailyTargets: streamDailyTargets } : {}),
    };
    stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
    publishSummarySafe(deps.publisher, deviceId, streamDidLogMeal, streamDailySummary, deps.log);
  } finally {
    await cleanupUploadSafe(image?.path, deps.log);
    stream.end();
  }
}

export function registerChatRoutes(app: FastifyInstance, deps: Deps) {
  const { orchestrator, chatService, deviceService, publisher, uploadsDir: injectedUploadsDir } = deps;

  app.post("/api/chat", async (request, reply) => {
    const deviceId = request.headers["x-device-id"] as string;
    if (!deviceId) return reply.code(401).send({ error: "Missing X-Device-Id" });
    const device = await deviceService.getDevice(deviceId);
    if (!device) return reply.code(401).send({ error: "Invalid device ID" });

    const resolvedUploadsDir = injectedUploadsDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "uploads");
    const parseResult = await parseMultipartRequest(request, resolvedUploadsDir);

    if ("error" in parseResult) {
      return reply.code(parseResult.code).send({ error: parseResult.error });
    }

    const { message, image } = parseResult;

    // Branch on SSE opt-in (T-03c-01: keep explicit JSON fallback for non-SSE callers)
    const acceptHeader = request.headers["accept"] ?? "";
    const wantsSSE = acceptHeader.includes("text/event-stream");

    if (!wantsSSE) {
      let jsonDidLogMeal = false;
      let jsonDailySummary: unknown;
      let jsonDailyTargets: unknown;

      try {
        // JSON path: existing non-SSE callers remain intact
        const result = await orchestrator.handleMessage(deviceId, message, image?.dataUri, image?.path);
        jsonDidLogMeal = result.didLogMeal;
        jsonDailySummary = result.dailySummary;
        jsonDailyTargets = result.dailyTargets;

        if (result.didLogMeal && !result.dailySummary) {
          throw new Error("Invariant violated: didLogMeal response is missing dailySummary");
        }

        if ("streamGenerator" in result) {
          // Non-SSE caller received a stream result — drain and return as JSON
          const { streamGenerator, didLogMeal, dailySummary } = result;
          let fullReply = "";
          for await (const token of streamGenerator) {
            fullReply += token;
          }
          const sanitized = await finalizeAssistantReply(chatService, deviceId, fullReply);
          // D-03/C6: JSON path publish boundary — immediately before reply.send().
          // C1: try/catch ensures publish failure never changes the HTTP response or status code.
          publishSummarySafe(publisher, deviceId, didLogMeal, dailySummary, request.log);
          return {
            reply: sanitized,
            didLogMeal,
            ...(dailySummary ? { dailySummary } : {}),
            ...(result.dailyTargets ? { dailyTargets: result.dailyTargets } : {}),
          };
        }

        const { reply: replyText, didLogMeal, dailySummary, dailyTargets } = result;
        const sanitizedJson = await finalizeAssistantReply(chatService, deviceId, replyText);
        // D-03/C6: JSON path publish boundary — immediately before reply.send().
        // C1: try/catch ensures publish failure never changes the HTTP response or status code.
        publishSummarySafe(publisher, deviceId, didLogMeal, dailySummary, request.log);
        return {
          reply: sanitizedJson,
          didLogMeal,
          ...(dailySummary ? { dailySummary } : {}),
          ...(dailyTargets ? { dailyTargets } : {}),
        };
      } catch {
        const fallback = jsonDidLogMeal ? PARTIAL_SUCCESS_FALLBACK : UNIFIED_FALLBACK;
        const sanitizedJson = await finalizeAssistantReply(chatService, deviceId, fallback);
        // D-03/C6: JSON catch path publish boundary — immediately before reply.send().
        // C1: try/catch ensures publish failure never changes the HTTP response or status code.
        publishSummarySafe(publisher, deviceId, jsonDidLogMeal, jsonDailySummary, request.log);
        return {
          reply: sanitizedJson,
          didLogMeal: jsonDidLogMeal,
          ...(jsonDailySummary ? { dailySummary: jsonDailySummary } : {}),
          ...(jsonDailyTargets ? { dailyTargets: jsonDailyTargets } : {}),
        };
      } finally {
        // D-08: Delete upload file after processing completes (success or failure).
        await cleanupUploadSafe(image?.path, request.log);
      }
    }

    // SSE path: open stream BEFORE awaiting orchestrator so status labels are
    // visible during the real waiting period (D-03, D-04, D-05).
    const stream = new PassThrough();

    reply
      .code(200)
      .type("text/event-stream")
      .header("cache-control", "no-cache")
      .send(stream);

    const orchLog = request.log.child({ component: "orchestrator" });
    const hooks = createStructuredHooks(orchLog);

    setImmediate(() => {
      void handleOrchestratorSSE(
        stream,
        { orchestrator, chatService, publisher, log: request.log },
        deviceId,
        message,
        image,
        hooks,
      );
    });

    return reply;
  });

  app.get("/api/chat/history", async (request, reply) => {
    const deviceId = request.headers["x-device-id"] as string;
    if (!deviceId) return reply.code(401).send({ error: "Missing X-Device-Id" });
    const device = await deviceService.getDevice(deviceId);
    if (!device) return reply.code(401).send({ error: "Invalid device ID" });

    const { limit } = request.query as { limit?: string };
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      return reply.code(400).send({ error: "Invalid limit. Must be an integer between 1 and 200." });
    }
    const messages = await chatService.getHistory(deviceId, parsedLimit);
    return { messages };
  });
}
