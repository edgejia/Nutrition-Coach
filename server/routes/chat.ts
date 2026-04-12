import { PassThrough } from "node:stream";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { createOrchestrator } from "../orchestrator/index.js";
import type { createChatService } from "../services/chat.js";
import type { createDeviceService } from "../services/device.js";
import { CHOICE_PROMPT_PATTERN } from "../orchestrator/patterns.js";

interface Deps {
  orchestrator: ReturnType<typeof createOrchestrator>;
  chatService: ReturnType<typeof createChatService>;
  deviceService: ReturnType<typeof createDeviceService>;
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

export function registerChatRoutes(app: FastifyInstance, deps: Deps) {
  const { orchestrator, chatService, deviceService, uploadsDir: injectedUploadsDir } = deps;

  app.post("/api/chat", async (request, reply) => {
    const deviceId = request.headers["x-device-id"] as string;
    if (!deviceId) return reply.code(401).send({ error: "Missing X-Device-Id" });
    const device = await deviceService.getDevice(deviceId);
    if (!device) return reply.code(401).send({ error: "Invalid device ID" });

    let message = "";
    let image:
      | { dataUri: string; path: string }
      | undefined;

    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return reply.code(400).send({ error: "Content-Type must be multipart/form-data" });
    }
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "message") {
        message = part.value as string;
      } else if (part.type === "file" && part.fieldname === "image") {
        if (!ALLOWED_TYPES.includes(part.mimetype)) {
          return reply.code(400).send({ error: "Invalid image type. Allowed: jpeg, png, webp" });
        }
        const buffer = await part.toBuffer();
        if (buffer.length > 5 * 1024 * 1024) {
          return reply.code(400).send({ error: "Image too large. Max 5MB." });
        }
        const filename = `${crypto.randomUUID()}.${part.mimetype.split("/")[1]}`;
        const resolvedUploadsDir = injectedUploadsDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "uploads");
        await mkdir(resolvedUploadsDir, { recursive: true });
        const storedPath = join(resolvedUploadsDir, filename);
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
      return reply.code(400).send({ error: "Message or image required" });
    }

    // Branch on SSE opt-in (T-03c-01: keep explicit JSON fallback for non-SSE callers)
    const acceptHeader = request.headers["accept"] ?? "";
    const wantsSSE = acceptHeader.includes("text/event-stream");

    if (!wantsSSE) {
      let jsonDidLogMeal = false;
      let jsonDailySummary: unknown;

      try {
        // JSON path: existing non-SSE callers remain intact
        const result = await orchestrator.handleMessage(deviceId, message, image?.dataUri, image?.path);
        jsonDidLogMeal = result.didLogMeal;
        jsonDailySummary = result.dailySummary;

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
          return didLogMeal
            ? { reply: sanitized, didLogMeal, dailySummary }
            : { reply: sanitized, didLogMeal };
        }

        const { reply: replyText, didLogMeal, dailySummary } = result;
        const sanitizedJson = await finalizeAssistantReply(chatService, deviceId, replyText);
        return didLogMeal
          ? { reply: sanitizedJson, didLogMeal, dailySummary }
          : { reply: sanitizedJson, didLogMeal };
      } catch {
        const fallback = jsonDidLogMeal ? PARTIAL_SUCCESS_FALLBACK : UNIFIED_FALLBACK;
        const sanitizedJson = await finalizeAssistantReply(chatService, deviceId, fallback);
        return jsonDidLogMeal
          ? { reply: sanitizedJson, didLogMeal: true, ...(jsonDailySummary ? { dailySummary: jsonDailySummary } : {}) }
          : { reply: sanitizedJson, didLogMeal: false };
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

    setImmediate(() => {
      void (async () => {
        let streamDidLogMeal = false;
        let streamDailySummary: unknown;

        try {
          // D-03: emit 分析圖片中 immediately if an image is present — this fires
          // before orchestrator.handleMessage is awaited, covering the real wait.
          if (image) {
            stream.write(`event: status\ndata: ${JSON.stringify({ label: "分析圖片中..." })}\n\n`);
          }

          // Pass onStatus so the orchestrator can surface 記錄餐點中 from inside
          // the tool-call loop, before executeTool(log_food) completes (D-03).
          const result = await orchestrator.handleMessage(
            deviceId,
            message,
            image?.dataUri,
            image?.path,
            {
              onStatus: (label: string) => {
                stream.write(`event: status\ndata: ${JSON.stringify({ label })}\n\n`);
              },
            }
          );

          if ("streamGenerator" in result) {
            const { streamGenerator, didLogMeal, dailySummary } = result;
            streamDidLogMeal = didLogMeal;
            streamDailySummary = dailySummary;
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
              const retryMsg = "抱歉，無法辨識這次的請求，可以再試一次或補充文字描述嗎？";
              await finalizeAssistantReply(chatService, deviceId, retryMsg);
              stream.write(`event: chunk\ndata: ${JSON.stringify({ token: retryMsg })}\n\n`);
              const doneData = { didLogMeal, ...(dailySummary ? { dailySummary } : {}) };
              stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
            } else {
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
              const doneData = { didLogMeal, ...(dailySummary ? { dailySummary } : {}) };
              stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
            }
          } else {
            // Non-stream fallback: bridge plain reply into SSE so sendMessageStream()
            // always receives event: chunk + event: done regardless of provider capability.
            const { reply: replyText, didLogMeal, dailySummary } = result;
            const sanitizedFallback = await finalizeAssistantReply(chatService, deviceId, replyText);
            stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedFallback })}\n\n`);
            const doneData = { didLogMeal, ...(dailySummary ? { dailySummary } : {}) };
            stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
          }
        } catch {
          const fallback = streamDidLogMeal ? PARTIAL_SUCCESS_FALLBACK : UNIFIED_FALLBACK;
          try {
            await finalizeAssistantReply(chatService, deviceId, fallback);
          } catch {
            // If history persistence also fails, still close the stream with done.
          }
          const doneData = streamDidLogMeal
            ? { didLogMeal: true, ...(streamDailySummary ? { dailySummary: streamDailySummary } : {}) }
            : { didLogMeal: false };
          stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
        } finally {
          stream.end();
        }
      })();
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
