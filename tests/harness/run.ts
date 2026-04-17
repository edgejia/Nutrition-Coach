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

import { createScenarioApp } from "./app-fixture.js";
import { writeScenarioArtifacts } from "./artifacts.js";
import type { VerificationScenario, ScenarioResult } from "./scenario-types.js";

// ---------------------------------------------------------------------------
// Public API — importable by other harness tooling
// ---------------------------------------------------------------------------

/**
 * Run a named scenario by dynamically importing it from `./scenarios/`.
 * Returns the `ScenarioResult` so callers can inspect or assert on it.
 *
 * Does NOT call `process.exit` — that is left to the CLI entry point below.
 */
export async function runScenarioByName(scenarioName: string): Promise<ScenarioResult> {
  // Dynamic import resolves relative to this file's directory at runtime.
  const scenarioModule = (await import(`./scenarios/${scenarioName}.js`)) as {
    default?: VerificationScenario;
    scenario?: VerificationScenario;
  };

  const scenario: VerificationScenario | undefined =
    scenarioModule.default ?? scenarioModule.scenario;

  if (!scenario || typeof scenario.run !== "function") {
    throw new Error(
      `Scenario module "./scenarios/${scenarioName}.js" must export a default VerificationScenario with a run() method.`,
    );
  }

  const ctx = await createScenarioApp({});

  let result: ScenarioResult;
  try {
    result = await scenario.run({
      app: ctx.app,
      address: ctx.address,
      deviceId: ctx.deviceId,
    });
  } finally {
    await ctx.close();
  }

  await writeScenarioArtifacts(scenarioName, result);

  return result;
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
    process.exitCode = args.length === 0 ? 1 : 0;
    return;
  }

  const scenarioName = args[0];

  try {
    const result = await runScenarioByName(scenarioName);
    console.log(result.consoleSummary);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERROR ${scenarioName}: ${message}`);
    process.exitCode = 1;
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
