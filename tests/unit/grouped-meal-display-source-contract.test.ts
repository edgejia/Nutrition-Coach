import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const GROUPED_DISPLAY_SOURCE_PATHS = [
  "server/services/food-logging.ts",
  "server/services/meal-history.ts",
  "server/services/history-query.ts",
  "server/services/chat.ts",
  "server/services/meal-correction.ts",
  "server/orchestrator/tools.ts",
] as const;

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

describe("grouped meal display source contract", () => {
  it("rejects grouped-name collapse copy in server grouped display projections", async () => {
    const collapsePattern = /等\$\{[^}]+\}項|等\d+項|\+\d+/;
    const collapsePatternSource = "等\\$\\{|等\\d+項|\\+\\d+";
    assert.match(collapsePatternSource, /等\\\$\\\{|等\\d\+項/);

    for (const relativePath of GROUPED_DISPLAY_SOURCE_PATHS) {
      const source = await readSource(relativePath);
      assert.doesNotMatch(
        source,
        collapsePattern,
        `${relativePath} must preserve full grouped names instead of 等\${...}項, 等N項, or +N`,
      );
    }
  });

  // Plan 83-03 (D-04/D-05): the logFood single-item shim and its vocabulary are
  // deleted. This inverted audit is the standing negative proof that the shim
  // symbols stay out of the audited server sources.
  it("keeps the deleted logFood shim symbols out of server sources", async () => {
    const shimPatterns: ReadonlyArray<{ pattern: RegExp; label: string }> = [
      { pattern: /\.logFood\(/, label: ".logFood( call" },
      { pattern: /\bFoodData\b/, label: "FoodData type" },
      { pattern: /LogFoodLegacyArgs/, label: "LogFoodLegacyArgs type" },
      { pattern: /MealCompatibilityEntry/, label: "MealCompatibilityEntry type" },
      { pattern: /projectCompatibilityEntry/, label: "projectCompatibilityEntry projection" },
    ];

    for (const relativePath of GROUPED_DISPLAY_SOURCE_PATHS) {
      const source = await readSource(relativePath);
      for (const { pattern, label } of shimPatterns) {
        assert.doesNotMatch(
          source,
          pattern,
          `${relativePath} must not reintroduce the deleted ${label}`,
        );
      }
    }

    const foodLoggingSource = await readSource("server/services/food-logging.ts");
    assert.match(foodLoggingSource, /export interface LoggedMealEntry/);
    assert.match(foodLoggingSource, /async logGroupedMeal\(deviceId: string, input: GroupedMealData\)/);
    assert.match(foodLoggingSource, /return projectLoggedMealEntry\(/);
  });

  it("prevents direct log_food execution writes through the logFood shim", async () => {
    const toolsSource = await readSource("server/orchestrator/tools.ts");
    const approvedCallSite = "server/services/food-logging.ts";
    const guardedCallSite = "server/orchestrator/tools.ts";

    assert.equal(approvedCallSite, "server/services/food-logging.ts");
    assert.equal(guardedCallSite, "server/orchestrator/tools.ts");
    assert.doesNotMatch(toolsSource, /foodLoggingService\.logFood\(/);
    assert.doesNotMatch(toolsSource, /\.logFood\(deviceId/);
  });
});
