import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  runContract,
  summarizeContractArgsForLog,
  type ToolContract,
  type RunContractContext,
} from "../../server/orchestrator/tool-contract.js";
import { FatalToolError } from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";

interface FakeGoalArgs {
  calories?: number;
  protein?: number;
}

const fakeGoalSchema = z
  .object({
    calories: z.number().int().positive().optional(),
    protein: z.number().int().positive().optional(),
  })
  .strict();

function makeFakeGoalContract(overrides: {
  execute?: ToolContract<FakeGoalArgs, { ok: true }>["execute"];
  sourceFields?: readonly (keyof FakeGoalArgs)[];
  logSummary?: (args: FakeGoalArgs) => Record<string, unknown>;
} = {}): ToolContract<FakeGoalArgs, { ok: true }> {
  return {
    name: "fake_goal",
    description: "fake goal updater",
    parameters: {
      type: "object",
      properties: {
        calories: { type: "number" },
        protein: { type: "number" },
      },
      additionalProperties: false,
    },
    zodSchema: fakeGoalSchema,
    sourceFields: overrides.sourceFields,
    logSummary:
      overrides.logSummary ??
      ((args) => ({ updatedFields: Object.keys(args) })),
    execute:
      overrides.execute ??
      (async () => ({ ok: true, result: { ok: true }, toolMessage: "done" })),
  };
}

function makeCall(args: unknown, name = "fake_goal", rawArgumentString?: string): ToolCall {
  return {
    id: "call_1",
    type: "function",
    function: {
      name,
      arguments: rawArgumentString ?? JSON.stringify(args),
    },
  };
}

function emptyContext(): RunContractContext {
  return {
    currentUserMessage: "",
    previousAssistantMessage: undefined,
  };
}

describe("runContract wrapper", () => {
  it("Test 1: invalid JSON returns validation failure with structured JSON result", async () => {
    const contract = makeFakeGoalContract();
    const call = makeCall(null, "fake_goal", "not-json");
    const res = await runContract(contract, call, emptyContext());
    assert.equal(res.success, false);
    assert.equal(res.executed, false);
    assert.equal(res.failureReason, "validation");
    const parsed = JSON.parse(res.result);
    assert.equal(parsed.failureReason, "validation");
    assert.equal(parsed.reason, "invalid_json");
  });

  it("Test 2: Zod invalid args return validation failure without calling execute", async () => {
    let executed = false;
    const contract = makeFakeGoalContract({
      execute: async () => {
        executed = true;
        return { ok: true, result: { ok: true }, toolMessage: "done" };
      },
    });
    // extra field triggers strict() refusal; calories as string also invalid
    const call = makeCall({ calories: "not-a-number" });
    const res = await runContract(contract, call, emptyContext());
    assert.equal(res.success, false);
    assert.equal(res.executed, false);
    assert.equal(res.failureReason, "validation");
    assert.equal(executed, false);
    const parsed = JSON.parse(res.result);
    assert.equal(parsed.failureReason, "validation");
    assert.ok(Array.isArray(parsed.fields));
  });

  it("Test 3: contract-thrown FatalToolError returns executed:false, failureReason:execute", async () => {
    const contract = makeFakeGoalContract({
      execute: async () => {
        throw new FatalToolError("db blew up");
      },
    });
    const call = makeCall({ calories: 1800 });
    const res = await runContract(contract, call, emptyContext());
    assert.equal(res.success, false);
    assert.equal(res.executed, false);
    assert.equal(res.failureReason, "execute");
    const parsed = JSON.parse(res.result);
    assert.equal(parsed.failureReason, "execute");
  });

  it("Test 4: unexpected non-FatalToolError throw rejects from runContract", async () => {
    const contract = makeFakeGoalContract({
      execute: async () => {
        throw new Error("network gone");
      },
    });
    const call = makeCall({ calories: 1800 });
    await assert.rejects(
      runContract(contract, call, emptyContext()),
      /network gone/,
    );
  });

  it("Test 5: success returns executed:true, success:true, contract result, redacted logSummary", async () => {
    const returnedResult = { ok: true as const };
    const contract = makeFakeGoalContract({
      execute: async () => ({
        ok: true,
        result: returnedResult,
        toolMessage: "已更新",
      }),
      logSummary: (args) => ({ updatedFields: Object.keys(args) }),
    });
    const call = makeCall({ calories: 1800, protein: 130 });
    const res = await runContract(contract, call, emptyContext());
    assert.equal(res.success, true);
    assert.equal(res.executed, true);
    assert.equal(res.result, "已更新");
    assert.deepEqual(res.contractResult, returnedResult);
    assert.deepEqual(res.logSummary, { updatedFields: ["calories", "protein"] });
    // the logSummary must not include raw numeric values
    const stringified = JSON.stringify(res.logSummary);
    assert.doesNotMatch(stringified, /1800/);
    assert.doesNotMatch(stringified, /130/);
  });

  it("Test 6: summarizeContractArgsForLog parses raw JSON and returns redacted logSummary without raw numbers", () => {
    const contract = makeFakeGoalContract({
      logSummary: (args) => ({ updatedFields: Object.keys(args) }),
    });
    const raw = JSON.stringify({ calories: 1800, protein: 130 });
    const summary = summarizeContractArgsForLog(contract, raw);
    const stringified = JSON.stringify(summary);
    // must not leak raw numeric target values
    assert.doesNotMatch(stringified, /1800/);
    assert.doesNotMatch(stringified, /130/);
    // when parse/validate fails, fall back to placeholder with no raw JSON
    const fallback = summarizeContractArgsForLog(contract, "not-json");
    assert.equal(typeof fallback, "string");
    assert.equal(fallback, "<fake_goal args>");
  });

  it("Test 7: source-field guard failure returns executed:false with failureReason: \"guard\" and guardedFields", async () => {
    let executed = false;
    const contract = makeFakeGoalContract({
      sourceFields: ["calories"],
      execute: async () => {
        executed = true;
        return { ok: true, result: { ok: true }, toolMessage: "done" };
      },
    });
    const call = makeCall({ calories: 1800 });
    const res = await runContract(contract, call, {
      currentUserMessage: "幫我提高一點",
      previousAssistantMessage: "要調整嗎?",
    });
    assert.equal(res.success, false);
    assert.equal(res.executed, false);
    assert.equal(res.failureReason, "guard");
    assert.equal(executed, false);
    const parsed = JSON.parse(res.result);
    assert.equal(parsed.reason, "source_text_guard");
    assert.equal(parsed.failureReason, "guard");
    assert.deepEqual(parsed.guardedFields, ["calories"]);
  });
});
