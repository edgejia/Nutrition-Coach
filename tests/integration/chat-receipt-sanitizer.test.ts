import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function sourceWithoutComments(path: string) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

describe("chat receipt sanitizer integration boundary", () => {
  it("keeps direct orchestrator receipt egress behind the guarded wrapper", () => {
    const source = sourceWithoutComments("server/orchestrator/index.ts");

    assert.match(source, /renderGuardedMutationReceipt/);
    assert.match(source, /const renderReceipt = \(effects: MutationEffects\) =>\s*renderGuardedMutationReceipt/);
    assert.doesNotMatch(source, /renderCheckedMutationReceipt/);
    assert.doesNotMatch(source, /assertNoForbiddenReceiptTerms/);
    assert.equal(
      (source.match(/mutationReceiptText\s*=\s*renderReceipt\(mutationEffects\)/g) ?? []).length,
      4,
    );
  });

  it("does not leave a direct final-reply receipt fallback that can throw after commit", () => {
    const source = sourceWithoutComments("server/orchestrator/index.ts");

    assert.doesNotMatch(source, /renderCheckedMutationReceipt\(mutationEffects\)/);
    assert.match(source, /renderReceipt\(mutationEffects\)/);
  });
});
