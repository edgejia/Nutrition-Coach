import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createDb } from "./db/client.js";
import { createDeviceService } from "./services/device.js";
import { createFoodLoggingService } from "./services/food-logging.js";
import { createSummaryService } from "./services/summary.js";
import { createChatService } from "./services/chat.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { RealtimePublisher } from "./realtime/publisher.js";
import { registerDeviceRoutes } from "./routes/device.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerMealRoutes } from "./routes/meals.js";
import { registerSSERoutes } from "./routes/sse.js";
import type { LLMProvider } from "./llm/types.js";

export interface AppOptions {
  dbPath?: string;
  llmProvider: LLMProvider;
}

export async function buildApp(opts: AppOptions) {
  // Warn early if TZ is misconfigured (day-boundary logic depends on it).
  const { validateTimezone } = await import("./lib/time.js");
  validateTimezone();

  const db = createDb(opts.dbPath ?? process.env.DB_PATH ?? "./data/nutrition.db");
  const llmProvider = opts.llmProvider;

  const deviceService = createDeviceService(db);
  const foodLoggingService = createFoodLoggingService(db);
  const summaryService = createSummaryService(db);
  const chatService = createChatService(db);
  const publisher = new RealtimePublisher();

  const orchestrator = createOrchestrator({
    llmProvider,
    chatService,
    summaryService,
    foodLoggingService,
    deviceService,
    publisher,
    logger: console,
  });

  const app = Fastify({ logger: false });
  await app.register(cors);
  // Keep the parser limit above the product limit so the chat route can return a controlled 400 at 5MB.
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  registerDeviceRoutes(app, { deviceService });
  registerChatRoutes(app, { orchestrator, chatService, deviceService, summaryService });
  registerMealRoutes(app, { foodLoggingService, summaryService, deviceService, publisher });
  registerSSERoutes(app, { publisher, summaryService, deviceService });

  return app;
}
