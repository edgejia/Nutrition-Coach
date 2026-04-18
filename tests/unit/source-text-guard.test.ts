import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkSourceFields,
  normalizeNumericSourceText,
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
