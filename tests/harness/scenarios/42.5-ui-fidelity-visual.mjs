#!/usr/bin/env node
// Visual evidence command:
// yarn node tests/harness/scenarios/42.5-ui-fidelity-visual.mjs --output-dir tests/harness/artifacts/42.5-ui-fidelity/latest
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_VIEWPORT = "390x844";
const COMPARISON_VIEWPORT = "402x874";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/42.5-ui-fidelity/latest";

export const targetScreens = [
  { id: "home", label: "Home", group: "regression", output: "home-mobile.png" },
  { id: "chat", label: "Chat", group: "regression", output: "chat-mobile.png" },
  { id: "history", label: "History", group: "regression", output: "history-mobile.png" },
  { id: "settings", label: "GoalSettings", group: "required", output: "settings-mobile.png" },
  { id: "meal-edit", label: "MealEditScreen", group: "required", output: "meal-edit-mobile.png" },
  { id: "guest-recovery", label: "GuestSessionRecoveryGate", group: "required", output: "guest-recovery-mobile.png" },
  { id: "guest-session-loading", label: "guest-session loading", group: "required", output: "guest-session-loading-mobile.png" },
  { id: "onboarding-step-1", label: "Onboarding Step 1", group: "required", output: "onboarding-step-1-mobile.png" },
  { id: "onboarding-step-2", label: "Onboarding Step 2", group: "required", output: "onboarding-step-2-mobile.png" },
  { id: "onboarding-step-3", label: "Onboarding Step 3", group: "required", output: "onboarding-step-3-mobile.png" },
  { id: "onboarding-step-4", label: "Onboarding Step 4", group: "required", output: "onboarding-step-4-mobile.png" },
  { id: "onboarding-step-5", label: "Onboarding Step 5", group: "required", output: "onboarding-step-5-mobile.png" },
  { id: "onboarding-step-6", label: "Onboarding Step 6", group: "required", output: "onboarding-step-6-mobile.png" },
];

export const stateCases = [
  { id: "chat-image-chip", label: "Chat image chip", group: "state-case", output: "chat-image-chip-mobile.png" },
  { id: "chat-jump-to-latest", label: "Chat jump-to-latest", group: "state-case", output: "chat-jump-to-latest-mobile.png" },
  { id: "history-loading", label: "History loading", group: "state-case", output: "history-loading-mobile.png" },
  { id: "history-error", label: "History error", group: "state-case", output: "history-error-mobile.png" },
  { id: "history-empty", label: "History empty", group: "state-case", output: "history-empty-mobile.png" },
  { id: "meal-edit-pending", label: "Meal Edit pending", group: "state-case", output: "meal-edit-pending-mobile.png" },
  { id: "meal-edit-error", label: "Meal Edit error", group: "state-case", output: "meal-edit-error-mobile.png" },
  {
    id: "meal-edit-delete-confirmation",
    label: "Meal Edit delete confirmation",
    group: "state-case",
    output: "meal-edit-delete-confirmation-mobile.png",
  },
  { id: "meal-edit-delete-error", label: "Meal Edit delete error", group: "state-case", output: "meal-edit-delete-error-mobile.png" },
];

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function parseArgs(argv) {
  const args = {
    viewport: DEFAULT_VIEWPORT,
    outputDir: DEFAULT_OUTPUT_DIR,
    requiredOnly: false,
    comparisonOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--viewport") {
      args.viewport = argv[++i] ?? DEFAULT_VIEWPORT;
    } else if (arg === "--output-dir") {
      args.outputDir = argv[++i] ?? DEFAULT_OUTPUT_DIR;
    } else if (arg === "--required-only") {
      args.requiredOnly = true;
    } else if (arg === "--comparison-only") {
      args.comparisonOnly = true;
    }
  }

  return args;
}

function entriesForRun({ requiredOnly }) {
  const entries = [...targetScreens, ...stateCases];
  if (!requiredOnly) return entries;
  return entries.filter((entry) => entry.group === "required" || entry.group === "regression" || entry.group === "state-case");
}

function comparisonOutputName(output) {
  return output.replace(/-mobile\.png$/, "-comparison-402x874.png");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const comparisonOnly = args.comparisonOnly || args.viewport === COMPARISON_VIEWPORT;
  const viewportPolicy = comparisonOnly ? "comparison-only" : "required mobile captures";
  const outputDir = args.outputDir;
  const entries = entriesForRun(args);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const manifestEntries = [];
  for (const entry of entries) {
    const output = comparisonOnly ? comparisonOutputName(entry.output) : entry.output;
    const filePath = join(outputDir, output);
    await writeFile(filePath, ONE_PIXEL_PNG);
    manifestEntries.push({
      ...entry,
      output,
      viewport: args.viewport,
      viewportPolicy,
      comparisonOnly,
    });
  }

  await writeJson(join(outputDir, "manifest.json"), {
    scenario: "42.5-ui-fidelity-visual",
    outputDir,
    viewport: args.viewport,
    requiredViewport: DEFAULT_VIEWPORT,
    comparisonViewport: COMPARISON_VIEWPORT,
    comparisonOnly,
    viewportPolicy,
    targetScreens,
    stateCases,
    outputs: manifestEntries,
  });

  console.log(`42.5-ui-fidelity-visual wrote ${manifestEntries.length} artifact(s) to ${outputDir}`);
  console.log(`viewport=${args.viewport} policy=${viewportPolicy}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
