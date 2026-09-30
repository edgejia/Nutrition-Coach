import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { checkWorkflowState } from "../../scripts/workflow/state-check.mjs";

const fixtures: string[] = [];

function git(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createFixture() {
  const projectRoot = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "nutrition-planning-evidence-")),
  );
  fixtures.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, ".planning", "phases"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".planning", "STATE.md"), [
    "---",
    "gsd_state_version: 1.0",
    "status: planning",
    "progress:",
    "  total_phases: 0",
    "---",
    "",
    "## Current Position",
    "",
    "Phase: Not started (defining requirements)",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(projectRoot, ".planning", "ROADMAP.md"), "# Roadmap\n");
  fs.writeFileSync(path.join(projectRoot, ".planning", "phases", ".gitkeep"), "");
  fs.writeFileSync(path.join(projectRoot, "README.md"), "fixture\n");
  git(projectRoot, ["init", "--initial-branch=main"]);
  git(projectRoot, ["config", "user.name", "fixture"]);
  git(projectRoot, ["config", "user.email", "fixture@example.invalid"]);
  git(projectRoot, ["add", "README.md"]);
  git(projectRoot, ["commit", "-m", "fixture"]);
  return {
    projectRoot,
    planningRoot: path.join(projectRoot, ".planning"),
  };
}

function check(fixture: ReturnType<typeof createFixture>, testCheckpoint?: () => void) {
  return checkWorkflowState(fixture.planningRoot, {
    projectRoot: fixture.projectRoot,
    testCheckpoint: testCheckpoint ? () => testCheckpoint() : undefined,
  });
}

afterEach(() => {
  while (fixtures.length > 0) {
    fs.rmSync(fixtures.pop()!, { recursive: true, force: true });
  }
});

describe("planning evidence check", () => {
  it("accepts native no-active-phase state without reimplementing GSD semantics", () => {
    const fixture = createFixture();
    const result = check(fixture);

    assert.equal(result.status, "pass");
    assert.equal(result.kind, "planning_evidence_check");
    assert.match(result.sourceSha ?? "", /^[0-9a-f]{40}$/);
    assert.match(result.planningTreeSha256 ?? "", /^[0-9a-f]{64}$/);
  });

  it("allows canonical active artifacts and validates summary status", () => {
    const fixture = createFixture();
    const phaseRoot = path.join(fixture.planningRoot, "phases", "116-active");
    fs.rmSync(path.join(fixture.planningRoot, "phases", ".gitkeep"));
    fs.mkdirSync(path.join(phaseRoot, "attempts"), { recursive: true });
    fs.writeFileSync(path.join(phaseRoot, "116-01-PLAN.md"), "# Plan\n");
    fs.writeFileSync(path.join(phaseRoot, "116-01-SUMMARY.md"), "---\r\nstatus: complete\r\n---\r\n");
    fs.writeFileSync(path.join(phaseRoot, "116-VERIFICATION.md"), "# Verification\n");
    fs.writeFileSync(path.join(phaseRoot, "attempts", "draft.md"), "historical attempt\n");

    assert.equal(check(fixture).status, "pass");

    fs.writeFileSync(path.join(phaseRoot, "116-01-SUMMARY.md"), "---\nstatus: invented\n---\n");
    const invalid = check(fixture);
    assert.equal(invalid.status, "fail");
    assert.ok(invalid.errors.some((error) => error.code === "planning_evidence_summary_status_invalid"));
  });

  it("rejects unknown active-tree files and retired seals", () => {
    const rootEntry = createFixture();
    fs.writeFileSync(path.join(rootEntry.planningRoot, "phases", "README.md"), "rogue\n");
    assert.ok(
      check(rootEntry).errors.some((error) => error.code === "planning_evidence_unknown_phases_entry"),
    );

    const phaseEntry = createFixture();
    const phaseRoot = path.join(phaseEntry.planningRoot, "phases", "116-active");
    fs.rmSync(path.join(phaseEntry.planningRoot, "phases", ".gitkeep"));
    fs.mkdirSync(phaseRoot);
    fs.writeFileSync(path.join(phaseRoot, "116-SEAL.json"), "{}\n");
    assert.ok(
      check(phaseEntry).errors.some((error) => error.code === "planning_evidence_unknown_phase_entry"),
    );
  });

  it("rejects symlinked and hard-linked planning evidence", () => {
    const symlinked = createFixture();
    const external = path.join(symlinked.projectRoot, "external-state.md");
    fs.writeFileSync(external, "outside\n");
    fs.rmSync(path.join(symlinked.planningRoot, "STATE.md"));
    fs.symlinkSync(external, path.join(symlinked.planningRoot, "STATE.md"));
    assert.equal(check(symlinked).errors[0].code, "planning_evidence_tree_unsafe");

    const hardLinked = createFixture();
    const statePath = path.join(hardLinked.planningRoot, "STATE.md");
    fs.linkSync(statePath, path.join(hardLinked.projectRoot, "state-alias.md"));
    assert.equal(check(hardLinked).errors[0].code, "planning_evidence_tree_unsafe");
  });

  it("detects planning-tree and source-HEAD drift during the final readback", () => {
    const treeDrift = createFixture();
    const changedTree = check(treeDrift, () => {
      fs.appendFileSync(path.join(treeDrift.planningRoot, "STATE.md"), "changed\n");
    });
    assert.ok(changedTree.errors.some((error) => error.code === "planning_evidence_changed_during_check"));

    const headDrift = createFixture();
    const changedHead = check(headDrift, () => {
      fs.writeFileSync(path.join(headDrift.projectRoot, "HEAD-DRIFT.md"), "changed\n");
      git(headDrift.projectRoot, ["add", "HEAD-DRIFT.md"]);
      git(headDrift.projectRoot, ["commit", "-m", "drift"]);
    });
    assert.ok(changedHead.errors.some((error) => error.code === "planning_evidence_changed_during_check"));
  });

  it("uses a project-root-only deterministic CLI with no repair mode", () => {
    const fixture = createFixture();
    const script = path.resolve("scripts/workflow/state-check.mjs");
    const valid = spawnSync(process.execPath, [script, `--project-root=${fixture.projectRoot}`], {
      encoding: "utf8",
    });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).kind, "planning_evidence_check");

    const invalid = spawnSync(process.execPath, [script, `--planning-root=${fixture.planningRoot}`], {
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).errors[0].code, "usage_error");
    assert.doesNotMatch(fs.readFileSync(script, "utf8"), /--repair/);
  });
});
