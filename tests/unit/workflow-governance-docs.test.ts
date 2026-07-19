import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const governancePath = "docs/workflow/runtime-governance.md";
const planningProofPath = "docs/workflow/planning-proof.md";
const gitignorePath = ".gitignore";
const stateCheckPath = "scripts/workflow/state-check.mjs";

describe("workflow runtime governance docs", () => {
  it("keeps lease, provenance, receipts, and seals behind the non-authorizing boundary", async () => {
    const governance = await readFile(governancePath, "utf8");
    for (const claim of [
      "not authority to run GSD",
      "never point them at this checkout's `.planning/**` without a separate current-thread approval",
      "private bearer token and Ed25519 private key must be in a canonical physical absolute path outside both the checkout and Git common directory",
      "single-link `0600` regular file",
      "governance directory itself must remain current-user-owned mode `0700`",
      "`.planning/config.json` is never a writer-identity source",
      "requires both signatures",
      "approved source SHA to equal the real checkout `HEAD`",
      "status: needs_reconciliation",
      "caller-generated `--run-id`",
      "independently expected run ID, outcome, before/after workspace digests",
      "None of these controls authorizes GSD resume",
    ]) {
      assert.ok(governance.includes(claim), `missing governance boundary: ${claim}`);
    }
    assert.match(governance, /TAKEOVER:<lease-id>:<lease-digest>:<reason-code>/);
    assert.match(governance, /runtime_handoff.*only while the predecessor lease is live/s);
    assert.match(
      governance,
      /Expired `abandoned_session` and `operator_recovery` takeover is currently blocked.*lease_operator_takeover_durable_authority_unavailable/s,
    );
    assert.match(governance, /RECOVER_MUTEX:<operation-id>:<operation-digest>:<reason-code>/);
    assert.match(governance, /RECOVER_WRITER:<fence-id>:<fence-digest>:<reason-code>/);
  });

  it("keeps planning-proof source exceptions exact and binds state checks to project root", async () => {
    const planningProof = await readFile(planningProofPath, "utf8");
    assert.match(planningProof, /Both `gsd-planner` and `gsd-plan-checker` must bind exactly/);
    assert.match(planningProof, /\.codex\/skills\/nutrition-planning-proof/);

    const ignoreLines = (await readFile(gitignorePath, "utf8")).split(/\r?\n/);
    assert.equal(ignoreLines.filter((line) => line === "!.codex/skills/nutrition-planning-proof/").length, 1);
    assert.equal(ignoreLines.filter((line) => line === "!.codex/skills/nutrition-planning-proof/SKILL.md").length, 1);
    assert.equal(ignoreLines.filter((line) => line === "!.claude/CLAUDE.md").length, 1);
    assert.equal(ignoreLines.filter((line) => line === ".planning/").length, 1);

    const stateCheck = await readFile(stateCheckPath, "utf8");
    assert.match(stateCheck, /arg\.startsWith\("--project-root="\)/);
    assert.doesNotMatch(stateCheck, /--planning-root/);
    assert.match(stateCheck, /path\.join\(path\.resolve\(projectRoot\), "\.planning"\)/);
  });
});
