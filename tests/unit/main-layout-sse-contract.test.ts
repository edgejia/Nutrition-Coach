import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

describe("MainLayout SSE summary coordinator contract", () => {
  it("routes daily_summary envelopes and initial meal loads through the coordinator", async () => {
    const source = await readSource("../../client/src/components/MainLayout.tsx");

    assert.match(
      source,
      /import \{ createSSESummaryCoordinator \} from "\.\.\/sse-summary-coordinator\.js";/,
    );
    assert.equal(source.match(/createSSESummaryCoordinator/g)?.length, 2);
    assert.match(source, /const sseSummaryCoordinator = useMemo\([\s\S]*createSSESummaryCoordinator/);
    assert.match(source, /const recordMealMutation = useStore\(\(s\) => s\.recordMealMutation\)/);
    assert.match(source, /recordMealMutation,/);
    assert.match(source, /onUnauthorized: \(\) => {\s*void recoverGuestSession\(\);/);

    const connectCalls = source.match(/connectSSE\([\s\S]*?\}\);/g) ?? [];
    assert.equal(connectCalls.length, 2);
    for (const call of connectCalls) {
      assert.match(call, /onDailySummaryEnvelope: sseSummaryCoordinator\.handleSummary/);
      assert.doesNotMatch(call, /onSummary/);
      assert.doesNotMatch(call, /setDailySummary/);
    }

    assert.match(source, /sseSummaryCoordinator\.runInitialMealsLoad\(\{ refreshReason: "day_rollover" \}\)/);
    assert.match(source, /sseSummaryCoordinator\.runInitialMealsLoad\(\)/);
    assert.doesNotMatch(source, /\.then\(\(\{ meals \}\) => setMeals\(meals\)\)/);
    assert.doesNotMatch(source, /setMeals\(meals\)/);
  });
});
