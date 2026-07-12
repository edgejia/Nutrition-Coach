import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createDb, type AppDatabase } from "./db/client.js";
import { createDeviceService } from "./services/device.js";
import { createFoodLoggingService } from "./services/food-logging.js";
import { createSummaryService } from "./services/summary.js";
import { createDaySnapshotService } from "./services/day-snapshot.js";
import { createHistoryQueryService } from "./services/history-query.js";
import { createChatService } from "./services/chat.js";
import { createAssetService } from "./services/assets.js";
import { createMealCorrectionService } from "./services/meal-correction.js";
import { createMealDeleteProposalService } from "./services/meal-delete-proposals.js";
import { createMealNumericProposalService } from "./services/meal-numeric-proposals.js";
import { createGoalProposalService } from "./services/goal-proposals.js";
import {
  createProposalActionService,
  type ProposalActionTestHooks,
} from "./services/proposal-actions.js";
import { createProposalCardService } from "./services/proposal-cards.js";
import { createGuestSessionService } from "./services/guest-session.js";
import { createRecentMealLogStateService } from "./services/turn-state.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { renderProposalInactiveCopy } from "./orchestrator/mutation-receipts.js";
import { createTargetGenerationService } from "./services/target-generation.js";
import { RealtimePublisher } from "./realtime/publisher.js";
import { registerDeviceRoutes } from "./routes/device.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerMealRoutes } from "./routes/meals.js";
import { registerDaySnapshotRoutes } from "./routes/day-snapshot.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerSSERoutes } from "./routes/sse.js";
import { registerObservabilityRoutes } from "./routes/observability.js";
import { registerProposalActionRoutes } from "./routes/proposal-actions.js";
import { registerProtectedRouteSupport } from "./routes/protected-route.js";
import type { LLMProvider } from "./llm/types.js";
import type { LlmTraceRecorder } from "./orchestrator/llm-trace.js";
import { parseSourceRevision } from "./lib/source-revision.js";
import {
  config,
  isDeployedLikeRuntime,
  readRuntimeConfigFromEnv,
  type RuntimeConfig,
  validateGuestSessionSecretForRuntime,
} from "./config.js";

const LOCAL_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const CLIENT_BUILD_PROVENANCE_ERROR = "Client build provenance is unavailable or invalid.";
const RUNTIME_PROVENANCE_REQUIRED_ERROR = "Runtime source provenance is required in deployed-like runtime.";

declare module "fastify" {
  interface FastifyInstance {
    runtimeConfig: RuntimeConfig;
  }
}

export function getCorsRegistrationPolicy(input: {
  guestSessionCookieSecure: boolean;
  nodeEnv: string | undefined;
}) {
  if (isDeployedLikeRuntime(input)) {
    return { register: false as const };
  }

  return {
    register: true as const,
    options: {
      origin: LOCAL_CORS_ORIGINS,
      credentials: true,
    },
  };
}

export interface AppServices {
  assetService: ReturnType<typeof createAssetService>;
  chatService: ReturnType<typeof createChatService>;
  db: AppDatabase;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  goalProposalService: ReturnType<typeof createGoalProposalService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  historyQueryService: ReturnType<typeof createHistoryQueryService>;
  mealCorrectionService: ReturnType<typeof createMealCorrectionService>;
  mealDeleteProposalService: ReturnType<typeof createMealDeleteProposalService>;
  mealNumericProposalService: ReturnType<typeof createMealNumericProposalService>;
  orchestrator: ReturnType<typeof createOrchestrator>;
  proposalActionService: ReturnType<typeof createProposalActionService>;
  proposalCardService: ReturnType<typeof createProposalCardService>;
  publisher: RealtimePublisher;
  recentMealLogStateService: ReturnType<typeof createRecentMealLogStateService>;
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
  /** Override process source provenance in tests; runtime composition reads SOURCE_SHA. */
  sourceRevision?: string;
  /**
   * Optional Fastify logger configuration.
   * When omitted: Fastify initializes with `logger: false` (silent — backward compatible with all existing tests).
   * In production (server/index.ts): pass `{ level: 'info', redact: { paths: ['req.headers.authorization'], remove: true } }`.
   * In OBS-04 tests: pass `{ level: 'info', stream: captureStream }` to capture log lines.
   */
  logger?: import("fastify").FastifyServerOptions["logger"];
  /** Optional test/harness trace recorder factory. SSE chat routes create at most one recorder per turn. */
  llmTraceRecorderFactory?: () => LlmTraceRecorder | undefined;
  /** Test harness observer for in-process service access. Does not expose an HTTP surface. */
  onServicesReady?: (services: AppServices) => void;
  /** Test-only proposal action failure hooks. Not exposed through HTTP. */
  proposalActionTestHooks?: ProposalActionTestHooks;
}

export async function buildApp(opts: AppOptions) {
  const llmProvider = opts.llmProvider;
  const clientDistDir = path.resolve(opts.clientDistDir ?? config.clientDistDir);
  const deployedLikeRuntime = isDeployedLikeRuntime({
    guestSessionCookieSecure: config.guestSessionCookieSecure,
    nodeEnv: config.nodeEnv,
  });
  const rawSourceRevision = opts.sourceRevision ?? process.env.SOURCE_SHA;
  let sourceRevision: string | undefined;

  if (rawSourceRevision !== undefined) {
    sourceRevision = parseSourceRevision(rawSourceRevision);
  } else if (deployedLikeRuntime) {
    throw new Error(RUNTIME_PROVENANCE_REQUIRED_ERROR);
  }

  let hasClientDist = false;
  try {
    await access(path.join(clientDistDir, "index.html"));
    hasClientDist = true;
  } catch {
    hasClientDist = false;
  }

  if (hasClientDist && sourceRevision) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(clientDistDir, "source-revision.json"), "utf8"),
      ) as unknown;
      if (
        typeof manifest !== "object"
        || manifest === null
        || Array.isArray(manifest)
        || Object.keys(manifest).length !== 1
        || !("sourceSha" in manifest)
      ) {
        throw new Error(CLIENT_BUILD_PROVENANCE_ERROR);
      }
      const clientSourceRevision = parseSourceRevision(manifest.sourceSha);
      if (clientSourceRevision !== sourceRevision) {
        throw new Error(CLIENT_BUILD_PROVENANCE_ERROR);
      }
    } catch {
      throw new Error(CLIENT_BUILD_PROVENANCE_ERROR);
    }
  }

  const app = Fastify({ logger: opts.logger ?? false });

  // Fail fast if the runtime timezone contract is misconfigured.
  const { validateTimezone } = await import("./lib/time.js");
  validateTimezone(app.log);
  validateGuestSessionSecretForRuntime({
    guestSessionSecret: config.guestSessionSecret,
    guestSessionCookieSecure: config.guestSessionCookieSecure,
    nodeEnv: config.nodeEnv,
  });
  const runtimeConfig = readRuntimeConfigFromEnv();
  app.decorate("runtimeConfig", runtimeConfig);

  const db = createDb(opts.dbPath ?? config.dbPath);
  const deviceService = createDeviceService(db);
  const targetGenerationService = createTargetGenerationService(llmProvider, app.log);
  const foodLoggingService = createFoodLoggingService(db);
  const guestSessionService = createGuestSessionService({
    secret: config.guestSessionSecret,
    activeCookieName: config.guestSessionCookieName,
    resumeCookieName: config.guestSessionResumeCookieName,
    activeTtlSeconds: runtimeConfig.guestSessionTtlSeconds,
    resumeTtlSeconds: runtimeConfig.guestSessionResumeTtlSeconds,
    secure: config.guestSessionCookieSecure,
  });
  const summaryService = createSummaryService(db);
  const historyQueryService = createHistoryQueryService(db, { summaryService });
  const daySnapshotService = createDaySnapshotService({ summaryService, foodLoggingService });
  const chatService = createChatService(db);
  const assetService = createAssetService(db, { assetsDir: opts.assetsDir ?? config.assetsDir });
  const proposalCardService = createProposalCardService(db);
  const mealCorrectionService = createMealCorrectionService(db, {
    summaryService,
    foodLoggingService,
    async markActiveMealProposalCardsStale({ deviceId }) {
      await proposalCardService.markActiveLaneStale({
        deviceId,
        proposalLane: "meal_mutation",
        lapseCopy: renderProposalInactiveCopy({
          proposalKind: "meal_numeric",
          status: "stale",
        }),
      });
    },
  });
  const goalProposalService = createGoalProposalService(db);
  const mealDeleteProposalService = createMealDeleteProposalService(db);
  const mealNumericProposalService = createMealNumericProposalService(db);
  const recentMealLogStateService = createRecentMealLogStateService(db);
  const publisher = new RealtimePublisher();

  const proposalActionService = createProposalActionService({
    db,
    chatService,
    proposalCardService,
    goalProposalService,
    mealNumericProposalService,
    mealDeleteProposalService,
    mealCorrectionService,
    deviceService,
    publisher,
    log: app.log,
    testHooks: opts.proposalActionTestHooks,
  });
  const orchestrator = createOrchestrator({
    llmProvider,
    chatService,
    summaryService,
    foodLoggingService,
    mealCorrectionService,
    mealDeleteProposalService,
    mealNumericProposalService,
    deviceService,
    goalProposalService,
    proposalActionService,
    recentMealLogStateService,
    publisher,
  });

  opts.onServicesReady?.({
    assetService,
    chatService,
    db,
    foodLoggingService,
    goalProposalService,
    guestSessionService,
    historyQueryService,
    mealCorrectionService,
    mealDeleteProposalService,
    mealNumericProposalService,
    orchestrator,
    proposalActionService,
    proposalCardService,
    publisher,
    recentMealLogStateService,
    summaryService,
  });
  const corsPolicy = getCorsRegistrationPolicy({
    guestSessionCookieSecure: config.guestSessionCookieSecure,
    nodeEnv: config.nodeEnv,
  });
  if (corsPolicy.register) {
    await app.register(cors, corsPolicy.options);
  }
  // Keep the parser limit above the product limit so the chat route can return a controlled 400 at 5MB.
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  registerProtectedRouteSupport(app);
  registerDeviceRoutes(app, { deviceService, guestSessionService, targetGenerationService });
  registerChatRoutes(app, {
    orchestrator,
    chatService,
    proposalCardService,
    deviceService,
    guestSessionService,
    goalProposalService,
    mealNumericProposalService,
    mealDeleteProposalService,
    assetService,
    publisher,
    uploadsDir: opts.uploadsDir,
    llmTraceRecorderFactory: opts.llmTraceRecorderFactory,
  });
  registerMealRoutes(app, { foodLoggingService, summaryService, deviceService, guestSessionService, assetService, publisher });
  registerProposalActionRoutes(app, { proposalActionService, deviceService, guestSessionService });
  registerDaySnapshotRoutes(app, { daySnapshotService, deviceService, guestSessionService });
  registerHistoryRoutes(app, { historyQueryService, deviceService, guestSessionService });
  registerAssetRoutes(app, { assetService, deviceService, guestSessionService });
  registerObservabilityRoutes(app, { deviceService, guestSessionService });
  registerSSERoutes(app, { publisher, summaryService, deviceService, guestSessionService });

  app.get("/api/runtime-provenance", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!sourceRevision) {
      return reply.code(503).send({ error: "Runtime provenance unavailable" });
    }

    return reply.send({ sourceSha: sourceRevision });
  });

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
