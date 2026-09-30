import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const skillPath = ".codex/skills/nutrition-planning-proof/SKILL.md";

describe("planning guidance contract", () => {
  it("keeps project evidence selection inside native GSD planning", async () => {
    const skill = await readFile(skillPath, "utf8");

    assert.match(skill, /GSD owns plan structure, command review, semantic checking/);
    assert.match(skill, /guest-session\/upload\/SSE/);
    assert.match(skill, /SQLite\s+recovery/);
    assert.match(skill, /harness false-pass/);
    assert.match(skill, /zero-match\/skipped tests/);
    assert.match(skill, /artifact_type_not_supported/);
  });

  it("does not recreate local parser or wiring enforcement", async () => {
    const [skill, pkg] = await Promise.all([
      readFile(skillPath, "utf8"),
      readFile("package.json", "utf8").then((source) => JSON.parse(source) as { scripts: Record<string, string> }),
    ]);

    assert.equal(pkg.scripts["workflow:plan-proof"], undefined);
    assert.equal(pkg.scripts["workflow:gsd-wiring"], undefined);
    await assert.rejects(readFile("scripts/workflow/plan-proof-lint.mjs", "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile("scripts/workflow/gsd-wiring.mjs", "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile("docs/workflow/planning-proof.md", "utf8"), { code: "ENOENT" });
  });
});
