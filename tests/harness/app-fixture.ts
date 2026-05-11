/**
 * Reusable app fixture for the deterministic verification harness.
 *
 * Provides `createScenarioApp()` which boots the real Fastify application
 * against an in-memory SQLite database and a caller-supplied (or default)
 * deterministic LLM provider, seeds one device, starts the server on an
 * ephemeral port, and returns handles needed by scenarios.
 */
import { StreamingLLMProvider } from "./streaming-llm.js";
import type { AppServices } from "../../server/app.js";
import type { LLMProvider } from "../../server/llm/types.js";
import type { LlmTraceRecorder } from "../../server/orchestrator/llm-trace.js";
import type { FastifyInstance } from "fastify";

export interface ScenarioAppOptions {
  /** Override the LLM provider. Defaults to a fresh `StreamingLLMProvider`. */
  llmProvider?: LLMProvider;
  /**
   * Directory to save uploaded files. When omitted the route uses its default
   * (`config.uploadsStagingDir`). Pass a tmp dir in scenarios that exercise
   * image upload.
   */
  uploadsDir?: string;
  /** Override the durable asset root used by the app during a scenario. */
  assetsDir?: string;
  /** Optional trace recorder factory for scenarios that emit llm-trace.json. */
  llmTraceRecorderFactory?: () => LlmTraceRecorder | undefined;
}

export interface ScenarioAppContext {
  app: FastifyInstance;
  /** Full listening URL, e.g. "http://127.0.0.1:54321" */
  address: string;
  /** The device ID seeded during boot — use in every scenario request. */
  deviceId: string;
  /** Seeded guest-session cookies for protected browser routes. */
  cookieHeader: string;
  /** In-process service handles for deterministic harness setup. */
  services: ScenarioAppServices;
  /** Shut down the app and release the port. */
  close(): Promise<void>;
}

export interface ScenarioAppServices {
  assetService: AppServices["assetService"];
  chatService: AppServices["chatService"];
  foodLoggingService: AppServices["foodLoggingService"];
  summaryService: AppServices["summaryService"];
}

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

/**
 * Boot the full Fastify app against `:memory:` with `TZ=Asia/Taipei`, seed
 * one device, and return the context needed by a scenario.
 *
 * The caller is responsible for calling `ctx.close()` after the scenario
 * completes (or fails), typically in a `finally` block.
 */
export async function createScenarioApp(
  opts: ScenarioAppOptions,
): Promise<ScenarioAppContext> {
  // TZ must be set before server boot for day-boundary correctness.
  process.env.TZ = "Asia/Taipei";
  const { buildApp } = await import("../../server/app.js");

  const llmProvider = opts.llmProvider ?? new StreamingLLMProvider();
  let services: ScenarioAppServices | undefined;

  const buildOpts = {
    dbPath: ":memory:",
    llmProvider,
    ...(opts.uploadsDir !== undefined ? { uploadsDir: opts.uploadsDir } : {}),
    ...(opts.assetsDir !== undefined ? { assetsDir: opts.assetsDir } : {}),
    ...(opts.llmTraceRecorderFactory !== undefined ? { llmTraceRecorderFactory: opts.llmTraceRecorderFactory } : {}),
    onServicesReady: (readyServices: AppServices) => {
      services = {
        assetService: readyServices.assetService,
        chatService: readyServices.chatService,
        foodLoggingService: readyServices.foodLoggingService,
        summaryService: readyServices.summaryService,
      };
    },
  };

  const app = await buildApp(buildOpts);
  if (!services) {
    throw new Error("createScenarioApp: services were not captured during app boot");
  }

  // Seed one device so scenarios can make authenticated requests immediately.
  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/device",
    payload: { goal: "fat_loss" },
  });

  if (deviceRes.statusCode !== 200 && deviceRes.statusCode !== 201) {
    throw new Error(
      `createScenarioApp: device seeding failed with ${deviceRes.statusCode}: ${deviceRes.body}`,
    );
  }

  const deviceId = (deviceRes.json() as { deviceId: string }).deviceId;
  const cookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);

  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  return {
    app,
    address,
    deviceId,
    cookieHeader,
    services,
    close: async () => {
      if (app.server.listening) {
        await app.close();
      }
    },
  };
}
