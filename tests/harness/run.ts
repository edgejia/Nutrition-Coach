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

import { createScenarioApp, ScenarioAppLifecycleError, type ScenarioAppContext } from "./app-fixture.js";
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
  let result: ScenarioResult | undefined;
  let failure: ReturnType<typeof classifyFailure> | undefined;

  try {
    throwIfInterrupted(signal);
    const scenario = await loadScenario(scenarioName);
    throwIfInterrupted(signal);
    if (faultStage === "boot" || faultStage === "seed" || faultStage === "listen") {
      throw new ScenarioAppLifecycleError(faultStage, 0, "complete");
    }
    ctx = await createApp({});
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
      signal,
    });
    throwIfInterrupted(signal);
  } catch (error) {
    failure = classifyFailure(error, ctx, signal);
  } finally {
    if (ctx && ctx.closeCalls === 0) {
      try {
        await ctx.close();
      } catch (error) {
        failure = classifyFailure(error, ctx, signal, "close");
      }
    }
  }

  if (failure) {
    const envelope: RunnerFailureEnvelope = {
      schemaVersion: 1,
      result: "failure",
      stage: failure.stage,
      category: failure.category,
      owner: "runner",
      closeCalls: ctx ? (ctx.closeCalls === 0 ? 0 : 1) : (failure.lifecycle?.closeCalls ?? 0),
      cleanup: failure.lifecycle?.cleanup ?? (failure.stage === "close"
        ? "incomplete"
        : (ctx ? (ctx.closeCalls === 0 ? "incomplete" : "complete") : "complete")),
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
