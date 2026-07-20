/**
 * Scenario runner CLI for the deterministic verification harness.
 *
 * Usage:
 *   node --import tsx tests/harness/run.ts <scenario-name>
 *   yarn verify:harness -- text-log
 *
 * Behaviour:
 *   - Dynamically imports `./scenarios/<scenarioName>.js`
 *   - Boots a scenario app via `createScenarioApp()`
 *   - Executes the scenario's `run()` method
 *   - Writes redacted JSON artifacts via `writeScenarioArtifacts()`
 *   - Prints a single-line summary: "PASS text-log 7/7" or "FAIL image-log verify_meals"
 *   - Exits with code 1 on failure
 */

import {
  createScenarioApp,
  createRunnerRootScenarioApp,
  createRunnerOwnedNestedScenarioAppFactory,
  drainRunnerLifecycleCleanup,
  fenceRunnerLifecycle,
  finishRunnerLifecycle,
  ScenarioAppLifecycleError,
  withRunnerRootScenarioAppCreation,
  withScenarioAppLifecycleScope,
  type ScenarioAppContext,
  type ScenarioAppFactory,
} from "./app-fixture.js";
import { writeRunnerFailureArtifacts, writeScenarioArtifacts, type RunnerFailureEnvelope } from "./artifacts.js";
import type { VerificationScenario, ScenarioResult } from "./scenario-types.js";

export interface ScenarioRunnerOptions {
  signal?: AbortSignal;
  loadScenario?: (scenarioName: string) => Promise<VerificationScenario>;
  createApp?: typeof createScenarioApp;
  writeFailureArtifacts?: typeof writeRunnerFailureArtifacts;
  writeScenarioArtifacts?: typeof writeScenarioArtifacts;
  /** Deterministic runner-only lifecycle controls used by negative tests. */
  faultInjection?: {
    stage: "boot" | "seed" | "listen" | "close";
  };
}

class ScenarioRunnerInterruptedError extends Error {
  constructor() {
    super("Scenario run was interrupted");
    this.name = "ScenarioRunnerInterruptedError";
  }
}

function throwIfInterrupted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ScenarioRunnerInterruptedError();
}

function classifyFailure(
  error: unknown,
  context: ScenarioAppContext | undefined,
  signal: AbortSignal | undefined,
  forcedStage?: "close",
) {
  const lifecycle = error instanceof ScenarioAppLifecycleError ? error : undefined;
  const interrupted = signal?.aborted === true || error instanceof ScenarioRunnerInterruptedError;
  const stage: "boot" | "seed" | "listen" | "scenario" | "close" | "interrupt" = forcedStage ?? (interrupted
    ? "interrupt" as const
    : lifecycle?.stage ?? (context ? "scenario" as const : "boot" as const));
  const category = stage === "boot"
    ? "boot_failed" as const
    : stage === "seed"
      ? "seed_failed" as const
      : stage === "listen"
        ? "listen_failed" as const
        : stage === "close"
          ? "close_failed" as const
          : stage === "interrupt"
            ? "interrupted" as const
            : "scenario_failed" as const;
  return { error, stage, category, interrupted, lifecycle };
}

// ---------------------------------------------------------------------------
// Public API — importable by other harness tooling
// ---------------------------------------------------------------------------

/**
 * Run a named scenario by dynamically importing it from `./scenarios/`.
 * Returns the `ScenarioResult` so callers can inspect or assert on it.
 *
 * Does NOT call `process.exit` — that is left to the CLI entry point below.
 */
export async function runScenarioByName(
  scenarioName: string,
  options: ScenarioRunnerOptions = {},
): Promise<ScenarioResult> {
  return withScenarioAppLifecycleScope((capability) => runScenarioByNameInScope(scenarioName, options, capability));
}

async function runScenarioByNameInScope(
  scenarioName: string,
  options: ScenarioRunnerOptions,
  capability: unknown,
): Promise<ScenarioResult> {
  const signal = options.signal;
  const loadScenario = options.loadScenario ?? (async (name: string) => {
    const scenarioModule = (await import(`./scenarios/${name}.js`)) as {
      default?: VerificationScenario;
      scenario?: VerificationScenario;
    };
    const scenario = scenarioModule.default ?? scenarioModule.scenario;
    if (!scenario || typeof scenario.run !== "function") {
      throw new Error(
        `Scenario module "./scenarios/${name}.js" must export a default VerificationScenario with a run() method.`,
      );
    }
    return scenario;
  });
  const createApp = options.createApp ?? createScenarioApp;
  const writeFailureArtifacts = options.writeFailureArtifacts ?? writeRunnerFailureArtifacts;
  const writeArtifacts = options.writeScenarioArtifacts ?? writeScenarioArtifacts;
  const faultStage = options.faultInjection?.stage;
  let ctx: ScenarioAppContext | undefined;
  const nestedCreations: Array<{
    context?: ScenarioAppContext;
    error?: unknown;
    settled: Promise<void>;
  }> = [];
  let nestedIssuanceOpen = false;
  let result: ScenarioResult | undefined;
  let failure: ReturnType<typeof classifyFailure> | undefined;
  let cleanup: "complete" | "incomplete" = "complete";

  try {
    throwIfInterrupted(signal);
    const scenario = await loadScenario(scenarioName);
    throwIfInterrupted(signal);
    if (faultStage === "boot") {
      throw new ScenarioAppLifecycleError(faultStage, 0, "complete");
    }
    if ((faultStage === "seed" || faultStage === "listen") && createApp !== createScenarioApp) {
      throw new ScenarioAppLifecycleError(faultStage, 0, "complete");
    }
    const preparation = scenario.prepareApp ? await scenario.prepareApp() : {};
    const appOptions = {
      ...(preparation.appOptions ?? {}),
      ...(faultStage === "seed" || faultStage === "listen" ? { lifecycleFault: faultStage } : {}),
    };
    ctx = createApp === createScenarioApp
      ? await createRunnerRootScenarioApp(capability, appOptions)
      : await withRunnerRootScenarioAppCreation(capability, () => createApp(appOptions));
    const createNestedApp = createRunnerOwnedNestedScenarioAppFactory(capability);
    nestedIssuanceOpen = true;
    const trackedCreateApp: ScenarioAppFactory = (options) => {
      if (!nestedIssuanceOpen) {
        const rejected = Promise.reject<ScenarioAppContext>(
          new ScenarioAppLifecycleError("boot", 0, "complete"),
        );
        void rejected.catch(() => {});
        return rejected;
      }

      const slot: (typeof nestedCreations)[number] = { settled: Promise.resolve() };
      nestedCreations.push(slot);
      let creation: Promise<ScenarioAppContext>;
      try {
        creation = createNestedApp(options);
      } catch (error) {
        creation = Promise.reject(error);
      }
      const publicCreation: Promise<ScenarioAppContext> = creation.then((nested) => {
        slot.context = nested;
        return {
          ...nested,
          // Scenario-visible close remains inert; only the runner closes.
          close: async () => {},
          get closeCalls() { return nested.closeCalls; },
        } as ScenarioAppContext;
      });
      slot.settled = publicCreation.then(
        () => {},
        (error) => { slot.error = error; },
      );
      // Fire-and-forget scenario calls are still observed and drained by the
      // slot above, so their rejection cannot become unhandled process state.
      void publicCreation.catch(() => {});
      return publicCreation;
    };
    if (faultStage === "close") {
      const originalContext = ctx;
      const originalClose = originalContext.close.bind(originalContext);
      ctx = {
        ...originalContext,
        close: async () => {
          await originalClose();
          throw new Error("runner close fault injection");
        },
        get closeCalls() {
          return originalContext.closeCalls;
        },
      };
    }
    throwIfInterrupted(signal);
    result = await scenario.run({
      app: ctx.app,
      address: ctx.address,
      deviceId: ctx.deviceId,
      cookieHeader: ctx.cookieHeader,
      services: ctx.services,
      llmProvider: ctx.llmProvider,
      createApp: trackedCreateApp,
      prepared: preparation.state,
      signal,
    });
    throwIfInterrupted(signal);
  } catch (error) {
    failure = classifyFailure(error, ctx, signal);
  } finally {
    let closeError: unknown;
    nestedIssuanceOpen = false;
    try {
      fenceRunnerLifecycle(capability);
    } catch (error) {
      closeError ??= error;
      cleanup = "incomplete";
    }
    await Promise.all(nestedCreations.map((creation) => creation.settled));
    const nestedFailure = nestedCreations.find((creation) => creation.error !== undefined)?.error;
    if (nestedFailure !== undefined && failure === undefined) {
      failure = classifyFailure(nestedFailure, ctx, signal);
    }
    for (const creation of [...nestedCreations].reverse()) {
      const nested = creation.context;
      if (!nested) continue;
      if (nested.closeCalls !== 0) continue;
      try {
        await nested.close();
      } catch (error) {
        closeError ??= error;
      }
    }
    // A nested fixture can fail after boot but before it is issued as a
    // context. Drain that runner-held cleanup before closing the root so
    // reverse creation order remains deterministic.
    if ((await drainRunnerLifecycleCleanup(capability)) === "incomplete") {
      cleanup = "incomplete";
    }
    if (ctx && ctx.closeCalls === 0) {
      try {
        await ctx.close();
      } catch (error) {
        closeError ??= error;
      }
    }
    if (closeError !== undefined && ctx) {
      failure = classifyFailure(closeError, ctx, signal, "close");
    }
    try {
      finishRunnerLifecycle(capability);
    } catch {
      cleanup = "incomplete";
    }
  }

  if (failure) {
    const resolvedCleanup = cleanup === "incomplete"
      || failure.stage === "close"
      || failure.lifecycle?.cleanup === "incomplete"
      ? "incomplete"
      : "complete";
    const envelope: RunnerFailureEnvelope = {
      schemaVersion: 1,
      result: "failure",
      stage: failure.stage,
      category: failure.category,
      owner: "runner",
      closeCalls: ctx ? (ctx.closeCalls === 0 ? 0 : 1) : (failure.lifecycle?.closeCalls ?? 0),
      cleanup: resolvedCleanup,
      interrupted: failure.interrupted,
    };
    try { writeFailureArtifacts(scenarioName, envelope); } catch { /* retain original failure */ }
    throw failure.error;
  }

  await writeArtifacts(scenarioName, result!);
  return result!;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: node --import tsx tests/harness/run.ts <scenario-name>");
    console.log("       yarn verify:harness -- <scenario-name>");
    console.log("");
    console.log("Example:");
    console.log("  yarn verify:harness -- text-log");
    console.log("  yarn verify:harness -- daily-rollover");
    console.log("  yarn verify:harness -- boundary-contracts");
    console.log("  yarn verify:harness -- meal-delete-consistency");
    process.exitCode = args.length === 0 ? 1 : 0;
    return;
  }

  const scenarioName = args[0];
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const result = await runScenarioByName(scenarioName, { signal: controller.signal });
    console.log(result.consoleSummary);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERROR ${scenarioName}: ${message}`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

// Run CLI only when invoked directly.
if (
  process.argv[1]?.endsWith("run.ts") ||
  process.argv[1]?.endsWith("run.js")
) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
