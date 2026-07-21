import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkWorkflowState } from "../../scripts/workflow/state-check.mjs";

const fixtureRoot = fileURLToPath(new URL("../fixtures/workflow/state/", import.meta.url));
const tempDirs = new Set<string>();

async function copyState(name: "consistent" | "known-drift" = "consistent") {
  const container = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-state-check-")));
  tempDirs.add(container);
  const projectRoot = path.join(container, "project");
  const planningRoot = path.join(projectRoot, ".planning");
  await fs.mkdir(projectRoot);
  await fs.cp(path.join(fixtureRoot, name), planningRoot, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "State Test"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "state@example.invalid"], { cwd: projectRoot });
  execFileSync("git", ["add", "."], { cwd: projectRoot });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: projectRoot });
  return { container, projectRoot, planningRoot };
}

afterEach(async () => {
  for (const root of tempDirs) await fs.rm(root, { recursive: true, force: true });
  tempDirs.clear();
});

describe("workflow state invariant checker", () => {
  it("rejects the minimized frozen Phase 115 drift family", async () => {
    const fixture = await copyState("known-drift");
    const result = checkWorkflowState(fixture.planningRoot);
    assert.equal(result.status, "fail");
    const codes = new Set(result.errors.map((error: { code: string }) => error.code));
    assert.ok(codes.has("state_internal_plan_count_mismatch"));
    assert.ok(codes.has("roadmap_summary_completion_mismatch"));
    assert.ok(codes.has("roadmap_progress_mismatch"));
    assert.ok(codes.has("state_completed_plan_count_mismatch"));
    assert.ok(result.metrics);
    assert.equal(result.metrics.completedPlans, 2);
  });

  it("passes consistent canonical state and ignores hypothetical phase prose", async () => {
    const fixture = await copyState();
    const result = checkWorkflowState(fixture.planningRoot);
    assert.equal(result.status, "pass");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.metrics, { phases: 2, completedPhases: 1, plans: 5, completedPlans: 2, currentPhase: "115" });
    assert.match(result.sourceSha, /^[0-9a-f]{40}$/);
    assert.match(result.planningTreeSha256, /^[0-9a-f]{64}$/);
  });

  it("rejects completed-phase drift and a missing canonical Progress section", async () => {
    const { planningRoot: root } = await copyState();
    const statePath = path.join(root, "STATE.md");
    const roadmapPath = path.join(root, "ROADMAP.md");
    await fs.writeFile(statePath, (await fs.readFile(statePath, "utf8")).replace("completed_phases: 1", "completed_phases: 999"));
    await fs.writeFile(roadmapPath, (await fs.readFile(roadmapPath, "utf8")).replace(/\n## Progress[\s\S]*$/, "\n"));

    const result = checkWorkflowState(root);
    const codes = new Set(result.errors.map((error: { code: string }) => error.code));
    assert.ok(codes.has("state_completed_phase_count_mismatch"));
    assert.ok(codes.has("roadmap_progress_missing"));
    assert.ok(result.metrics);
    assert.equal(result.metrics.completedPhases, 1);
  });

  it("binds a roadmap Plans fraction numerator to completed summaries", async () => {
    const mismatch = await copyState();
    const mismatchPath = path.join(mismatch.planningRoot, "ROADMAP.md");
    await fs.writeFile(
      mismatchPath,
      (await fs.readFile(mismatchPath, "utf8")).replace("1/1 plans executed", "0/1 plans executed"),
    );
    assert.ok(
      checkWorkflowState(mismatch.planningRoot).errors.some(
        (error: { code: string }) => error.code === "roadmap_declared_completed_plan_count_mismatch",
      ),
    );

    const outOfRange = await copyState();
    const outOfRangePath = path.join(outOfRange.planningRoot, "ROADMAP.md");
    await fs.writeFile(
      outOfRangePath,
      (await fs.readFile(outOfRangePath, "utf8")).replace("1/1 plans executed", "999/1 plans executed"),
    );
    assert.ok(
      checkWorkflowState(outOfRange.planningRoot).errors.some(
        (error: { code: string }) => error.code === "roadmap_declared_completed_plan_count_invalid",
      ),
    );
  });

  it("fails closed on duplicate roadmap, progress, plan, and disk phase identities", async () => {
    const { planningRoot: root } = await copyState();
    const roadmapPath = path.join(root, "ROADMAP.md");
    let roadmap = await fs.readFile(roadmapPath, "utf8");
    roadmap = roadmap.replace("- [ ] 115-01-PLAN.md", "- [ ] 115-01-PLAN.md\n- [ ] 115-01-PLAN.md");
    roadmap = roadmap.replace("## Progress", "### Phase 115: Duplicate\n\n**Plans**: 4 plans\n\n## Progress");
    roadmap = roadmap.replace(
      "| 115. Active | 1/4 | In progress | - |",
      "| 115. Active | 1/4 | In progress | - |\n| 115. Duplicate | 1/4 | In progress | - |",
    );
    await fs.writeFile(roadmapPath, roadmap);
    await fs.cp(path.join(root, "phases/115-active"), path.join(root, "phases/115-duplicate"), { recursive: true });

    const codes = new Set(checkWorkflowState(root).errors.map((error: { code: string }) => error.code));
    assert.ok(codes.has("roadmap_duplicate_phase_identity"));
    assert.ok(codes.has("roadmap_duplicate_plan_identity"));
    assert.ok(codes.has("roadmap_duplicate_progress_identity"));
    assert.ok(codes.has("disk_duplicate_phase_identity"));
  });

  it("rejects duplicate canonical frontmatter keys and sections instead of last-value-wins parsing", async () => {
    const stateFixture = await copyState();
    const statePath = path.join(stateFixture.planningRoot, "STATE.md");
    let state = await fs.readFile(statePath, "utf8");
    state = state
      .replace("current_phase: 115", "current_phase: 115\ncurrent_phase: 999")
      .replace("  total_plans: 5", "  total_plans: 5\n  total_plans: 999")
      .replace("## Session Continuity", "## Current Position\n\nPlan: 999 plans ready\n\n## Session Continuity");
    await fs.writeFile(statePath, state);
    const stateCodes = new Set(checkWorkflowState(stateFixture.planningRoot).errors.map((error: { code: string }) => error.code));
    assert.ok(stateCodes.has("state_frontmatter_duplicate_key"));
    assert.ok(stateCodes.has("state_duplicate_current_position_section"));

    const roadmapFixture = await copyState();
    const roadmapPath = path.join(roadmapFixture.planningRoot, "ROADMAP.md");
    const roadmap = await fs.readFile(roadmapPath, "utf8");
    await fs.writeFile(roadmapPath, `${roadmap}\n## Progress\n\n| 115. Duplicate | 1/4 | In progress |\n`);
    const roadmapCodes = new Set(checkWorkflowState(roadmapFixture.planningRoot).errors.map((error: { code: string }) => error.code));
    assert.ok(roadmapCodes.has("roadmap_duplicate_progress_section"));

    const summaryFixture = await copyState();
    const summaryPath = path.join(summaryFixture.planningRoot, "phases/114-complete/114-01-SUMMARY.md");
    const summary = await fs.readFile(summaryPath, "utf8");
    await fs.writeFile(summaryPath, summary.replace("status: complete", "status: complete\nstatus: pending"));
    const summaryCodes = new Set(checkWorkflowState(summaryFixture.planningRoot).errors.map((error: { code: string }) => error.code));
    assert.ok(summaryCodes.has("summary_frontmatter_duplicate_key"));
  });

  it("rejects a summary whose completion status is absent or outside the closed status vocabulary", async () => {
    const fixture = await copyState();
    const summaryPath = path.join(fixture.planningRoot, "phases/114-complete/114-01-SUMMARY.md");
    const summary = await fs.readFile(summaryPath, "utf8");
    await fs.writeFile(summaryPath, summary.replace("status: complete", "result: complete"));

    const codes = new Set(checkWorkflowState(fixture.planningRoot).errors.map((error: { code: string }) => error.code));
    assert.ok(codes.has("summary_status_invalid"));
    assert.ok(codes.has("roadmap_summary_completion_mismatch"));

    await fs.writeFile(summaryPath, summary.replace("status: complete", "status: \"complete'"));
    const quotedCodes = new Set(
      checkWorkflowState(fixture.planningRoot).errors.map((error: { code: string }) => error.code),
    );
    assert.ok(quotedCodes.has("summary_frontmatter_invalid"));
    assert.ok(quotedCodes.has("summary_status_invalid"));
  });

  it("rejects contradictory canonical routing fields, duplicate body facts, and progress status", async () => {
    const routingFixture = await copyState();
    const statePath = path.join(routingFixture.planningRoot, "STATE.md");
    let state = await fs.readFile(statePath, "utf8");
    state = state
      .replace("current_phase_name: Active", "current_phase_name: Wrong phase")
      .replace("status: executing", "status: complete")
      .replace("stopped_at: Phase 115 planning complete — 4 plans ready", "stopped_at: Phase 999 wrong")
      .replace("  percent: 40", "  percent: 99")
      .replace("Phase: 115 — Active", "Phase: 999 — Wrong phase")
      .replace("Status: Ready to execute", "Status: Complete")
      .replace("40%", "99%");
    await fs.writeFile(statePath, state);
    const routingCodes = new Set(checkWorkflowState(routingFixture.planningRoot).errors.map((error: { code: string }) => error.code));
    for (const code of [
      "state_progress_percent_mismatch",
      "state_current_position_phase_mismatch",
      "state_session_continuity_stopped_at_mismatch",
      "state_roadmap_current_phase_name_mismatch",
      "state_status_progress_mismatch",
    ]) {
      assert.ok(routingCodes.has(code), code);
    }

    const duplicateFixture = await copyState();
    const duplicatePath = path.join(duplicateFixture.planningRoot, "STATE.md");
    let duplicate = await fs.readFile(duplicatePath, "utf8");
    duplicate = duplicate
      .replace("current_phase: 115", "current_phase: 115\n\"current_phase\": 999")
      .replace("Plan: 4 plans ready", "Plan: 4 plans ready\nPlan: 999 plans ready")
      .replace(
        "Stopped at: Phase 115 planning complete — 4 plans ready",
        "Stopped at: Phase 115 planning complete — 4 plans ready\nStopped at: Phase 999 wrong — 999 plans ready",
      );
    await fs.writeFile(duplicatePath, duplicate);
    const duplicateCodes = new Set(checkWorkflowState(duplicateFixture.planningRoot).errors.map((error: { code: string }) => error.code));
    assert.ok(duplicateCodes.has("state_frontmatter_duplicate_key"));
    assert.ok(duplicateCodes.has("state_current_position_duplicate_plan"));
    assert.ok(duplicateCodes.has("state_session_continuity_duplicate_stopped_at"));

    const progressFixture = await copyState();
    const roadmapPath = path.join(progressFixture.planningRoot, "ROADMAP.md");
    await fs.writeFile(
      roadmapPath,
      (await fs.readFile(roadmapPath, "utf8")).replace(
        "| 114. Complete | 1/1 | Complete | 2026-07-15 |",
        "| 114. Complete | 1/1 | Not started | - |",
      ),
    );
    assert.ok(
      checkWorkflowState(progressFixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "roadmap_progress_status_mismatch",
      ),
    );
  });

  it("parses CRLF SUMMARY frontmatter as the same complete state", async () => {
    const fixture = await copyState();
    const summaryPath = path.join(fixture.planningRoot, "phases/114-complete/114-01-SUMMARY.md");
    const summary = await fs.readFile(summaryPath, "utf8");
    await fs.writeFile(summaryPath, summary.replace(/\r?\n/g, "\r\n"));
    const result = checkWorkflowState(fixture.planningRoot);
    assert.equal(result.status, "pass");
    assert.equal(result.metrics.completedPlans, 2);
  });

  it("uses a closed allowlist for the active phases tree", async () => {
    const phasesRootFixture = await copyState();
    await fs.writeFile(path.join(phasesRootFixture.planningRoot, "phases/README.md"), "ignored before hardening\n");
    assert.ok(
      checkWorkflowState(phasesRootFixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "disk_unknown_phases_entry",
      ),
    );

    const phaseFixture = await copyState();
    await fs.writeFile(path.join(phaseFixture.planningRoot, "phases/115-active/rogue.bin"), "ignored before hardening\n");
    assert.ok(
      checkWorkflowState(phaseFixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "disk_unknown_phase_entry",
      ),
    );
  });

  it("accepts only the matching phase verification seal and rejects mismatched or unknown files", async () => {
    const matching = await copyState();
    await fs.writeFile(path.join(matching.planningRoot, "phases/115-active/115-SEAL.json"), "{}\n");
    const matchingResult = checkWorkflowState(matching.planningRoot);
    assert.equal(matchingResult.status, "pass");
    assert.deepEqual(matchingResult.errors, []);

    const mismatched = await copyState();
    await fs.writeFile(path.join(mismatched.planningRoot, "phases/115-active/114-SEAL.json"), "{}\n");
    assert.ok(
      checkWorkflowState(mismatched.planningRoot).errors.some(
        (error: { code: string; phase?: string; entry?: string }) =>
          error.code === "disk_unknown_phase_entry" &&
          error.phase === "115" &&
          error.entry === "114-SEAL.json",
      ),
    );

    const unknown = await copyState();
    await fs.writeFile(path.join(unknown.planningRoot, "phases/115-active/rogue.bin"), "unknown\n");
    assert.ok(
      checkWorkflowState(unknown.planningRoot).errors.some(
        (error: { code: string; phase?: string; entry?: string }) =>
          error.code === "disk_unknown_phase_entry" &&
          error.phase === "115" &&
          error.entry === "rogue.bin",
      ),
    );
  });

  it("accepts frozen auxiliary artifacts and ignores archived attempts as active evidence", async () => {
    const fixture = await copyState();
    const result = checkWorkflowState(fixture.planningRoot);
    assert.equal(result.status, "pass");
    assert.equal(result.metrics.plans, 5);
    assert.equal(result.metrics.completedPlans, 2);
    assert.ok(
      !result.errors.some((error: { code: string }) => error.code === "disk_unknown_phase_entry"),
      "frozen CHECKPOINT/R03/LOG/PATTERNS/PREFLIGHT artifacts and attempts must be recognized",
    );
  });

  it("derives the current phase from the first incomplete phase and rejects completion gaps", async () => {
    const staleFixture = await copyState();
    const statePath = path.join(staleFixture.planningRoot, "STATE.md");
    let state = await fs.readFile(statePath, "utf8");
    state = state
      .replace("current_phase: 115", "current_phase: 114")
      .replace("current_phase_name: Active", "current_phase_name: Complete")
      .replace("status: executing", "status: complete")
      .replaceAll("Phase 115 planning complete — 4 plans ready", "Phase 114 complete — 1 plan ready")
      .replace("Phase: 115 — Active", "Phase: 114 — Complete")
      .replace("Plan: 4 plans ready", "Plan: 1 plan ready")
      .replace("Status: Ready to execute", "Status: Complete");
    await fs.writeFile(statePath, state);
    assert.ok(
      checkWorkflowState(staleFixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "state_current_phase_not_first_incomplete",
      ),
      "a coherent route back to an already-complete phase must fail",
    );

    const gapFixture = await copyState();
    const phase114Summary = path.join(gapFixture.planningRoot, "phases/114-complete/114-01-SUMMARY.md");
    await fs.writeFile(phase114Summary, (await fs.readFile(phase114Summary, "utf8")).replace("status: complete", "status: pending"));
    for (const plan of ["115-01", "115-02", "115-03"]) {
      await fs.writeFile(
        path.join(gapFixture.planningRoot, `phases/115-active/${plan}-SUMMARY.md`),
        `---\nstatus: complete\n---\n\n# Summary ${plan}\n`,
      );
    }
    assert.ok(
      checkWorkflowState(gapFixture.planningRoot).errors.some(
        (error: { code: string; phase?: string }) =>
          error.code === "phase_completion_out_of_order" && error.phase === "115",
      ),
      "a completed later phase after an incomplete earlier phase must fail",
    );
  });

  it("binds selected status to current disk progress", async () => {
    const fixture = await copyState();
    const statePath = path.join(fixture.planningRoot, "STATE.md");
    let state = await fs.readFile(statePath, "utf8");
    state = state.replace("status: executing", "status: pending").replace("Status: Ready to execute", "Status: Not started");
    await fs.writeFile(statePath, state);
    assert.ok(
      checkWorkflowState(fixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "state_status_progress_mismatch",
      ),
      "not_started cannot describe a phase with completed plans",
    );
  });

  it("fails closed on malformed frontmatter and malformed canonical body aliases", async () => {
    const frontmatterFixture = await copyState();
    const statePath = path.join(frontmatterFixture.planningRoot, "STATE.md");
    await fs.writeFile(
      statePath,
      (await fs.readFile(statePath, "utf8"))
        .replace("current_phase: 115", "current_phase 115")
        .replace("  total_plans: 5", "   total_plans: 5"),
    );
    assert.ok(
      checkWorkflowState(frontmatterFixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "state_frontmatter_invalid",
      ),
    );

    const mixedContainerFixture = await copyState();
    const mixedContainerPath = path.join(mixedContainerFixture.planningRoot, "STATE.md");
    await fs.writeFile(
      mixedContainerPath,
      (await fs.readFile(mixedContainerPath, "utf8")).replace(
        "  total_phases: 2",
        "  - misleading-list-entry\n  total_phases: 2",
      ),
    );
    assert.ok(
      checkWorkflowState(mixedContainerFixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "state_frontmatter_invalid",
      ),
      "a frontmatter container cannot mix list and mapping entries",
    );

    const aliasFixture = await copyState();
    const aliasPath = path.join(aliasFixture.planningRoot, "STATE.md");
    await fs.writeFile(
      aliasPath,
      (await fs.readFile(aliasPath, "utf8"))
        .replace("Plan: 4 plans ready", "Plan: 4 plans ready\nPlan:999")
        .replace(
          "Stopped at: Phase 115 planning complete — 4 plans ready",
          "Stopped at: Phase 115 planning complete — 4 plans ready\nStopped at : unknown",
        ),
    );
    const aliasCodes = new Set(checkWorkflowState(aliasFixture.planningRoot).errors.map((error: { code: string }) => error.code));
    assert.ok(aliasCodes.has("state_current_position_plan_malformed"));
    assert.ok(aliasCodes.has("state_session_continuity_stopped_at_malformed"));
  });

  it("does not treat canonical sections inside HTML comments as live state", async () => {
    const stateFixture = await copyState();
    const statePath = path.join(stateFixture.planningRoot, "STATE.md");
    await fs.writeFile(
      statePath,
      (await fs.readFile(statePath, "utf8"))
        .replace("## Current Position", "<!--\n## Current Position")
        .replace("## Session Continuity", "-->\n## Session Continuity"),
    );
    const stateCodes = new Set(checkWorkflowState(stateFixture.planningRoot).errors.map((error: { code: string }) => error.code));
    assert.ok(stateCodes.has("state_current_position_phase_missing"));
    assert.ok(stateCodes.has("state_current_position_plan_missing"));

    const roadmapFixture = await copyState();
    const roadmapPath = path.join(roadmapFixture.planningRoot, "ROADMAP.md");
    const roadmap = await fs.readFile(roadmapPath, "utf8");
    await fs.writeFile(roadmapPath, roadmap.replace("## Progress", "<!--\n## Progress") + "\n-->\n");
    assert.ok(
      checkWorkflowState(roadmapFixture.planningRoot).errors.some(
        (error: { code: string }) => error.code === "roadmap_progress_missing",
      ),
    );
  });

  it("rejects alternate namespaces, symlinked state inputs, and final tree or HEAD drift", async () => {
    const alternate = await copyState();
    const alternateRoot = path.join(alternate.projectRoot, "alternate");
    await fs.cp(alternate.planningRoot, alternateRoot, { recursive: true });
    assert.equal(checkWorkflowState(alternateRoot).errors[0].code, "workflow_planning_root_override_forbidden");

    const mismatchedProject = await copyState();
    assert.equal(
      checkWorkflowState(alternate.planningRoot, { projectRoot: mismatchedProject.projectRoot }).errors[0].code,
      "workflow_planning_root_override_forbidden",
    );

    for (const target of ["STATE.md", "ROADMAP.md", "phases"] as const) {
      const fixture = await copyState();
      const original = path.join(fixture.planningRoot, target);
      const outside = path.join(fixture.container, `outside-${target}`);
      await fs.rename(original, outside);
      await fs.symlink(outside, original);
      assert.equal(checkWorkflowState(fixture.planningRoot).errors[0].code, "workflow_state_tree_unsafe");
    }

    const hardlink = await copyState();
    await fs.link(
      path.join(hardlink.planningRoot, "STATE.md"),
      path.join(hardlink.container, "outside-state-hardlink.md"),
    );
    assert.equal(checkWorkflowState(hardlink.planningRoot).errors[0].code, "workflow_state_tree_unsafe");

    const treeDrift = await copyState();
    const treeResult = checkWorkflowState(treeDrift.planningRoot, {
      testCheckpoint(stage) {
        assert.equal(stage, "before_final_freshness_check");
        fsSync.appendFileSync(path.join(treeDrift.planningRoot, "ROADMAP.md"), "\nchanged\n");
      },
    });
    assert.ok(treeResult.errors.some((error: { code: string }) => error.code === "workflow_state_changed_during_check"));

    const restoredDrift = await copyState();
    const restoredPath = path.join(restoredDrift.planningRoot, "ROADMAP.md");
    const restoredResult = checkWorkflowState(restoredDrift.planningRoot, {
      testCheckpoint() {
        const original = fsSync.readFileSync(restoredPath);
        fsSync.writeFileSync(restoredPath, "temporary substitute\n");
        fsSync.writeFileSync(restoredPath, original);
      },
    });
    assert.ok(
      restoredResult.errors.some((error: { code: string }) => error.code === "workflow_state_changed_during_check"),
      "A→B→A content restoration must still change snapshot identity",
    );

    const headDrift = await copyState();
    const headResult = checkWorkflowState(headDrift.planningRoot, {
      testCheckpoint() {
        fsSync.writeFileSync(path.join(headDrift.projectRoot, "head-drift.txt"), "drift\n");
        execFileSync("git", ["add", "head-drift.txt"], { cwd: headDrift.projectRoot });
        execFileSync("git", ["commit", "-qm", "move head"], { cwd: headDrift.projectRoot });
      },
    });
    assert.ok(headResult.errors.some((error: { code: string }) => error.code === "workflow_state_changed_during_check"));
  });

  it("uses deterministic CLI exit status without offering repair", async () => {
    const driftFixture = await copyState("known-drift");
    const drift = spawnSync(
      process.execPath,
      ["scripts/workflow/state-check.mjs", `--project-root=${driftFixture.projectRoot}`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(drift.status, 1, drift.stderr);
    const parsed = JSON.parse(drift.stdout);
    assert.equal(parsed.status, "fail");
    assert.doesNotMatch(`${drift.stdout}${drift.stderr}`, /repair|delete|normalize/i);

    const consistentFixture = await copyState();
    const consistent = spawnSync(
      process.execPath,
      ["scripts/workflow/state-check.mjs", `--project-root=${consistentFixture.projectRoot}`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(consistent.status, 0, consistent.stderr);
    assert.equal(JSON.parse(consistent.stdout).status, "pass");

    const legacyOverride = spawnSync(
      process.execPath,
      ["scripts/workflow/state-check.mjs", `--planning-root=${consistentFixture.planningRoot}`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(legacyOverride.status, 2);
    assert.equal(JSON.parse(legacyOverride.stderr).code, "usage_error");
  });
});
