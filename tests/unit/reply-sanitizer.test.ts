import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createStreamingSanitizer,
  getAmbiguousCounterSuffixLength,
  sanitizeReply,
} from "../../server/lib/reply-sanitizer.js";

const COUNTER_TEXT_PATTERN = /[（(]\s*\d+\s*\/\s*\d+\s*[）)]/;

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

    assert.deepEqual(emitted, ["提示", "", "(abc", ")", ""]);
    assert.equal(emitted.join(""), "提示(abc)");
  });

  it("flushes held tails through the finalized sanitizer without dropping ordinary text", () => {
    const counterSanitizer = createStreamingSanitizer();
    assert.equal(counterSanitizer.push("今天(1/3"), "今天");
    assert.equal(counterSanitizer.flush(), "");

    const ordinarySanitizer = createStreamingSanitizer();
    assert.equal(ordinarySanitizer.push("請看("), "請看");
    assert.equal(ordinarySanitizer.flush(), "(");
  });
});
