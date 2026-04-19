import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createDb } from "./db/client.js";
import { createDeviceService } from "./services/device.js";
import { createFoodLoggingService } from "./services/food-logging.js";
import { createSummaryService } from "./services/summary.js";
import { createChatService } from "./services/chat.js";
import { createAssetService } from "./services/assets.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { createTargetGenerationService } from "./services/target-generation.js";
import { RealtimePublisher } from "./realtime/publisher.js";
import { registerDeviceRoutes } from "./routes/device.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerMealRoutes } from "./routes/meals.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerSSERoutes } from "./routes/sse.js";
import type { LLMProvider } from "./llm/types.js";
import { config } from "./config.js";

export interface AppServices {
  assetService: ReturnType<typeof createAssetService>;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
}

export interface AppOptions {
  dbPath?: string;
  llmProvider: LLMProvider;
  /**
   * Override the directory where uploaded files are stored.
   * When omitted the route uses its default (`server/uploads/` relative to the
   * compiled route file). Pass a temp directory in test scenarios to prevent
   * upload residue from accumulating inside the repo.
   */
  uploadsDir?: string;
  /** Override the durable assets directory used by the asset service. */
  assetsDir?: string;
  /**
   * Optional Fastify logger configuration.
   * When omitted: Fastify initializes with `logger: false` (silent — backward compatible with all existing tests).
   * In production (server/index.ts): pass `{ level: 'info', redact: { paths: ['req.headers.authorization'], remove: true } }`.
   * In OBS-04 tests: pass `{ level: 'info', stream: captureStream }` to capture log lines.
   */
  logger?: import("fastify").FastifyServerOptions["logger"];
  /** Test harness observer for in-process service access. Does not expose an HTTP surface. */
  onServicesReady?: (services: AppServices) => void;
}

export async function buildApp(opts: AppOptions) {
  const db = createDb(opts.dbPath ?? config.dbPath);
  const llmProvider = opts.llmProvider;

  const app = Fastify({ logger: opts.logger ?? false });

  // Warn early if TZ is misconfigured (day-boundary logic depends on it).
  const { validateTimezone } = await import("./lib/time.js");
  validateTimezone(app.log);

  const deviceService = createDeviceService(db);
  const targetGenerationService = createTargetGenerationService(llmProvider, app.log);
  const foodLoggingService = createFoodLoggingService(db);
  const summaryService = createSummaryService(db);
  const chatService = createChatService(db);
  const assetService = createAssetService(db, { assetsDir: opts.assetsDir ?? config.assetsDir });
  const publisher = new RealtimePublisher();

  opts.onServicesReady?.({ assetService, foodLoggingService, summaryService });

  const orchestrator = createOrchestrator({
    llmProvider,
    chatService,
    summaryService,
    foodLoggingService,
    deviceService,
    publisher,
  });
  await app.register(cors);
  // Keep the parser limit above the product limit so the chat route can return a controlled 400 at 5MB.
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  registerDeviceRoutes(app, { deviceService, targetGenerationService });
  registerChatRoutes(app, { orchestrator, chatService, deviceService, publisher, uploadsDir: opts.uploadsDir });
  registerMealRoutes(app, { foodLoggingService, summaryService, deviceService, publisher });
  registerAssetRoutes(app, { assetService, deviceService });
  registerSSERoutes(app, { publisher, summaryService, deviceService });

  return app;
}
