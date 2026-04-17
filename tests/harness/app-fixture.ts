/**
 * Reusable app fixture for the deterministic verification harness.
 *
 * Provides `createScenarioApp()` which boots the real Fastify application
 * against an in-memory SQLite database and a caller-supplied (or default)
 * deterministic LLM provider, seeds one device, starts the server on an
 * ephemeral port, and returns handles needed by scenarios.
 */

import { buildApp } from "../../server/app.js";
import { StreamingLLMProvider } from "./streaming-llm.js";
import type { AppServices } from "../../server/app.js";
import type { LLMProvider } from "../../server/llm/types.js";
import type { FastifyInstance } from "fastify";

export interface ScenarioAppOptions {
  /** Override the LLM provider. Defaults to a fresh `StreamingLLMProvider`. */
  llmProvider?: LLMProvider;
  /**
   * Directory to save uploaded files. When omitted the route uses its default
   * (`server/uploads/`). Pass a tmp dir in scenarios that exercise image upload.
   */
  uploadsDir?: string;
}

export interface ScenarioAppContext {
  app: FastifyInstance;
  /** Full listening URL, e.g. "http://127.0.0.1:54321" */
  address: string;
  /** The device ID seeded during boot — use in every scenario request. */
  deviceId: string;
  /** In-process service handles for deterministic harness setup. */
  services: ScenarioAppServices;
  /** Shut down the app and release the port. */
  close(): Promise<void>;
}

export interface ScenarioAppServices {
  foodLoggingService: AppServices["foodLoggingService"];
  summaryService: AppServices["summaryService"];
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

  const llmProvider = opts.llmProvider ?? new StreamingLLMProvider();
  let services: ScenarioAppServices | undefined;

  const buildOpts: Parameters<typeof buildApp>[0] = {
    dbPath: ":memory:",
    llmProvider,
    ...(opts.uploadsDir !== undefined ? { uploadsDir: opts.uploadsDir } : {}),
    onServicesReady: (readyServices) => {
      services = {
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

  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  return {
    app,
    address,
    deviceId,
    services,
    close: async () => {
      if (app.server.listening) {
        await app.close();
      }
    },
  };
}
