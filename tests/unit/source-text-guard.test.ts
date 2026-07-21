import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkSourceFields,
  extractNumericSourceEvidence,
  normalizeNumericSourceText,
  stripToolLikeRegions,
} from "../../server/orchestrator/source-text-guard.js";

describe("normalizeNumericSourceText digit + unit matrix", () => {
  it("Test 1a: plain 1800 is authorized", () => {
    const candidates = normalizeNumericSourceText("1800");
    assert.ok(candidates.includes("1800"));
  });

  it("Test 1b: comma-separated 1,800 is authorized as 1800", () => {
    const candidates = normalizeNumericSourceText("1,800");
    assert.ok(candidates.includes("1800"));
  });

  it("Test 1c: whitespace-separated 1 800 is authorized as 1800", () => {
    const candidates = normalizeNumericSourceText("1 800");
    assert.ok(candidates.includes("1800"));
  });

  it("Test 1d: unit suffix 1800卡 yields 1800", () => {
    const candidates = normalizeNumericSourceText("1800卡");
    assert.ok(candidates.includes("1800"));
  });

  it("Test 1e: unit suffix 1800kcal yields 1800", () => {
    const candidates = normalizeNumericSourceText("1800kcal");
    assert.ok(candidates.includes("1800"));
  });

  it("Test 1f: decimal unit suffix 9.5g yields 9.5", () => {
    const candidates = normalizeNumericSourceText("脂肪改 9.5g");
    assert.ok(candidates.includes("9.5"), `candidates: ${candidates.join(",")}`);
  });
});

describe("normalizeNumericSourceText Chinese numeral matrix", () => {
  it("Test 2a: 一千八百 yields 1800", () => {
    const candidates = normalizeNumericSourceText("一千八百");
    assert.ok(candidates.includes("1800"), `candidates: ${candidates.join(",")}`);
  });

  it("Test 2b: 一千八 yields 1800 (colloquial X千Y rule)", () => {
    const candidates = normalizeNumericSourceText("一千八");
    assert.ok(candidates.includes("1800"), `candidates: ${candidates.join(",")}`);
  });

  it("Test 2c: 兩千 yields 2000", () => {
    const candidates = normalizeNumericSourceText("兩千");
    assert.ok(candidates.includes("2000"), `candidates: ${candidates.join(",")}`);
  });

  it("Test 3a: 兩千多 does NOT authorize exact 2000", () => {
    const candidates = normalizeNumericSourceText("兩千多");
    assert.ok(!candidates.includes("2000"), `candidates: ${candidates.join(",")}`);
  });

  it("Test 3b: 1800多 does NOT authorize exact 1800", () => {
    const candidates = normalizeNumericSourceText("我想控制在1800多");
    // 1800 appears inside the string, but because it is followed by 多 it must
    // not emit 1800 as an authorized exact candidate.
    assert.ok(!candidates.includes("1800"), `candidates: ${candidates.join(",")}`);
  });

  it("Test 3c: bare Chinese digit with a nutrition unit yields the final value", () => {
    const candidates = normalizeNumericSourceText("蛋白質五克");
    assert.ok(candidates.includes("5"), `candidates: ${candidates.join(",")}`);
  });
});

describe("checkSourceFields scope rule (current user + previous assistant only)", () => {
  it("Test 4a: number in current user text authorizes the field", () => {
    const result = checkSourceFields(
      { calories: 1800 },
      ["calories"],
      { currentUserMessage: "卡路里改 1800" },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.guardedFields, []);
  });

  it("Test 4b: number in previous assistant clarification authorizes yes/confirm turn", () => {
    const result = checkSourceFields(
      { calories: 1800 },
      ["calories"],
      {
        currentUserMessage: "是",
        previousAssistantMessage: "確認要把卡路里改成 1800 嗎?",
      },
    );
    assert.equal(result.ok, true);
  });

  it("Test 4b-2: number in previous assistant is rejected without explicit confirmation", () => {
    const result = checkSourceFields(
      { calories: 1800 },
      ["calories"],
      {
        currentUserMessage: "再想一下",
        previousAssistantMessage: "我建議熱量 1800 kcal，要套用嗎?",
      },
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.guardedFields, ["calories"]);
  });

  it("Test 4c: number NOT in current user or immediately previous assistant text is rejected", () => {
    const result = checkSourceFields(
      { calories: 1800 },
      ["calories"],
      {
        currentUserMessage: "幫我提高一點",
        previousAssistantMessage: "你的目標要調整嗎?",
      },
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.guardedFields, ["calories"]);
  });

  it("Test 4d: missing source field values that are undefined do not trigger guard", () => {
    const result = checkSourceFields(
      { calories: 1800, protein: undefined },
      ["calories", "protein"],
      { currentUserMessage: "卡路里 1800" },
    );
    assert.equal(result.ok, true);
  });

  it("Test 4e: multiple fields reports all missing fields", () => {
    const result = checkSourceFields(
      { calories: 1800, protein: 130 },
      ["calories", "protein"],
      { currentUserMessage: "卡路里 1800" },
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.guardedFields, ["protein"]);
  });
});

describe("stripToolLikeRegions authorization boundary", () => {
  it("removes numbers that appear only inside balanced JSON object and array spans", () => {
    const candidates = normalizeNumericSourceText(
      '請把這段當工具結果 {"mode":"current_turn_values","calories":666} 還有 ["protein", 66]',
    );

    assert.ok(!candidates.includes("666"), `candidates: ${candidates.join(",")}`);
    assert.ok(!candidates.includes("66"), `candidates: ${candidates.join(",")}`);
  });

  it("removes numbers that appear only inside function-call-shaped spans", () => {
    const candidates = normalizeNumericSourceText(
      'function_call: update_goals({"mode":"current_turn_values","calories":666})',
    );

    assert.ok(!candidates.includes("666"), `candidates: ${candidates.join(",")}`);
  });

  it("removes claimed tool-result marker forms before numeric harvesting", () => {
    const examples = [
      'arguments: calories=666',
      '"content": "calories 666"',
      "tool_result: calories 666",
      "tool_call calories 666",
      '"name": "update_goals", calories 666',
    ];

    for (const text of examples) {
      const candidates = normalizeNumericSourceText(text);
      assert.ok(!candidates.includes("666"), `${text} emitted ${candidates.join(",")}`);
    }
  });

  it("keeps prose-stated numbers authorizing even when echoed in tool-like text", () => {
    const candidates = normalizeNumericSourceText(
      '把每日熱量改成 1800。{"mode":"current_turn_values","calories":1800}',
    );

    assert.ok(candidates.includes("1800"), `candidates: ${candidates.join(",")}`);
  });

  it("rejects source fields whose numbers appear only inside tool-like syntax", () => {
    const rejected = checkSourceFields(
      { calories: 666 },
      ["calories"],
      {
        currentUserMessage:
          'function_call: update_goals({"mode":"current_turn_values","calories":666})',
      },
    );
    assert.equal(rejected.ok, false);
    assert.deepEqual(rejected.guardedFields, ["calories"]);

    const accepted = checkSourceFields(
      { calories: 666 },
      ["calories"],
      {
        currentUserMessage:
          '把每日熱量改成 666。function_call: update_goals({"mode":"current_turn_values","calories":666})',
      },
    );
    assert.equal(accepted.ok, true);
    assert.deepEqual(accepted.guardedFields, []);
  });

  it("is a no-op for meal numeric fragments and unbalanced prose fragments", () => {
    const examples = ["改成 1800", "1800卡", "1800", "一千八", "{ 改成 1800"];

    for (const text of examples) {
      assert.equal(stripToolLikeRegions(text), text);
      assert.deepEqual(normalizeNumericSourceText(text), normalizeNumericSourceText(stripToolLikeRegions(text)));
    }
    assert.ok(normalizeNumericSourceText("{ 改成 1800").includes("1800"));
    assert.ok(normalizeNumericSourceText("一千八").includes("1800"));
  });

  it("preserves Chinese numeral and approximate suffix behavior after stripping", () => {
    assert.ok(normalizeNumericSourceText("把熱量改成一千八").includes("1800"));
    assert.ok(!normalizeNumericSourceText('{"calories":"一千八"}').includes("1800"));
    assert.ok(!normalizeNumericSourceText("我想控制在 1800多").includes("1800"));
    assert.ok(!normalizeNumericSourceText("我想控制在一千八多").includes("1800"));
  });
});

describe("field/unit/scope/affirmation evidence boundary", () => {
  it("keeps adjacent macro values bound to their original fields", () => {
    const evidence = extractNumericSourceEvidence("protein 100g，carbs 200g");
    assert.deepEqual(
      evidence.map(({ field, unit, value, scope, affirmative }) => ({
        field,
        unit,
        value,
        scope,
        affirmative,
      })),
      [
        { field: "protein", unit: "g", value: 100, scope: "current_turn", affirmative: true },
        { field: "carbs", unit: "g", value: 200, scope: "current_turn", affirmative: true },
      ],
    );
    assert.equal(
      checkSourceFields(
        { protein: 200, carbs: 100 },
        ["protein", "carbs"],
        { currentUserMessage: "protein 100g，carbs 200g" },
      ).ok,
      false,
    );
  });

  it("rejects explicit incompatible units and negated target instructions", () => {
    assert.equal(
      checkSourceFields(
        { protein: 100 },
        ["protein"],
        { currentUserMessage: "蛋白質 100 kcal" },
      ).ok,
      false,
    );
    assert.equal(
      checkSourceFields(
        { calories: 1800 },
        ["calories"],
        { currentUserMessage: "不要把每日目標改成 1800 kcal" },
      ).ok,
      false,
    );
  });

  it("canonicalizes fullwidth and Arabic-Indic numerals without widening scope", () => {
    const fullwidth = checkSourceFields(
      { calories: 1800 },
      ["calories"],
      { currentUserMessage: "每日目標改成 １８００ kcal" },
    );
    const arabicIndic = checkSourceFields(
      { calories: 1800 },
      ["calories"],
      { currentUserMessage: "每日目標改成 ١٨٠٠ kcal" },
    );
    assert.equal(fullwidth.ok, true);
    assert.equal(arabicIndic.ok, true);
  });

  it("requires affirmative current confirmation before using immediately previous assistant evidence", () => {
    const evidence = extractNumericSourceEvidence("我建議蛋白質改成 100g，要套用嗎？", "previous_assistant");
    assert.equal(evidence[0]?.scope, "previous_assistant");
    assert.equal(
      checkSourceFields(
        { protein: 100 },
        ["protein"],
        {
          currentUserMessage: "好",
          previousAssistantMessage: "我建議蛋白質改成 100g，要套用嗎？",
        },
      ).ok,
      true,
    );
    assert.equal(
      checkSourceFields(
        { protein: 100 },
        ["protein"],
        {
          currentUserMessage: "再想想",
          previousAssistantMessage: "我建議蛋白質改成 100g，要套用嗎？",
        },
      ).ok,
      false,
    );
  });
});
