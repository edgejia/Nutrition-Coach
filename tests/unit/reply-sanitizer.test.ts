import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createStreamingSanitizer,
  getAmbiguousCounterSuffixLength,
  sanitizeReply,
  SENSITIVE_IDENTIFIER_REPLACEMENTS,
} from "../../server/lib/reply-sanitizer.js";

const COUNTER_TEXT_PATTERN = /[（(]\s*\d+\s*\/\s*\d+\s*[）)]/;
const PLANNING_IDENTIFIER_REPLACEMENTS = [
  ["plan_next_meal", "規劃下一餐"],
  ["planningFacts", "規劃依據"],
  ["remainingCalories", "剩餘熱量"],
  ["macroGap", "營養缺口"],
  ["coach_planning", "下一餐建議"],
  ["coach_compact", "營養建議"],
] as const;

const PHASE_107_IDENTIFIER_REPLACEMENTS = [
  ["find_meals", "查詢餐點"],
  ["update_meal", "更新餐點"],
  ["delete_meal", "刪除餐點"],
  ["update_goals", "更新目標"],
  ["propose_goals", "建議目標"],
  ["propose_meal_numeric_correction", "建議餐點數值修正"],
  ["propose_meal_estimate", "建議餐點估算"],
  ["system-prompt.v3", "內部細節"],
  ["llm-trace.v2", "內部細節"],
  ["deviceId", "內部細節"],
  ["revision", "內部細節"],
  ["tool_call", "內部細節"],
  ["model_response", "內部細節"],
  ["providerRequestId", "內部細節"],
  ["errorName", "內部細節"],
  ["errorType", "內部細節"],
  ["errorCode", "內部細節"],
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitIdentifier(identifier: string): [string, string, string] {
  const firstCut = Math.max(1, Math.floor(identifier.length / 3));
  const secondCut = Math.max(firstCut + 1, Math.floor((identifier.length * 2) / 3));

  return [identifier.slice(0, firstCut), identifier.slice(firstCut, secondCut), identifier.slice(secondCut)];
}

describe("reply sanitizer", () => {
  it("removes complete nutrition counters with ASCII and full-width parentheses", () => {
    assert.equal(sanitizeReply("早餐 (1/3) 完成"), "早餐  完成");
    assert.equal(sanitizeReply("早餐 ( 1 / 3 ) 完成"), "早餐  完成");
    assert.equal(sanitizeReply("早餐 （1/3） 完成"), "早餐  完成");
    assert.equal(sanitizeReply("早餐 （ 1 / 3 ） 完成"), "早餐  完成");
  });

  it("holds ambiguous counter suffixes until the stream can sanitize or release them", () => {
    assert.equal(getAmbiguousCounterSuffixLength("今天("), 1);
    assert.equal(getAmbiguousCounterSuffixLength("今天(1"), 2);
    assert.equal(getAmbiguousCounterSuffixLength("今天(1/"), 3);
    assert.equal(getAmbiguousCounterSuffixLength("今天(1/3"), 4);
    assert.equal(getAmbiguousCounterSuffixLength("今天（ 12 / 30"), "（ 12 / 30".length);
    assert.equal(getAmbiguousCounterSuffixLength("今天(一"), 0);
  });

  it("does not expose adjacent split ASCII counters in any pushed chunk", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("今天"),
      sanitizer.push("(1"),
      sanitizer.push("/3)"),
      sanitizer.push("完成"),
      sanitizer.flush(),
    ];

    assert.deepEqual(emitted, ["今天", "", "", "完成", ""]);
    assert.equal(emitted.join(""), "今天完成");
    for (const chunk of emitted) {
      assert.doesNotMatch(chunk, COUNTER_TEXT_PATTERN);
      assert.doesNotMatch(chunk, /\(1|\/3\)/);
    }
  });

  it("does not expose adjacent split full-width counters in any pushed chunk", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("今天"),
      sanitizer.push("（2"),
      sanitizer.push("/4）"),
      sanitizer.push("完成"),
      sanitizer.flush(),
    ];

    assert.deepEqual(emitted, ["今天", "", "", "完成", ""]);
    assert.equal(emitted.join(""), "今天完成");
    for (const chunk of emitted) {
      assert.doesNotMatch(chunk, COUNTER_TEXT_PATTERN);
      assert.doesNotMatch(chunk, /（2|\/4）/);
    }
  });

  it("releases ordinary parentheses after they can no longer become counters", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("提示"),
      sanitizer.push("("),
      sanitizer.push("abc"),
      sanitizer.push(")"),
      sanitizer.flush(),
    ];

    assert.equal(emitted.join(""), "提示(abc)");
    for (const chunk of emitted) {
      assert.doesNotMatch(chunk, COUNTER_TEXT_PATTERN);
    }
  });

  it("flushes held tails through the finalized sanitizer without dropping ordinary text", () => {
    const counterSanitizer = createStreamingSanitizer();
    assert.equal(counterSanitizer.push("今天(1/3"), "今天");
    assert.equal(counterSanitizer.flush(), "(1/3");

    const ordinarySanitizer = createStreamingSanitizer();
    assert.equal(ordinarySanitizer.push("請看("), "請看");
    assert.equal(ordinarySanitizer.flush(), "(");
  });

  it("replaces Phase 102 planning internals with exact Traditional Chinese copy", () => {
    for (const [identifier, replacement] of PLANNING_IDENTIFIER_REPLACEMENTS) {
      const sanitized = sanitizeReply(`請依 ${identifier} 回答`);

      assert.equal(sanitized, `請依 ${replacement} 回答`);
      assert.doesNotMatch(sanitized, new RegExp(identifier));
    }
  });

  it("replaces all Phase 102 planning internals in a full reply", () => {
    const sanitized = sanitizeReply(
      "plan_next_meal used planningFacts: remainingCalories and macroGap for coach_planning / coach_compact.",
    );

    assert.equal(
      sanitized,
      "規劃下一餐 used 規劃依據: 剩餘熱量 and 營養缺口 for 下一餐建議 / 營養建議.",
    );
    for (const [identifier] of PLANNING_IDENTIFIER_REPLACEMENTS) {
      assert.doesNotMatch(sanitized, new RegExp(identifier));
    }
  });

  it("replaces audited Phase 107 identifiers with exact Traditional Chinese labels", () => {
    for (const [identifier, replacement] of PHASE_107_IDENTIFIER_REPLACEMENTS) {
      const sanitized = sanitizeReply(`請依 ${identifier} 回答`);

      assert.equal(sanitized, `請依 ${replacement} 回答`);
      assert.doesNotMatch(sanitized, new RegExp(escapeRegExp(identifier)));
    }
  });

  it("replaces audited identifiers regardless of casing in finalized replies", () => {
    assert.equal(
      sanitizeReply("LOG_FOOD / UPDATE_GOALS / ProviderRequestId / SYSTEM-PROMPT.V3"),
      "完成記錄 / 更新目標 / 內部細節 / 內部細節",
    );
  });

  it("preserves exact identifier boundaries while allowing punctuation-delimited matches", () => {
    assert.equal(sanitizeReply("prevision revisionist xsystem-prompt.v3y"), "prevision revisionist xsystem-prompt.v3y");
    assert.equal(sanitizeReply("請看 system-prompt.v3, ProviderRequestId。"), "請看 內部細節, 內部細節。");
  });

  it("matches dotted internal identifiers as exact literals only", () => {
    assert.equal(sanitizeReply("版本是 system-promptXv3"), "版本是 system-promptXv3");
    assert.equal(sanitizeReply("版本是 system-prompt.v3"), "版本是 內部細節");
    assert.equal(sanitizeReply("schema 是 llm-traceXv2"), "schema 是 llm-traceXv2");
    assert.equal(sanitizeReply("schema 是 llm-trace.v2"), "schema 是 內部細節");
  });

  it("does not expose representative split Phase 107 identifiers in streamed chunks", () => {
    const cases = [
      {
        chunks: ["先用 update_", "go", "als 看 "],
        expected: "先用 更新目標 看 ",
        fragments: /update_|goals|update_goals/,
      },
      {
        chunks: ["版本 system-", "prompt", ".v3 "],
        expected: "版本 內部細節 ",
        fragments: /system-|prompt|\.v3|system-prompt\.v3/,
      },
      {
        chunks: ["欄位 Provider", "Request", "Id "],
        expected: "欄位 內部細節 ",
        fragments: /Provider|Request|Id|providerRequestId/i,
      },
      {
        chunks: ["先用 UPDATE_", "GO", "ALS 看 "],
        expected: "先用 更新目標 看 ",
        fragments: /UPDATE_|GOALS|update_goals/i,
      },
    ] as const;

    for (const scenario of cases) {
      const sanitizer = createStreamingSanitizer();
      const emitted = [...scenario.chunks.map((chunk) => sanitizer.push(chunk)), sanitizer.flush()];

      assert.equal(emitted.join(""), scenario.expected);
      for (const chunk of emitted) {
        assert.doesNotMatch(chunk, scenario.fragments);
      }
    }
  });

  it("keeps finalized and streamed identifier coverage in parity", () => {
    for (const [identifier, replacement] of SENSITIVE_IDENTIFIER_REPLACEMENTS) {
      const escapedIdentifier = new RegExp(escapeRegExp(identifier), "i");
      const finalized = sanitizeReply(`比對 ${identifier.toLocaleUpperCase()} 完成`);

      assert.equal(finalized, `比對 ${replacement} 完成`);
      assert.doesNotMatch(finalized, escapedIdentifier);

      const [first, second, third] = splitIdentifier(identifier.toLocaleUpperCase());
      const sanitizer = createStreamingSanitizer();
      const emitted = [
        sanitizer.push(`比對 ${first}`),
        sanitizer.push(second),
        sanitizer.push(`${third} 完成`),
        sanitizer.flush(),
      ];

      assert.equal(emitted.join(""), `比對 ${replacement} 完成`);
      for (const chunk of emitted) {
        assert.doesNotMatch(chunk, escapedIdentifier);
      }
    }
  });

  it("does not expose split planning tool or field identifiers in streamed chunks", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("先用 plan_"),
      sanitizer.push("next_"),
      sanitizer.push("meal 看 "),
      sanitizer.push("remaining"),
      sanitizer.push("Calories"),
      sanitizer.push("。"),
      sanitizer.flush(),
    ];

    assert.equal(emitted.join(""), "先用 規劃下一餐 看 剩餘熱量。");
    for (const chunk of emitted) {
      assert.doesNotMatch(chunk, /plan_|next_|meal|remaining|Calories|plan_next_meal|remainingCalories/);
    }
  });

  it("keeps markdown table and bullet truncation out of the shared sanitizer", () => {
    const source = readFileSync("server/lib/reply-sanitizer.ts", "utf8");

    assert.doesNotMatch(source, /markdown|table|pipe table/i);
    assert.doesNotMatch(source, /bullet|MAX_COACH_REPLY_BULLETS|slice\(0,\s*5\)/);
    assert.equal(sanitizeReply("| A | B |\n|---|---|\n| 1 | 2 |"), "| A | B |\n|---|---|\n| 1 | 2 |");
  });
});
