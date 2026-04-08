import { PassThrough } from "node:stream";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { createOrchestrator, OrchestratorResult } from "../orchestrator/index.js";
import type { createChatService } from "../services/chat.js";
import type { createDeviceService } from "../services/device.js";
interface Deps {
  orchestrator: ReturnType<typeof createOrchestrator>;
  chatService: ReturnType<typeof createChatService>;
  deviceService: ReturnType<typeof createDeviceService>;
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function registerChatRoutes(app: FastifyInstance, deps: Deps) {
  const { orchestrator, chatService, deviceService } = deps;

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
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const uploadsDir = join(__dirname, "..", "uploads");
        await mkdir(uploadsDir, { recursive: true });
        const storedPath = join(uploadsDir, filename);
        await writeFile(storedPath, buffer);
        image = {
          dataUri: `data:${part.mimetype};base64,${buffer.toString("base64")}`,
          path: `server/uploads/${filename}`,
        };
      }
    }

    if (!message && image) {
      message = "(圖片)";
    }

    if (!message && !image) {
      return reply.code(400).send({ error: "Message or image required" });
    }

    const result: OrchestratorResult = await orchestrator.handleMessage(deviceId, message, image?.dataUri, image?.path);

    if (result.didLogMeal && !result.dailySummary) {
      throw new Error("Invariant violated: didLogMeal response is missing dailySummary");
    }

    if ("streamGenerator" in result) {
      const { streamGenerator, didLogMeal, dailySummary } = result;
      const stream = new PassThrough();

      reply
        .code(200)
        .type("text/event-stream")
        .header("cache-control", "no-cache")
        .send(stream);

      setImmediate(() => {
        void (async () => {
          let fullReply = "";

          try {
            for await (const token of streamGenerator) {
              fullReply += token;
              stream.write(`event: chunk\ndata: ${JSON.stringify({ token })}\n\n`);
            }

            await chatService.saveMessage(deviceId, "assistant", fullReply);
            const doneData = { didLogMeal, ...(dailySummary ? { dailySummary } : {}) };
            stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
          } catch {
            stream.write(`event: error\ndata: ${JSON.stringify({ message: "Stream interrupted" })}\n\n`);
          } finally {
            stream.end();
          }
        })();
      });

      return reply;
    }

    const { reply: replyText, didLogMeal, dailySummary } = result;

    return didLogMeal
      ? { reply: replyText, didLogMeal, dailySummary }
      : { reply: replyText, didLogMeal };
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
