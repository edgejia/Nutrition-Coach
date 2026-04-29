process.env.TZ = "Asia/Taipei";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInsightTraceArtifact, summarizeToolCallArgs } from "../harness/llm-trace.js";
import { writeScenarioArtifacts } from "../harness/artifacts.js";
import type { ScenarioResult } from "../harness/scenario-types.js";

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function failingTrace() {
  return buildInsightTraceArtifact({
    scenario: "insight-trace-redaction",
    status: "fail",
    inputSummary: {
      fixture: "weekly-basic",
      deviceId: "secret-device-30",
      rawPrompt: "raw prompt text should not persist",
    },
    llmRounds: [
      {
        role: "assistant",
        messages: ["raw prompt text should not persist"],
        stack: "Error: stack should not persist",
      },
    ],
    toolCalls: [
      {
        name: "get_history",
        args: {
          from: "2026-04-20",
          to: "2026-04-26",
          deviceId: "secret-device-30",
          apiKey: "sk-test-secret",
          schema: { full: "internal schema should not persist" },
        },
      },
    ],
    deterministicMetrics: { totals: { calories: 2130 }, averages: { protein: 17.6 } },
    finalAnswer: "這週共有 2130 大卡。",
    assertions: [{ name: "numeric_grounding", ok: true }],
  });
}

describe("insight trace artifacts", () => {
  test("buildInsightTraceArtifact writes concise pass traces", () => {
    const trace = buildInsightTraceArtifact({
      scenario: "weekly-basic",
      status: "pass",
      inputSummary: { fixture: "weekly-basic" },
      llmRounds: [{ round: 1, messages: ["hidden"] }],
      toolCalls: [{ name: "get_history", args: { from: "2026-04-20", calories: 2130 } }],
      deterministicMetrics: { from: "2026-04-20", to: "2026-04-26", totals: { calories: 2130 } },
      finalAnswer: "本週共 2130 大卡。",
      assertions: [{ name: "numeric_grounding", ok: true }],
    });

    assert.equal(trace.scenario, "weekly-basic");
    assert.equal(trace.status, "pass");
    assert.equal(trace.finalAnswer, "本週共 2130 大卡。");
    assert.equal(trace.llmRoundCount, 1);
    assert.ok(!("llmRounds" in trace));
    assert.match(stringify(trace), /deterministicMetrics/);
    assert.match(stringify(trace), /assertions/);
  });

  test("buildInsightTraceArtifact writes detailed redacted failure traces", () => {
    const trace = failingTrace();
    const raw = stringify(trace);
    assert.equal(trace.status, "fail");
    assert.ok("llmRounds" in trace);
    assert.doesNotMatch(raw, /secret-device-30/);
    assert.doesNotMatch(raw, /sk-test-secret/);
    assert.doesNotMatch(raw, /raw prompt text should not persist/);
    assert.doesNotMatch(raw, /Error: stack should not persist/);
    assert.doesNotMatch(raw, /internal schema should not persist/);
  });

  test("summarizeToolCallArgs omits raw prompt device and schema data", () => {
    const summary = summarizeToolCallArgs({
      from: "2026-04-20",
      to: "2026-04-26",
      calories: 2130,
      deviceId: "secret-device",
      nested: { rawPrompt: "raw prompt", schema: { properties: ["secret"] } },
    });
    const raw = stringify(summary);
    assert.deepEqual(summary.keys, ["calories", "from", "nested", "to"]);
    assert.doesNotMatch(raw, /secret-device/);
    assert.doesNotMatch(raw, /raw prompt/);
    assert.doesNotMatch(raw, /schema/);
  });

  describe("artifact writer integration", () => {
    let tmpDir: string;
    const originalEnv = process.env.HARNESS_ARTIFACTS_DIR;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "insight-trace-"));
      process.env.HARNESS_ARTIFACTS_DIR = tmpDir;
    });

    after(() => {
      if (originalEnv === undefined) {
        delete process.env.HARNESS_ARTIFACTS_DIR;
      } else {
        process.env.HARNESS_ARTIFACTS_DIR = originalEnv;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("writeScenarioArtifacts persists insight traces without sensitive fields", async () => {
      const result: ScenarioResult = {
        ok: false,
        failedStep: "trace_redaction",
        steps: [{ name: "trace_redaction", ok: false, actual: failingTrace() }],
        artifacts: { trace: failingTrace() },
        consoleSummary: "FAIL insight-trace-redaction trace_redaction",
      };
      await writeScenarioArtifacts("insight-trace-redaction", result);

      const latest = path.join(tmpDir, "insight-trace-redaction", "latest");
      const raw = fs.readFileSync(path.join(latest, "snapshots.json"), "utf-8");
      assert.doesNotMatch(raw, /secret-device-30/);
      assert.doesNotMatch(raw, /sk-test-secret/);
      assert.doesNotMatch(raw, /raw prompt text should not persist/);
      assert.doesNotMatch(raw, /Error: stack should not persist/);
      assert.match(raw, /deterministicMetrics/);
      assert.match(raw, /finalAnswer/);
      assert.match(raw, /assertions/);
    });
  });
});
