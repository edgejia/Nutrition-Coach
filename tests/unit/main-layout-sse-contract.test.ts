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
    assert.match(source, /const applyManualHomeRefresh = useStore\(\(s\) => s\.applyManualHomeRefresh\)/);
    assert.match(source, /const applyMealMutationRefresh = useStore\(\(s\) => s\.applyMealMutationRefresh\)/);
    assert.match(source, /recordMealMutation,/);
    assert.match(source, /applyMealMutationRefresh,/);
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

    const rolloverStart = source.indexOf("const refreshForRollover = useCallback");
    const rolloverEnd = source.indexOf("const refreshHomeManually = useCallback", rolloverStart);
    assert.ok(rolloverStart >= 0 && rolloverEnd > rolloverStart);
    const rolloverSource = source.slice(rolloverStart, rolloverEnd);
    assert.match(
      rolloverSource,
      /const committed = await sseSummaryCoordinator\.runInitialMealsLoad\(\{ refreshReason: "day_rollover" \}\);/,
    );
    assert.match(rolloverSource, /if \(!committed\) \{\s*throw new Error\("ROLLOVER_REFRESH_FAILED"\);/);

    const initialEffectStart = source.indexOf("useEffect(() => {\n    if (!deviceId) return;\n    void sseSummaryCoordinator.runInitialMealsLoad();");
    assert.ok(initialEffectStart >= 0);
    assert.doesNotMatch(rolloverSource, /setMeals|setDailySummary|onDailySummaryEnvelope/);
    const sourceWithoutManualHomeRefresh = source.replace(
      /const refreshHomeManually = useCallback\(async \(\) => \{[\s\S]*?\}, \[applyManualHomeRefresh, deviceId, recoverGuestSession\]\);/,
      "",
    );
    assert.match(source, /getMeals\(\{ refreshReason: "manual_refresh" \}\)[\s\S]*applyManualHomeRefresh\(meals\)/);
    assert.doesNotMatch(sourceWithoutManualHomeRefresh, /\.then\(\(\{ meals \}\) => setMeals\(meals\)\)/);
    assert.doesNotMatch(sourceWithoutManualHomeRefresh, /setMeals\(meals\)/);
  });
});
