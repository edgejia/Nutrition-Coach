import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const STRICT_SCAN_FILES = [
  "tests/harness/behavior-matrix.ts",
  "tests/harness/behavior-assertions.ts",
  "server/orchestrator/llm-trace.ts",
] as const;

async function readSource(path: string) {
  return readFile(path, "utf8");
}

describe("behavior matrix source scanner", () => {
  it("keeps strict source files present", async () => {
    for (const file of STRICT_SCAN_FILES) {
      await assert.doesNotReject(readSource(file), `${file} must exist in behavior matrix source scan`);
    }
  });

  it("anchors behavior matrix source tokens", async () => {
    const source = await readSource("tests/harness/behavior-matrix.ts");

    for (const token of [
      "export const ALL_BEHAVIOR_CASES",
      "BehaviorCaseId",
      "BehaviorRisk",
      "BehaviorAssertionName",
      "CASE-08",
      "CASE-13",
      "untrusted_tool_authority",
      "trace_final_reply_source",
    ]) {
      assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing source token ${token}`);
    }
  });

  it("anchors assertion and trace sources used by matrix drift checks", async () => {
    const assertionSource = await readSource("tests/harness/behavior-assertions.ts");
    const traceSource = await readSource("server/orchestrator/llm-trace.ts");

    assert.match(assertionSource, /export function assertTraditionalChinese/);
    assert.match(assertionSource, /export function assertNoUnauthorizedMutation/);
    assert.match(assertionSource, /export function assertNoTrustedToolAuthority/);
    assert.match(assertionSource, /export function evaluateExpectedFailures/);
    assert.match(traceSource, /export type LlmTraceFinalReplySource/);
    assert.match(traceSource, /orchestrator_projected_reply/);
  });
});
