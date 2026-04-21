import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { access } from "node:fs/promises";
import path from "node:path";
import { createDb } from "./db/client.js";
import { createDeviceService } from "./services/device.js";
import { createFoodLoggingService } from "./services/food-logging.js";
import { createSummaryService } from "./services/summary.js";
import { createDaySnapshotService } from "./services/day-snapshot.js";
import { createChatService } from "./services/chat.js";
import { createAssetService } from "./services/assets.js";
import { createMealCorrectionService } from "./services/meal-correction.js";
import { createGuestSessionService } from "./services/guest-session.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { createTargetGenerationService } from "./services/target-generation.js";
import { RealtimePublisher } from "./realtime/publisher.js";
import { registerDeviceRoutes } from "./routes/device.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerMealRoutes } from "./routes/meals.js";
import { registerDaySnapshotRoutes } from "./routes/day-snapshot.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerSSERoutes } from "./routes/sse.js";
import type { LLMProvider } from "./llm/types.js";
import { config } from "./config.js";

export interface AppServices {
  assetService: ReturnType<typeof createAssetService>;
  chatService: ReturnType<typeof createChatService>;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  mealCorrectionService: ReturnType<typeof createMealCorrectionService>;
  summaryService: ReturnType<typeof createSummaryService>;
}

export interface AppOptions {
  dbPath?: string;
  llmProvider: LLMProvider;
  /**
   * Override the directory where uploaded files are stored.
   * When omitted the route uses `config.uploadsStagingDir`. Pass a temp
   * directory in test scenarios to prevent staged-upload residue from
   * accumulating inside the repo.
   */
  uploadsDir?: string;
  /** Override the durable assets directory used by the asset service. */
  assetsDir?: string;
  /** Override the built client directory used for same-origin beta serving. */
  clientDistDir?: string;
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
  const clientDistDir = path.resolve(opts.clientDistDir ?? config.clientDistDir);

  const app = Fastify({ logger: opts.logger ?? false });

  // Warn early if TZ is misconfigured (day-boundary logic depends on it).
  const { validateTimezone } = await import("./lib/time.js");
  validateTimezone(app.log);

  const deviceService = createDeviceService(db);
  const targetGenerationService = createTargetGenerationService(llmProvider, app.log);
  const foodLoggingService = createFoodLoggingService(db);
  const guestSessionService = createGuestSessionService({
    secret: config.guestSessionSecret,
    activeCookieName: config.guestSessionCookieName,
    resumeCookieName: config.guestSessionResumeCookieName,
    activeTtlSeconds: config.guestSessionTtlSeconds,
    resumeTtlSeconds: config.guestSessionResumeTtlSeconds,
    secure: config.guestSessionCookieSecure,
  });
  const summaryService = createSummaryService(db);
  const daySnapshotService = createDaySnapshotService({ summaryService, foodLoggingService });
  const chatService = createChatService(db);
  const assetService = createAssetService(db, { assetsDir: opts.assetsDir ?? config.assetsDir });
  const mealCorrectionService = createMealCorrectionService(db);
  const publisher = new RealtimePublisher();

  opts.onServicesReady?.({
    assetService,
    chatService,
    foodLoggingService,
    guestSessionService,
    mealCorrectionService,
    summaryService,
  });

  const orchestrator = createOrchestrator({
    llmProvider,
    chatService,
    summaryService,
    foodLoggingService,
    mealCorrectionService,
    deviceService,
    publisher,
  });
  await app.register(cors);
  // Keep the parser limit above the product limit so the chat route can return a controlled 400 at 5MB.
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  registerDeviceRoutes(app, { deviceService, guestSessionService, targetGenerationService });
  registerChatRoutes(app, {
    orchestrator,
    chatService,
    deviceService,
    assetService,
    publisher,
    uploadsDir: opts.uploadsDir,
  });
  registerMealRoutes(app, { foodLoggingService, summaryService, deviceService, publisher });
  registerDaySnapshotRoutes(app, { daySnapshotService, deviceService });
  registerAssetRoutes(app, { assetService, deviceService });
  registerSSERoutes(app, { publisher, summaryService, deviceService });

  let hasClientDist = false;
  try {
    await access(path.join(clientDistDir, "index.html"));
    hasClientDist = true;
  } catch {
    hasClientDist = false;
  }

  if (hasClientDist) {
    await app.register(fastifyStatic, {
      root: clientDistDir,
      prefix: "/",
      index: ["index.html"],
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        reply.type("text/html");
        return reply.sendFile("index.html");
      }

      return reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}
