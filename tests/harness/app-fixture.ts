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
  /** Deterministic real-fixture failure injection used by lifecycle controls. */
  lifecycleFault?: "services" | "seed" | "listen";
  /** Deterministic barriers/observers for lifecycle negative controls. */
  lifecycleTestControl?: {
    beforeBuild?: () => void | Promise<void>;
    onAppBuilt?: (app: FastifyInstance) => void;
    onContextCreated?: (context: ScenarioAppContext) => void;
    onServicesCaptured?: (services: ScenarioAppServices) => void;
  };
}

export type ScenarioAppFactory = (
  options: ScenarioAppOptions,
) => Promise<ScenarioAppContext>;

export interface ScenarioAppLifecycleObserver {
  onCreate?: () => void;
  onClose?: () => void;
}

const lifecycleObservers = new AsyncLocalStorage<ScenarioAppLifecycleObserver>();
const RUNNER_CAPABILITY = Symbol("runner-lifecycle-capability");

type LifecyclePhase = "preparing" | "root" | "scenario" | "closing" | "closed";

interface ScenarioAppLifecycleScope {
  phase: LifecyclePhase;
  capability: { readonly [RUNNER_CAPABILITY]: symbol };
  nestedCapability: symbol;
  pendingCleanups: Array<() => Promise<"complete" | "incomplete">>;
}

const lifecycleScopes = new AsyncLocalStorage<ScenarioAppLifecycleScope>();

interface RunnerBootPermit {
  scope: ScenarioAppLifecycleScope;
  kind: "root" | "nested";
  nestedCapability?: symbol;
}

const runnerBootPermits = new AsyncLocalStorage<RunnerBootPermit>();

function isRunnerCapability(
  value: unknown,
  scope: ScenarioAppLifecycleScope,
): value is ScenarioAppLifecycleScope["capability"] {
  return value === scope.capability;
}

export async function withScenarioAppLifecycleObserver<T>(
  observer: ScenarioAppLifecycleObserver,
  run: () => Promise<T>,
): Promise<T> {
  return lifecycleObservers.run(observer, run);
}

export async function withScenarioAppLifecycleScope<T>(
  run: (capability?: unknown) => Promise<T>,
): Promise<T> {
  const activeScope = lifecycleScopes.getStore();
  // Nested callers (including scenario code) never receive the runner
  // capability. Only the outer runner invocation may issue fixtures.
  if (activeScope) return run();
  const scope: ScenarioAppLifecycleScope = {
    phase: "preparing",
    capability: { [RUNNER_CAPABILITY]: Symbol("runner-scope") },
    nestedCapability: Symbol("runner-nested-capability"),
    pendingCleanups: [],
  };
  return lifecycleScopes.run(scope, () => run(scope.capability));
}

function registerPendingCleanup(
  scope: ScenarioAppLifecycleScope | undefined,
  cleanup: () => Promise<"complete" | "incomplete">,
): () => void {
  if (!scope) return () => {};
  scope.pendingCleanups.push(cleanup);
  return () => {
    const index = scope.pendingCleanups.indexOf(cleanup);
    if (index >= 0) scope.pendingCleanups.splice(index, 1);
  };
}

export async function drainRunnerLifecycleCleanup(
  capability: unknown,
): Promise<"complete" | "incomplete"> {
  const scope = lifecycleScopes.getStore();
  if (!scope || !isRunnerCapability(capability, scope)) return "incomplete";
  scope.phase = "closing";
  let cleanup: "complete" | "incomplete" = "complete";
  for (const pending of scope.pendingCleanups.splice(0).reverse()) {
    try {
      if ((await pending()) === "incomplete") cleanup = "incomplete";
    } catch {
      cleanup = "incomplete";
    }
  }
  return cleanup;
}

export function fenceRunnerLifecycle(capability: unknown): void {
  const scope = lifecycleScopes.getStore();
  if (!scope || !isRunnerCapability(capability, scope)) {
    throw new ScenarioAppLifecycleError("boot", 0, "incomplete");
  }
  scope.phase = "closing";
}

export function finishRunnerLifecycle(capability: unknown): void {
  const scope = lifecycleScopes.getStore();
  if (!scope || !isRunnerCapability(capability, scope)) {
    throw new ScenarioAppLifecycleError("close", 0, "incomplete");
  }
  scope.phase = "closed";
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
): Promise<ScenarioAppContext> {
  // TZ must be set before server boot for day-boundary correctness.
  process.env.TZ = "Asia/Taipei";
  const lifecycleScope = lifecycleScopes.getStore();
  const bootPermit = runnerBootPermits.getStore();
  const runnerRootBoot = bootPermit !== undefined
    && lifecycleScope !== undefined
    && bootPermit.scope === lifecycleScope
    && bootPermit.kind === "root"
    && lifecycleScope.phase === "root";
  const runnerNestedBoot = bootPermit !== undefined
    && lifecycleScope !== undefined
    && bootPermit.scope === lifecycleScope
    && bootPermit.kind === "nested"
    && bootPermit.nestedCapability === lifecycleScope.nestedCapability
    && lifecycleScope.phase === "scenario";
  const runnerOwned = runnerRootBoot || runnerNestedBoot;
  if (lifecycleScope && !runnerOwned) {
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  lifecycleObservers.getStore()?.onCreate?.();
  await opts.lifecycleTestControl?.beforeBuild?.();
  const { buildApp } = await import("../../server/app.js");

  const llmProvider = opts.llmProvider ?? new StreamingLLMProvider();
  let services: ScenarioAppServices | undefined;
  let cleanupServices: ScenarioAppServices | undefined;

  const buildOpts = {
    dbPath: ":memory:",
    llmProvider,
    ...(opts.uploadsDir !== undefined ? { uploadsDir: opts.uploadsDir } : {}),
    ...(opts.assetsDir !== undefined ? { assetsDir: opts.assetsDir } : {}),
    ...(opts.llmTraceRecorderFactory !== undefined ? { llmTraceRecorderFactory: opts.llmTraceRecorderFactory } : {}),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    ...(opts.admissionLimiterOptions !== undefined ? { admissionLimiterOptions: opts.admissionLimiterOptions } : {}),
    onServicesReady: (readyServices: AppServices) => {
      const capturedServices: ScenarioAppServices = {
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
      services = capturedServices;
      cleanupServices = capturedServices;
    },
  };

  let app: FastifyInstance;
  try {
    app = await buildApp(buildOpts);
  } catch {
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  // Establish cleanup immediately after build, before any test observer can
  // throw, so every built fixture has one owner even when no context is issued.
  let closeCalls = 0;
  let closeAttempted = false;
  let closed = false;
  const closeUnderlying = async (): Promise<void> => {
    if (closeAttempted) return;
    closeAttempted = true;
    let incomplete = false;
    try {
      await app.close();
    } catch {
      incomplete = true;
    }
    try {
      const sqlite = cleanupServices?.db.$client;
      if (sqlite?.open) sqlite.close();
    } catch {
      incomplete = true;
    }
    if (incomplete) {
      throw new ScenarioAppLifecycleError("close", 1, "incomplete");
    }
    closed = true;
    lifecycleObservers.getStore()?.onClose?.();
  };
  const close = async (): Promise<void> => {
    if (closeAttempted || closed) return;
    closeCalls = 1;
    await closeUnderlying();
  };

  const releasePendingCleanup = registerPendingCleanup(
    runnerOwned ? lifecycleScope : undefined,
    async () => {
      try {
        await closeUnderlying();
        return "complete";
      } catch {
        return "incomplete";
      }
    },
  );

  const failAfterBuild = async (stage: "boot" | "seed" | "listen"): Promise<never> => {
    if (runnerOwned) {
      throw new ScenarioAppLifecycleError(stage, 0, "complete");
    }
    let cleanup: "complete" | "incomplete" = "complete";
    try {
      await closeUnderlying();
    } catch {
      cleanup = "incomplete";
    }
    throw new ScenarioAppLifecycleError(stage, 0, cleanup);
  };

  try {
    opts.lifecycleTestControl?.onAppBuilt?.(app);
    if (cleanupServices) opts.lifecycleTestControl?.onServicesCaptured?.(cleanupServices);
  } catch {
    return failAfterBuild("boot");
  }

  if (opts.lifecycleFault === "services") services = undefined;
  if (!services) {
    return failAfterBuild("boot");
  }

  // Seed one device so scenarios can make authenticated requests immediately.

  let deviceRes;
  try {
    if (opts.lifecycleFault === "seed") throw new Error("seed fault injection");
    deviceRes = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
  } catch {
    return failAfterBuild("seed");
  }

  if (deviceRes.statusCode !== 200 && deviceRes.statusCode !== 201) {
    return failAfterBuild("seed");
  }

  const deviceId = (deviceRes.json() as { deviceId: string }).deviceId;
  const cookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);

  let address: string;
  try {
    if (opts.lifecycleFault === "listen") throw new Error("listen fault injection");
    address = await app.listen({ port: 0, host: "127.0.0.1" });
  } catch {
    return failAfterBuild("listen");
  }

  const context: ScenarioAppContext = {
    app,
    address,
    deviceId,
    cookieHeader,
    services,
    llmProvider,
    close,
    get closeCalls() { return closeCalls; },
  };
  try {
    opts.lifecycleTestControl?.onContextCreated?.(context);
  } catch {
    return failAfterBuild("boot");
  }
  releasePendingCleanup();
  if (runnerRootBoot && lifecycleScope) lifecycleScope.phase = "scenario";
  return context;
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
export function createRunnerOwnedNestedScenarioAppFactory(capability?: unknown): ScenarioAppFactory {
  const lifecycleScope = lifecycleScopes.getStore();
  if (!lifecycleScope || !isRunnerCapability(capability, lifecycleScope) || lifecycleScope.phase !== "scenario") {
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  const capturedScope = lifecycleScope;
  const nestedCapability = lifecycleScope.nestedCapability;
  return (options) => {
    if (lifecycleScopes.getStore() !== capturedScope || capturedScope.phase !== "scenario") {
      return Promise.reject(new ScenarioAppLifecycleError("boot", 0, "complete"));
    }
    return runnerBootPermits.run(
      { scope: capturedScope, kind: "nested", nestedCapability },
      () => createScenarioAppInternal(options),
    );
  };
}

export async function createRunnerRootScenarioApp(
  capability: unknown,
  options: ScenarioAppOptions,
): Promise<ScenarioAppContext> {
  return withRunnerRootScenarioAppCreation(
    capability,
    () => createScenarioAppInternal(options),
  );
}

export async function withRunnerRootScenarioAppCreation<T>(
  capability: unknown,
  create: () => Promise<T>,
): Promise<T> {
  const lifecycleScope = lifecycleScopes.getStore();
  if (!lifecycleScope || !isRunnerCapability(capability, lifecycleScope) || lifecycleScope.phase !== "preparing") {
    throw new ScenarioAppLifecycleError("boot", 0, "complete");
  }
  lifecycleScope.phase = "root";
  const result = await runnerBootPermits.run(
    { scope: lifecycleScope, kind: "root" },
    create,
  );
  if (lifecycleScope.phase === "root") lifecycleScope.phase = "scenario";
  return result;
}
