/**
 * Reusable app fixture for the deterministic verification harness.
 *
 * Provides `createScenarioApp()` which boots the real Fastify application
 * against an in-memory SQLite database and a caller-supplied (or default)
 * deterministic LLM provider, seeds one device, starts the server on an
 * ephemeral port, and returns handles needed by scenarios.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { StreamingLLMProvider } from "./streaming-llm.js";
import type { AppOptions, AppServices } from "../../server/app.js";
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
  /** Optional Fastify logger config for scenarios that assert structured route logs. */
  logger?: AppOptions["logger"];
  /** Runner-owned admission budgets for high-volume deterministic scenarios. */
  admissionLimiterOptions?: AppOptions["admissionLimiterOptions"];
  /** Internal lifecycle owner; only the runner may set this value. */
  lifecycleOwner?: "runner";
}

export type ScenarioAppFactory = (
  options: Omit<ScenarioAppOptions, "lifecycleOwner">,
) => Promise<ScenarioAppContext>;

export interface ScenarioAppLifecycleObserver {
  onCreate?: () => void;
  onClose?: () => void;
}

const lifecycleObservers = new AsyncLocalStorage<ScenarioAppLifecycleObserver>();
interface ScenarioAppLifecycleScope {
  runnerAppActive: boolean;
}

const lifecycleScopes = new AsyncLocalStorage<ScenarioAppLifecycleScope>();
const RUNNER_NESTED_FIXTURE = Symbol("runner-nested-fixture");

export async function withScenarioAppLifecycleObserver<T>(
  observer: ScenarioAppLifecycleObserver,
  run: () => Promise<T>,
): Promise<T> {
  return lifecycleObservers.run(observer, run);
}

export async function withScenarioAppLifecycleScope<T>(run: () => Promise<T>): Promise<T> {
  const activeScope = lifecycleScopes.getStore();
  if (activeScope) return run();
  return lifecycleScopes.run({ runnerAppActive: false }, run);
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
  /** Provider configured by the runner before app boot. */
  llmProvider: LLMProvider;
  /** Shut down the app and release the port. */
  close(): Promise<void>;
  /** Number of runner-owned close attempts; nested fixtures must not call this. */
  readonly closeCalls: number;
}

export type ScenarioLifecycleStage = "boot" | "seed" | "listen" | "close";

export class ScenarioAppLifecycleError extends Error {
  readonly stage: ScenarioLifecycleStage;
  readonly closeCalls: 0 | 1;
  readonly cleanup: "complete" | "incomplete";

  constructor(
    stage: ScenarioLifecycleStage,
    closeCalls: 0 | 1,
    cleanup: "complete" | "incomplete",
  ) {
    super(`Scenario app ${stage} stage failed`);
    this.name = "ScenarioAppLifecycleError";
    this.stage = stage;
    this.closeCalls = closeCalls;
    this.cleanup = cleanup;
  }
}

export interface ScenarioAppServices {
  assetService: AppServices["assetService"];
  chatService: AppServices["chatService"];
  db: AppServices["db"];
  foodLoggingService: AppServices["foodLoggingService"];
  goalProposalService: AppServices["goalProposalService"];
  mealCorrectionService: AppServices["mealCorrectionService"];
  mealDeleteProposalService: AppServices["mealDeleteProposalService"];
  mealNumericProposalService: AppServices["mealNumericProposalService"];
  publisher: AppServices["publisher"];
  proposalCardService: AppServices["proposalCardService"];
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
async function createScenarioAppInternal(
  opts: ScenarioAppOptions,
  nestedOwner?: symbol,
): Promise<ScenarioAppContext> {
  // TZ must be set before server boot for day-boundary correctness.
  process.env.TZ = "Asia/Taipei";
  const lifecycleScope = lifecycleScopes.getStore();
  const lifecycleOwner = opts.lifecycleOwner ?? "standalone";
  const runnerNestedBoot = nestedOwner === RUNNER_NESTED_FIXTURE;
  if (lifecycleScope?.runnerAppActive && !runnerNestedBoot) {
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  if (runnerNestedBoot && !lifecycleScope?.runnerAppActive) {
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  if (lifecycleOwner === "runner" && lifecycleScope) lifecycleScope.runnerAppActive = true;
  lifecycleObservers.getStore()?.onCreate?.();
  const { buildApp } = await import("../../server/app.js");

  const llmProvider = opts.llmProvider ?? new StreamingLLMProvider();
  let services: ScenarioAppServices | undefined;

  const buildOpts = {
    dbPath: ":memory:",
    llmProvider,
    ...(opts.uploadsDir !== undefined ? { uploadsDir: opts.uploadsDir } : {}),
    ...(opts.assetsDir !== undefined ? { assetsDir: opts.assetsDir } : {}),
    ...(opts.llmTraceRecorderFactory !== undefined ? { llmTraceRecorderFactory: opts.llmTraceRecorderFactory } : {}),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    ...(opts.admissionLimiterOptions !== undefined ? { admissionLimiterOptions: opts.admissionLimiterOptions } : {}),
    onServicesReady: (readyServices: AppServices) => {
      services = {
        assetService: readyServices.assetService,
        chatService: readyServices.chatService,
        db: readyServices.db,
        foodLoggingService: readyServices.foodLoggingService,
        goalProposalService: readyServices.goalProposalService,
        mealCorrectionService: readyServices.mealCorrectionService,
        mealDeleteProposalService: readyServices.mealDeleteProposalService,
        mealNumericProposalService: readyServices.mealNumericProposalService,
        publisher: readyServices.publisher,
        proposalCardService: readyServices.proposalCardService,
        summaryService: readyServices.summaryService,
      };
    },
  };

  let app: FastifyInstance;
  try {
    app = await buildApp(buildOpts);
  } catch {
    if (lifecycleOwner === "runner" && lifecycleScope) lifecycleScope.runnerAppActive = false;
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  if (!services) {
    if (lifecycleOwner === "runner" && lifecycleScope) lifecycleScope.runnerAppActive = false;
    throw new Error("createScenarioApp: services were not captured during app boot");
  }

  // Seed one device so scenarios can make authenticated requests immediately.
  let closeCalls = 0;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closeCalls += 1;
    try {
      if (app.server.listening) await app.close();
      closed = true;
      lifecycleObservers.getStore()?.onClose?.();
      if (lifecycleOwner === "runner" && lifecycleScope) lifecycleScope.runnerAppActive = false;
    } catch {
      throw new ScenarioAppLifecycleError("close", 1, "incomplete");
    }
  };

  let deviceRes;
  try {
    deviceRes = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
  } catch {
    try { await close(); } catch { /* bounded lifecycle error below */ }
    throw new ScenarioAppLifecycleError("seed", closeCalls as 0 | 1, closed ? "complete" : "incomplete");
  }

  if (deviceRes.statusCode !== 200 && deviceRes.statusCode !== 201) {
    try { await close(); } catch { /* bounded lifecycle error below */ }
    throw new ScenarioAppLifecycleError("seed", closeCalls as 0 | 1, closed ? "complete" : "incomplete");
  }

  const deviceId = (deviceRes.json() as { deviceId: string }).deviceId;
  const cookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);

  let address: string;
  try {
    address = await app.listen({ port: 0, host: "127.0.0.1" });
  } catch {
    try { await close(); } catch { /* bounded lifecycle error below */ }
    throw new ScenarioAppLifecycleError("listen", closeCalls as 0 | 1, closed ? "complete" : "incomplete");
  }

  return {
    app,
    address,
    deviceId,
    cookieHeader,
    services,
    llmProvider,
    close,
    get closeCalls() { return closeCalls; },
  };
}

export async function createScenarioApp(
  opts: ScenarioAppOptions,
): Promise<ScenarioAppContext> {
  return createScenarioAppInternal(opts);
}

/**
 * Create the only factory allowed to boot nested fixtures in a runner-owned
 * lifecycle scope. Direct createScenarioApp() calls remain fail-closed.
 */
export function createRunnerOwnedNestedScenarioAppFactory(): ScenarioAppFactory {
  const lifecycleScope = lifecycleScopes.getStore();
  if (!lifecycleScope) {
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  lifecycleScope.runnerAppActive = true;
  return (options) => createScenarioAppInternal(options, RUNNER_NESTED_FIXTURE);
}
