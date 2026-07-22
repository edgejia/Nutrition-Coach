import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const skillPath = ".codex/skills/nutrition-planning-proof/SKILL.md";
const contractPath = "docs/workflow/planning-proof.md";

describe("planning-proof artifact profile contract", () => {
  it("keeps quick plans on lint plus independent semantic checking", async () => {
    const [skill, contract] = await Promise.all([readFile(skillPath, "utf8"), readFile(contractPath, "utf8")]);

    for (const source of [skill, contract]) {
      assert.match(source, /GSD quick plans[^\n]*\.planning\/quick/);
      assert.match(source, /plan-proof-lint[\s\S]{0,180}independent semantic checker/i);
      assert.match(source, /artifact_type_not_supported/);
      assert.match(source, /does not make the current PLAN signed|Do not infer a signature/i);
    }
  });

  it("retains strict provenance only for explicitly selected supported phase artifacts", async () => {
    const [skill, contract] = await Promise.all([readFile(skillPath, "utf8"), readFile(contractPath, "utf8")]);

    for (const source of [skill, contract]) {
      assert.match(source, /Supported phase `\*-PLAN\.md`, `\*-SUMMARY\.md`, and `\*-VERIFICATION\.md`/);
      assert.match(source, /Only when explicitly selected/);
      assert.match(source, /active (?:lease-bound )?writer fence/);
      assert.match(source, /signed provenance/);
      assert.match(source, /separately signed committed receipt/);
    }

    const quickRow = contract.slice(contract.indexOf("| GSD quick plans"), contract.indexOf("| Supported phase"));
    assert.doesNotMatch(quickRow, /signed provenance|writer fence|receipt-backed required/i);
  });
});
