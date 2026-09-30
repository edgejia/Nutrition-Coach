import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const planningSkillPath = ".codex/skills/nutrition-planning-proof/SKILL.md";
const productionRuntimePath = "docs/deploy/production-runtime.md";
const gitignorePath = ".gitignore";
const stateCheckPath = "scripts/workflow/state-check.mjs";
const packagePath = "package.json";

describe("workflow runtime governance docs", () => {
  it("keeps retired high-assurance episode controls out of the active package surface", async () => {
    const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts: Record<string, string> };
    for (const name of [
      "workflow:artifact-provenance",
      "workflow:closeout",
      "workflow:command-receipt",
      "workflow:lease",
      "workflow:normalize-gsd-host",
      "workflow:gsd-wiring",
      "workflow:plan-proof",
      "workflow:tree-fingerprint",
      "workflow:verification-seal",
    ]) {
      assert.equal(pkg.scripts[name], undefined, `${name} must not return to the active package surface`);
    }
    await assert.rejects(readFile("docs/workflow/runtime-governance.md", "utf8"), { code: "ENOENT" });
  });

  it("keeps only thin planning guidance and binds evidence checks to project root", async () => {
    const planningSkill = await readFile(planningSkillPath, "utf8");
    assert.match(planningSkill, /GSD owns plan structure/);
    await assert.rejects(readFile("docs/workflow/planning-proof.md", "utf8"), { code: "ENOENT" });

    const ignoreLines = (await readFile(gitignorePath, "utf8")).split(/\r?\n/);
    assert.equal(ignoreLines.filter((line) => line === "!.codex/skills/nutrition-planning-proof/").length, 1);
    assert.equal(ignoreLines.filter((line) => line === "!.codex/skills/nutrition-planning-proof/SKILL.md").length, 1);
    assert.equal(ignoreLines.filter((line) => line === "!.claude/CLAUDE.md").length, 1);
    assert.equal(ignoreLines.filter((line) => line === ".planning/").length, 1);

    const stateCheck = await readFile(stateCheckPath, "utf8");
    assert.match(stateCheck, /argv\[0\]\.startsWith\("--project-root="\)/);
    assert.doesNotMatch(stateCheck, /--planning-root/);
    assert.match(stateCheck, /path\.join\(requested, "\.planning"\)/);
  });

  it("keeps Railway retired and Cloudflare Tunnel as the active production path", async () => {
    const productionRuntime = await readFile(productionRuntimePath, "utf8");
    assert.match(productionRuntime, /Railway is retired/);
    assert.match(productionRuntime, /local production-mode Fastify server exposed through a Cloudflare Tunnel/);
    assert.doesNotMatch(productionRuntime, /while Railway is unavailable/);
  });
});
