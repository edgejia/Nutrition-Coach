import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPlanningCloseout,
  normalizePlanningCloseout,
} from "../../scripts/workflow/planning-closeout.mjs";
import { stampArtifactProvenance } from "../../scripts/workflow/artifact-provenance.mjs";
import {
  createVerificationSeal,
  writeVerificationSeal,
} from "../../scripts/workflow/verification-seal.mjs";
import { acquireWorkflowLease, releaseWorkflowLease } from "../../scripts/workflow/workflow-lease.mjs";

const fixtures = fileURLToPath(new URL("../fixtures/workflow/closeout/", import.meta.url));
const tempDirs = new Set<string>();
const fixtureMeta = new Map<
  string,
  {
    projectRoot: string;
    commonDir: string;
    tokenFile: string;
    sourceSha: string;
    receiptRoot: string;
    provenanceReceiptPaths: string[];
  }
>();

async function copyFixture(name: string) {
  const container = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `nutrition-closeout-${name}-`)));
  tempDirs.add(container);
  const projectRoot = path.join(container, "project");
  const root = path.join(projectRoot, ".planning");
  await fs.mkdir(projectRoot);
  await fs.cp(path.join(fixtures, name), root, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "workflow-test@example.invalid"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "Workflow Test"], { cwd: projectRoot });
  execFileSync("git", ["add", "."], { cwd: projectRoot });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectRoot, stdio: "ignore" });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  const commonDir = path.join(projectRoot, ".git");
  const tokenFile = path.join(container, "private", "token.json");
  const receiptRoot = path.join(container, "private", "provenance-receipts");
  await acquireWorkflowLease({
    projectRoot,
    commonDir,
    tokenFile,
    executionRuntime: "codex",
    gsdVersion: "1.7.0",
    modelProfile: "sol-high",
    ttlSeconds: 3600,
  });
  fixtureMeta.set(root, { projectRoot, commonDir, tokenFile, sourceSha, receiptRoot, provenanceReceiptPaths: [] });
  return root;
}

function meta(root: string) {
  const value = fixtureMeta.get(root);
  assert.ok(value);
  return value;
}

function mutationOptions(root: string) {
  return { ...meta(root), expectedRuntime: "codex" };
}

function strictOptions(root: string) {
  const value = meta(root);
  return {
    projectRoot: value.projectRoot,
    tokenFile: value.tokenFile,
    expectedRuntime: "codex",
    sourceSha: value.sourceSha,
    expectedGsdVersion: "1.7.0",
    provenanceReceiptPaths: [...value.provenanceReceiptPaths],
  };
}

async function applyCloseout(root: string, milestone: string) {
  const dryRun = await normalizePlanningCloseout({
    planningRoot: root,
    projectRoot: meta(root).projectRoot,
    milestone,
    dryRun: true,
  });
  return normalizePlanningCloseout({
    planningRoot: root,
    milestone,
    dryRun: false,
    confirmPlanSha256: dryRun.planSha256,
    ...mutationOptions(root),
  });
}

async function treeDigest(root: string) {
  const entries: string[] = [];
  async function visit(current: string, base: string) {
    const children = await fs.readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const absolute = path.join(current, child.name);
      const relative = base ? path.posix.join(base, child.name) : child.name;
      if (child.isDirectory()) {
        entries.push(`d:${relative}`);
        await visit(absolute, relative);
      } else {
        entries.push(`f:${relative}:${createHash("sha256").update(await fs.readFile(absolute)).digest("hex")}`);
      }
    }
  }
  await visit(root, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function addSeal(root: string, base: string, prefix: string) {
  const phaseRoot = path.join(root, base);
  const inputs = [
    `${prefix}-01-SUMMARY.md`,
    `${prefix}-UAT.md`,
    `${prefix}-VALIDATION.md`,
    `${prefix}-VERIFICATION.md`,
  ];
  await addProvenance(root, base, [`${prefix}-01-SUMMARY.md`, `${prefix}-VERIFICATION.md`]);
  const seal = await createVerificationSeal({
    root: phaseRoot,
    projectRoot: meta(root).projectRoot,
    phaseId: prefix,
    verifiedSourceSha: meta(root).sourceSha,
    executionRuntime: "codex",
    gsdVersion: "1.7.0",
    modelProfile: "sol-high",
    inputs,
    now: new Date("2026-07-15T08:00:00.000Z"),
  });
  await writeVerificationSeal({
    root: phaseRoot,
    sealPath: `${prefix}-SEAL.json`,
    seal,
    ...mutationOptions(root),
  });
  return seal;
}

async function addProvenance(root: string, base: string, artifacts: string[]) {
  const fixture = meta(root);
  for (const artifact of artifacts) {
    const artifactPath = path.join(root, base, artifact);
    const receiptPath = path.join(fixture.receiptRoot, `${String(fixture.provenanceReceiptPaths.length).padStart(3, "0")}.json`);
    await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: createHash("sha256").update(await fs.readFile(artifactPath)).digest("hex"),
      receiptPath,
      sourceSha: fixture.sourceSha,
    });
    fixture.provenanceReceiptPaths.push(receiptPath);
  }
}

afterEach(async () => {
  for (const root of tempDirs) {
    await fs.rm(root, { recursive: true, force: true });
  }
  tempDirs.clear();
  fixtureMeta.clear();
});

describe("deterministic planning closeout", () => {
  it("normalizes the v3.0.1 flat archive idempotently and passes strict checks", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const before = await treeDigest(root);
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    assert.equal(dryRun.status, "pass");
    assert.ok(dryRun.operations.some((operation) => operation.type === "move"));
    assert.ok(dryRun.operations.some((operation) => operation.type === "remove_cache_tree"));
    assert.ok(dryRun.operations.some((operation) => operation.type === "rewrite_root_document" && operation.path === "STATE.md"));
    assert.ok(dryRun.operations.some((operation) => operation.type === "rewrite_root_document" && operation.path === "ROADMAP.md"));
    assert.equal(await treeDigest(root), before);

    const applied = await applyCloseout(root, "v3.0.1");
    assert.deepEqual(applied.operations, dryRun.operations);
    await addSeal(root, "milestones/v3.0.1/phases/90-history", "90");
    const second = await applyCloseout(root, "v3.0.1");
    assert.deepEqual(second.operations, []);
    assert.equal(second.status, "pass", JSON.stringify(second));

    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      strict: true,
      ...strictOptions(root),
    });
    assert.deepEqual(strict.errors, []);
    assert.equal(strict.status, "pass");
  });

  it("cleans only known cache output in the canonical v3.4 fixture and remains idempotent", async () => {
    const root = await copyFixture("v3.4-canonical");
    const applied = await applyCloseout(root, "v3.4");
    assert.equal(applied.operations.length, 1);
    assert.equal(applied.operations[0].type, "remove_cache_tree");
    assert.equal(applied.operations[0].path, "research");
    const canonicalNoop = await applyCloseout(root, "v3.4");
    assert.deepEqual(canonicalNoop.operations, []);
    assert.equal(canonicalNoop.journal.state, "committed", JSON.stringify(canonicalNoop));

    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    const strict = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.equal(strict.status, "pass");
  });

  it("accepts the canonical shipped milestone index heading", async () => {
    const root = await copyFixture("v3.4-canonical");
    await fs.writeFile(
      path.join(root, "MILESTONES.md"),
      "# Project Milestones: Fixture\n\n## v3.4 Portfolio Baseline (Shipped: 2026-07-14)\n\nArchive details.\n",
    );
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      strict: true,
      ...strictOptions(root),
    });
    assert.equal(strict.status, "pass", JSON.stringify(strict.errors));
  });

  it("rejects contradictory or nonterminal root-document false passes", async () => {
    const root = await copyFixture("v3.4-canonical");
    const cases = [
      {
        fileName: "STATE.md",
        content: "# Project State\n\nMilestone v3.4 complete\n\nStatus: active\nAwaiting next milestone.\n",
        normalizeCode: "closeout_state_human_decision_required",
        strictCode: "closeout_state_terminal_template_mismatch",
      },
      {
        fileName: "STATE.md",
        content: "# Project State\n\nMilestone v3.4 complete but not really\n\nStatus: executing\n",
        normalizeCode: "closeout_state_human_decision_required",
        strictCode: "closeout_state_terminal_template_mismatch",
      },
      {
        fileName: "ROADMAP.md",
        content: "# Roadmap\n\n- v3.4 active\n",
        normalizeCode: "closeout_roadmap_human_decision_required",
        strictCode: "closeout_roadmap_terminal_template_mismatch",
      },
      {
        fileName: "ROADMAP.md",
        content: "# Roadmap\n\n- v3.4 active\n- v3.4 archived\n",
        normalizeCode: "closeout_roadmap_human_decision_required",
        strictCode: "closeout_roadmap_terminal_template_mismatch",
      },
      {
        fileName: "MILESTONES.md",
        content: "# Milestones\n\n- v3.4 incomplete\n",
        normalizeCode: "closeout_milestones_human_decision_required",
        strictCode: "closeout_milestones_index_missing",
      },
      {
        fileName: "MILESTONES.md",
        content: "# Milestones\n\n## v3.4 Incomplete (Shipped: 2026-07-14)\n",
        normalizeCode: "closeout_milestones_human_decision_required",
        strictCode: "closeout_milestones_index_missing",
      },
      {
        fileName: "MILESTONES.md",
        content: "# Milestones\n\n- v3.4 complete\n- v3.4 complete\n",
        normalizeCode: "closeout_milestones_human_decision_required",
        strictCode: "closeout_milestones_index_missing",
      },
    ] as const;

    for (const testCase of cases) {
      const target = path.join(root, testCase.fileName);
      const original = await fs.readFile(target, "utf8");
      await fs.writeFile(target, testCase.content);
      const dryRun = await normalizePlanningCloseout({
        planningRoot: root,
        projectRoot: meta(root).projectRoot,
        milestone: "v3.4",
        dryRun: true,
      });
      assert.equal(dryRun.status, "fail", testCase.fileName);
      assert.ok(dryRun.errors.some((error) => error.code === testCase.normalizeCode), testCase.fileName);
      await fs.writeFile(target, original);
    }

    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    for (const testCase of cases) {
      const target = path.join(root, testCase.fileName);
      const original = await fs.readFile(target, "utf8");
      await fs.writeFile(target, testCase.content);
      const strict = await checkPlanningCloseout({
        planningRoot: root,
        milestone: "v3.4",
        strict: true,
        ...strictOptions(root),
      });
      assert.equal(strict.status, "fail", testCase.fileName);
      assert.ok(strict.errors.some((error) => error.code === testCase.strictCode), testCase.fileName);
      await fs.writeFile(target, original);
    }
  });

  it("never guesses ambiguous UAT completion semantics", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    const uat = path.join(root, "milestones/v3.4/phases/113.1-source/113.1-UAT.md");
    await fs.writeFile(uat, (await fs.readFile(uat, "utf8")).replace("status: complete", "status: passed"));
    const before = await fs.readFile(uat, "utf8");

    const normalize = await applyCloseout(root, "v3.4");
    assert.deepEqual(normalize.operations, []);
    assert.equal(await fs.readFile(uat, "utf8"), before);
    const strict = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.equal(strict.status, "fail");
    const codes = new Set(strict.errors.map((error) => error.code));
    assert.ok(codes.has("closeout_uat_status_human_decision_required"));
    assert.ok(codes.has("closeout_verification_stale"));
  });

  it("fails before mutation on a non-identical archive collision", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const destination = path.join(root, "milestones/v3.0.1/ROADMAP.md");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, "different canonical bytes\n");
    const before = await treeDigest(root);

    const result = await applyCloseout(root, "v3.0.1");
    assert.equal(result.status, "fail");
    assert.ok(result.errors.some((error) => error.code === "closeout_archive_collision"));
    assert.equal(await treeDigest(root), before);
  });

  it("fails before mutation when two flat aliases target one absent archive destination", async () => {
    const root = await copyFixture("v3.0.1-flat");
    await fs.writeFile(path.join(root, "milestones/v3.0.1-MILESTONE-AUDIT.md"), "different audit bytes\n");
    const before = await treeDigest(root);

    const result = await applyCloseout(root, "v3.0.1");
    assert.equal(result.status, "fail");
    assert.ok(result.errors.some((error) => error.code === "closeout_planned_destination_collision"));
    assert.equal(await treeDigest(root), before);
  });

  it("binds apply to the dry-run plan and an active lease before any closeout mutation", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    await fs.appendFile(path.join(root, "milestones/v3.0.1-ROADMAP.md"), "changed after approval\n");
    const changedTree = await treeDigest(root);
    const stalePlan = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      ...mutationOptions(root),
    });
    assert.equal(stalePlan.status, "fail");
    assert.equal(stalePlan.code, "closeout_plan_confirmation_mismatch");
    assert.equal(await treeDigest(root), changedTree);

    const fresh = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    const wrongToken = path.join(meta(root).projectRoot, "inside-project-token.json");
    await assert.rejects(
      normalizePlanningCloseout({
        planningRoot: root,
        milestone: "v3.0.1",
        dryRun: false,
        confirmPlanSha256: fresh.planSha256,
        ...mutationOptions(root),
        tokenFile: wrongToken,
      }),
      (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "lease_token_path_inside_project",
    );
    assert.equal(await treeDigest(root), changedTree);
  });

  it("durably resumes an approved journal instead of approving a remainder plan", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    const interrupted = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      testFaultStage: "after_effect:0",
      ...mutationOptions(root),
    });
    assert.equal(interrupted.status, "needs_reconciliation");
    assert.equal(interrupted.cleanupRequired, true);
    assert.equal(interrupted.journal.state, "applying");
    assert.equal(interrupted.journal.nextOperationIndex, 0);

    const remainder = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    assert.notEqual(remainder.planSha256, dryRun.planSha256);
    const rejectedRemainder = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: remainder.planSha256,
      ...mutationOptions(root),
    });
    assert.equal(rejectedRemainder.status, "fail");
    assert.equal(rejectedRemainder.code, "closeout_journal_in_progress");

    const resumed = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      ...mutationOptions(root),
    });
    assert.equal(resumed.status, "pass");
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.journal.state, "committed");
    assert.equal(resumed.journal.nextOperationIndex, dryRun.operations.length);
    await assert.rejects(fs.access(path.join(root, ".closeout-quarantine")));

    const replay = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      ...mutationOptions(root),
    });
    assert.equal(replay.status, "pass");
    assert.equal(replay.journal.state, "committed");
    assert.equal(replay.journal.journalSha256, resumed.journal.journalSha256);
    assert.deepEqual(replay.appliedOperations, []);
  });

  it("strictly rejects an incomplete journal and resumes an exact signed journal temp", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    const interrupted = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      testFaultStage: "after_journal_create",
      ...mutationOptions(root),
    });
    assert.equal(interrupted.status, "needs_reconciliation");
    assert.equal(interrupted.journal.state, "prepared");

    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      strict: true,
      ...strictOptions(root),
    });
    assert.ok(strict.errors.some((error) => error.code === "closeout_journal_incomplete"));

    const journalDirectory = path.join(meta(root).commonDir, "nutrition-workflow", "closeout-journals");
    const journalName = (await fs.readdir(journalDirectory)).find((name) => name.endsWith(".json"));
    assert.ok(journalName);
    const tempName = `.${journalName}.tmp-11111111-1111-4111-8111-111111111111`;
    await fs.rename(path.join(journalDirectory, journalName), path.join(journalDirectory, tempName));
    const resumed = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      ...mutationOptions(root),
    });
    assert.equal(resumed.status, "pass");
    assert.equal(resumed.journal.state, "committed");
    assert.deepEqual(
      resumed.recoveredJournalTemps.map((entry: { action: string }) => entry.action),
      ["publish_prepared_journal"],
    );
  });

  it("rechecks the approved plan under the writer fence before the first effect", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    const source = path.join(root, "milestones", "v3.0.1-ROADMAP.md");
    const result = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      testCheckpoint: async (stage: string) => {
        assert.equal(stage, "after_writer_fence");
        await fs.mkdir(path.join(root, "research"));
        await fs.writeFile(path.join(root, "research", "unapproved.md"), "unapproved\n");
      },
      ...mutationOptions(root),
    });
    assert.equal(result.status, "fail");
    assert.equal(result.code, "closeout_plan_changed_before_fence");
    assert.equal(await fs.readFile(source, "utf8"), await fs.readFile(path.join(fixtures, "v3.0.1-flat", "milestones", "v3.0.1-ROADMAP.md"), "utf8"));
  });

  it("recovers deterministic delete quarantine and rewrite staging checkpoints", async () => {
    for (const fixtureName of ["v3.0.1-flat", "v3.4-canonical"] as const) {
      const root = await copyFixture(fixtureName);
      const milestone = fixtureName === "v3.0.1-flat" ? "v3.0.1" : "v3.4";
      const dryRun = await normalizePlanningCloseout({
        planningRoot: root,
        projectRoot: meta(root).projectRoot,
        milestone,
        dryRun: true,
      });
      const operationIndex = dryRun.operations.findIndex((operation) =>
        fixtureName === "v3.0.1-flat" ? operation.type === "rewrite_root_document" : operation.type === "remove_cache_tree",
      );
      assert.ok(operationIndex >= 0);
      const stage =
        fixtureName === "v3.0.1-flat"
          ? `after_rewrite_temp:${operationIndex}`
          : `after_quarantine:${operationIndex}`;
      const interrupted = await normalizePlanningCloseout({
        planningRoot: root,
        milestone,
        dryRun: false,
        confirmPlanSha256: dryRun.planSha256,
        testFaultStage: stage,
        ...mutationOptions(root),
      });
      assert.equal(interrupted.status, "needs_reconciliation");
      const resumed = await normalizePlanningCloseout({
        planningRoot: root,
        milestone,
        dryRun: false,
        confirmPlanSha256: dryRun.planSha256,
        ...mutationOptions(root),
      });
      assert.equal(resumed.status, "pass", JSON.stringify({ fixtureName, resumed }));
      assert.equal(resumed.journal.state, "committed");
      await assert.rejects(fs.access(path.join(root, ".closeout-quarantine")));
      const leftovers = (await fs.readdir(root)).filter((name) => name.includes(".closeout-") && name.endsWith(".tmp"));
      assert.deepEqual(leftovers, []);
    }
  });

  it("preserves a truncated quarantine or unrelated resume drift and fails closed", async () => {
    for (const mode of ["truncated-quarantine", "missing-quarantine", "unrelated-tree"] as const) {
      const root = await copyFixture("v3.4-canonical");
      const dryRun = await normalizePlanningCloseout({
        planningRoot: root,
        projectRoot: meta(root).projectRoot,
        milestone: "v3.4",
        dryRun: true,
      });
      const operationIndex = dryRun.operations.findIndex((operation) => operation.type === "remove_cache_tree");
      assert.ok(operationIndex >= 0);
      const interrupted = await normalizePlanningCloseout({
        planningRoot: root,
        milestone: "v3.4",
        dryRun: false,
        confirmPlanSha256: dryRun.planSha256,
        testFaultStage: `after_quarantine:${operationIndex}`,
        ...mutationOptions(root),
      });
      assert.equal(interrupted.status, "needs_reconciliation");
      const quarantine = path.join(root, ".closeout-quarantine", dryRun.planSha256, String(operationIndex));
      if (mode === "truncated-quarantine") {
        const cache = path.join(quarantine, "cache");
        const cachedFile = (await fs.readdir(cache))[0];
        assert.ok(cachedFile);
        await fs.unlink(path.join(cache, cachedFile));
      } else if (mode === "missing-quarantine") {
        await fs.rm(quarantine, { recursive: true });
      } else {
        await fs.writeFile(path.join(root, "unapproved-resume-drift.md"), "unapproved\n");
      }
      const resumed = await normalizePlanningCloseout({
        planningRoot: root,
        milestone: "v3.4",
        dryRun: false,
        confirmPlanSha256: dryRun.planSha256,
        ...mutationOptions(root),
      });
      assert.equal(resumed.status, "needs_reconciliation");
      assert.equal(
        resumed.code,
        mode === "truncated-quarantine"
          ? "closeout_operation_state_ambiguous"
          : mode === "missing-quarantine"
            ? "closeout_destructive_commit_evidence_missing"
          : "closeout_journal_unrelated_tree_changed",
      );
      if (mode !== "missing-quarantine") {
        assert.equal(await fs.stat(quarantine).then(() => true, () => false), true);
      }
    }
  });

  it("binds apply confirmation to the exact source, scope, and initial planning tree", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    const source = path.join(root, "milestones", "v3.0.1-ROADMAP.md");
    const sourceBefore = await fs.readFile(source);
    await fs.writeFile(path.join(root, "milestones", "unrelated-after-approval.md"), "not approved\n");
    const applied = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      ...mutationOptions(root),
    });
    assert.equal(applied.status, "fail");
    assert.equal(applied.code, "closeout_plan_confirmation_mismatch");
    assert.deepEqual(await fs.readFile(source), sourceBefore);
  });

  it("binds strict move evidence to immutable archived file bytes", async () => {
    const root = await copyFixture("v3.0.1-flat");
    await applyCloseout(root, "v3.0.1");
    await addSeal(root, "milestones/v3.0.1/phases/90-history", "90");
    await fs.appendFile(path.join(root, "milestones/v3.0.1/ROADMAP.md"), "\nchanged after closeout\n");
    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      strict: true,
      ...strictOptions(root),
    });
    assert.equal(strict.status, "fail");
    assert.equal(strict.errors.some((error) => error.code === "closeout_journal_postcondition_changed"), true);
  });

  it("rejects unapproved files added beneath a moved phase directory", async () => {
    const root = await copyFixture("v3.0.1-flat");
    await applyCloseout(root, "v3.0.1");
    const phase = path.join(root, "milestones/v3.0.1/phases/90-history");
    await addSeal(root, "milestones/v3.0.1/phases/90-history", "90");
    await fs.writeFile(path.join(phase, "unexpected.md"), "not part of the signed move evolution\n");

    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.0.1",
      strict: true,
      ...strictOptions(root),
    });
    assert.equal(strict.status, "fail");
    assert.equal(strict.errors.some((error) => error.code === "closeout_journal_postcondition_changed"), true);
  });

  it("binds canonical archives to their signed initial tree and accepts only the exact direct phase seal", async () => {
    for (const mode of ["body", "unexpected", "nested-seal"] as const) {
      const root = await copyFixture("v3.4-canonical");
      await applyCloseout(root, "v3.4");
      await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
      const phase = path.join(root, "milestones/v3.4/phases/113.1-source");
      if (mode === "body") {
        await fs.appendFile(path.join(phase, "113.1-VALIDATION.md"), "\nchanged after closeout\n");
      } else if (mode === "unexpected") {
        await fs.writeFile(path.join(phase, "unexpected.md"), "not signed by the closeout journal\n");
      } else {
        const nested = path.join(phase, "nested");
        await fs.mkdir(nested);
        await fs.writeFile(path.join(nested, "113.1-SEAL.json"), "{}\n");
      }
      const strict = await checkPlanningCloseout({
        planningRoot: root,
        milestone: "v3.4",
        strict: true,
        ...strictOptions(root),
      });
      assert.equal(strict.status, "fail");
      assert.ok(strict.errors.some((error) => error.code === "closeout_journal_postcondition_changed"));
    }
  });

  it("rejects a canonical artifact body rewrite even after valid restamping and resealing", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    const fixture = meta(root);
    const phase = path.join(root, "milestones/v3.4/phases/113.1-source");
    const summary = path.join(phase, "113.1-01-SUMMARY.md");
    const oldReceiptPath = fixture.provenanceReceiptPaths[0];
    assert.ok(oldReceiptPath);
    const oldReceipt = JSON.parse(await fs.readFile(oldReceiptPath, "utf8"));
    await fs.appendFile(summary, "\nrewritten after the signed closeout tree\n");
    const replacementReceipt = path.join(fixture.receiptRoot, "summary-replacement.json");
    await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: summary,
      expectedRuntime: "codex",
      confirmArtifactSha256: createHash("sha256").update(await fs.readFile(summary)).digest("hex"),
      replaceProvenanceSha256: oldReceipt.artifactProvenanceSha256,
      receiptPath: replacementReceipt,
      sourceSha: fixture.sourceSha,
    });
    fixture.provenanceReceiptPaths[0] = replacementReceipt;

    const sealPath = path.join(phase, "113.1-SEAL.json");
    const previousSeal = JSON.parse(await fs.readFile(sealPath, "utf8"));
    const replacementSeal = await createVerificationSeal({
      root: phase,
      projectRoot: fixture.projectRoot,
      phaseId: "113.1",
      verifiedSourceSha: fixture.sourceSha,
      executionRuntime: "codex",
      gsdVersion: "1.7.0",
      modelProfile: "sol-high",
      inputs: ["113.1-01-SUMMARY.md", "113.1-UAT.md", "113.1-VALIDATION.md", "113.1-VERIFICATION.md"],
    });
    await writeVerificationSeal({
      root: phase,
      sealPath: "113.1-SEAL.json",
      seal: replacementSeal,
      replaceDigest: previousSeal.evidenceManifestSha256,
      ...mutationOptions(root),
    });

    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      strict: true,
      ...strictOptions(root),
    });
    assert.equal(strict.status, "fail");
    assert.ok(
      strict.errors.some(
        (error) => error.code === "closeout_journal_postcondition_changed" && error.reason === "archive_provenance_payload_mismatch",
      ),
    );
    assert.equal(strict.errors.some((error) => error.code === "closeout_artifact_provenance_invalid"), false);
    assert.equal(strict.errors.some((error) => error.code === "closeout_verification_stale"), false);
  });

  it("forbids artifact provenance before a flat phase tree reaches its final archive path", async () => {
    const root = await copyFixture("v3.0.1-flat");
    const artifact = path.join(root, "milestones/v3.0.1-phases/90-history/90-01-SUMMARY.md");
    await fs.writeFile(
      artifact,
      (await fs.readFile(artifact, "utf8")).replace("---\n", "---\nworkflow_provenance_schema: 1\n"),
    );
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.0.1",
      dryRun: true,
    });
    assert.equal(dryRun.status, "fail");
    assert.ok(dryRun.errors.some((error) => error.code === "closeout_prearchive_provenance_forbidden"));
  });

  it("reasserts the writer holder immediately before a destructive closeout effect", async () => {
    const root = await copyFixture("v3.4-canonical");
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.4",
      dryRun: true,
    });
    const research = path.join(root, "research");
    const result = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      maxDurationSeconds: 1,
      testMutationCheckpoint: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      },
      ...mutationOptions(root),
    });
    assert.equal(result.status, "needs_reconciliation");
    assert.equal(result.code, "workflow_writer_fence_expired");
    assert.equal(await fs.stat(research).then((stat) => stat.isDirectory(), () => false), true);
  });

  it("resumes a destructive effect only from its signed quarantine-verified stage", async () => {
    const root = await copyFixture("v3.4-canonical");
    const dryRun = await normalizePlanningCloseout({
      planningRoot: root,
      projectRoot: meta(root).projectRoot,
      milestone: "v3.4",
      dryRun: true,
    });
    const operationIndex = dryRun.operations.findIndex((operation) => operation.type === "remove_cache_tree");
    assert.ok(operationIndex >= 0);
    const interrupted = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      testFaultStage: `after_effect:${operationIndex}`,
      ...mutationOptions(root),
    });
    assert.equal(interrupted.status, "needs_reconciliation");
    assert.equal(interrupted.journal.state, "applying");
    assert.equal(interrupted.journal.nextOperationIndex, operationIndex);

    const resumed = await normalizePlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      dryRun: false,
      confirmPlanSha256: dryRun.planSha256,
      ...mutationOptions(root),
    });
    assert.equal(resumed.status, "pass");
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.journal.state, "committed");
  });

  it("holds a verification fence and invalidates a changed signed journal ledger during the final window", async () => {
    for (const mode of ["noncanonical", "aba"] as const) {
      const root = await copyFixture("v3.4-canonical");
      await applyCloseout(root, "v3.4");
      await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
      const strict = await checkPlanningCloseout({
        planningRoot: root,
        milestone: "v3.4",
        strict: true,
        ...strictOptions(root),
        testCheckpoint: async (stage: string) => {
          assert.equal(stage, "before_final_freshness_check");
          await assert.rejects(
            releaseWorkflowLease({
              projectRoot: meta(root).projectRoot,
              tokenFile: meta(root).tokenFile,
            }),
            (error: unknown) => (error as Error & { code?: string }).code === "workflow_writer_active",
          );
          const directory = path.join(meta(root).commonDir, "nutrition-workflow", "closeout-journals");
          const journal = (await fs.readdir(directory)).find((name) => name.endsWith(".json"));
          assert.ok(journal);
          const journalPath = path.join(directory, journal);
          if (mode === "noncanonical") {
            await fs.appendFile(journalPath, "\n");
          } else {
            const replacement = `${journalPath}.replacement`;
            await fs.writeFile(replacement, await fs.readFile(journalPath), { mode: 0o600 });
            await fs.rename(replacement, journalPath);
          }
        },
      });
      assert.equal(strict.status, "fail");
      assert.equal(
        strict.errors.some((error) => error.code === "closeout_transaction_evidence_changed_during_check"),
        true,
      );
    }
  });

  it("invalidates an identical-byte planning artifact replacement during the final window", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    const target = path.join(root, "MILESTONES.md");
    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      strict: true,
      ...strictOptions(root),
      testCheckpoint: async (stage: string) => {
        assert.equal(stage, "before_final_freshness_check");
        const replacement = `${target}.replacement`;
        await fs.writeFile(replacement, await fs.readFile(target));
        await fs.rename(replacement, target);
      },
    });
    assert.equal(strict.status, "fail");
    assert.ok(strict.errors.some((error) => error.code === "closeout_evidence_changed_during_check"));
  });

  it("rejects a planning artifact with an off-tree hardlink alias", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    await fs.link(
      path.join(root, "MILESTONES.md"),
      path.join(path.dirname(meta(root).projectRoot), "off-tree-hardlink"),
    );

    const strict = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      strict: true,
      ...strictOptions(root),
    });
    assert.ok(
      strict.errors.some(
        (error) =>
          error.code === "closeout_planning_tree_snapshot_invalid" &&
          error.snapshotCode === "closeout_hardlink_rejected",
      ),
    );
  });

  it("strictly rejects missing phase dependency closure even when remaining artifacts are sealed", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    const phase = path.join(root, "milestones/v3.4/phases/113.1-source");
    await fs.rm(path.join(phase, "113.1-01-SUMMARY.md"));
    await fs.rm(path.join(phase, "113.1-UAT.md"));
    await fs.rm(path.join(phase, "113.1-VALIDATION.md"));
    await addProvenance(root, "milestones/v3.4/phases/113.1-source", ["113.1-VERIFICATION.md"]);
    const seal = await createVerificationSeal({
      root: phase,
      projectRoot: meta(root).projectRoot,
      phaseId: "113.1",
      verifiedSourceSha: meta(root).sourceSha,
      executionRuntime: "codex",
      gsdVersion: "1.7.0",
      modelProfile: "sol-high",
      inputs: ["113.1-VERIFICATION.md"],
    });
    await writeVerificationSeal({ root: phase, sealPath: "113.1-SEAL.json", seal, ...mutationOptions(root) });

    const strict = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.equal(strict.status, "fail");
    const warnings = new Set(strict.warnings.map((warning) => warning.code));
    assert.ok(warnings.has("closeout_phase_summary_missing"));
    assert.ok(warnings.has("closeout_phase_artifact_missing"));
  });

  it("requires a retained sidecar to have an exact plain README heading and rationale", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
    const sidecar = path.join(root, "milestones/v3.4/research");
    await fs.mkdir(sidecar, { recursive: true });
    await fs.writeFile(path.join(sidecar, "context.md"), "retained evidence\n");
    const missing = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.ok(missing.errors.some((error) => error.code === "closeout_sidecar_unsafe"));

    await fs.writeFile(path.join(sidecar, "README.md"), "# Retained Local Context\n\nReason: historical audit evidence.\n");
    const complete = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.equal(complete.status, "pass");
  });

  it("makes signed artifact receipts part of the strict closeout verdict", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");

    const missingReceipt = await checkPlanningCloseout({
      planningRoot: root,
      milestone: "v3.4",
      strict: true,
      ...strictOptions(root),
      provenanceReceiptPaths: meta(root).provenanceReceiptPaths.slice(0, 1),
    });
    assert.ok(missingReceipt.errors.some((error) => error.code === "closeout_provenance_receipt_cardinality_mismatch"));

    const summary = path.join(root, "milestones/v3.4/phases/113.1-source/113.1-01-SUMMARY.md");
    await fs.appendFile(summary, "\nchanged after provenance stamp\n");
    const stale = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.ok(
      stale.errors.some(
        (error) => error.code === "closeout_artifact_provenance_invalid" && error.provenanceCode === "artifact_payload_stale",
      ),
    );
  });

  it("revalidates external provenance receipts at the final strict checkpoint", async () => {
    for (const mode of ["receipt", "attestation-aba"] as const) {
      const root = await copyFixture("v3.4-canonical");
      await applyCloseout(root, "v3.4");
      await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");
      const receipt = meta(root).provenanceReceiptPaths[0];
      assert.ok(receipt);
      const strict = await checkPlanningCloseout({
        planningRoot: root,
        milestone: "v3.4",
        strict: true,
        ...strictOptions(root),
        testCheckpoint: async (stage: string) => {
          assert.equal(stage, "before_final_freshness_check");
          if (mode === "receipt") {
            await fs.appendFile(receipt, "\n");
          } else {
            const leaseId = JSON.parse(await fs.readFile(receipt, "utf8")).workflowLeaseId as string;
            const attestation = path.join(
              meta(root).commonDir,
              "nutrition-workflow",
              "lease-attestations",
              `${leaseId}.json`,
            );
            const replacement = `${attestation}.replacement`;
            await fs.writeFile(replacement, await fs.readFile(attestation), { mode: 0o600 });
            await fs.rename(replacement, attestation);
          }
        },
      });
      assert.equal(strict.status, "fail");
      assert.ok(strict.errors.some((error) => error.code === "closeout_provenance_evidence_changed_during_check"));
    }
  });

  it("strictly rejects unsafe archive files, duplicate phase identity, duplicate status, and live source drift", async () => {
    const root = await copyFixture("v3.4-canonical");
    await applyCloseout(root, "v3.4");
    await addSeal(root, "milestones/v3.4/phases/113.1-source", "113.1");

    const roadmap = path.join(root, "milestones/v3.4/ROADMAP.md");
    const roadmapRaw = await fs.readFile(roadmap, "utf8");
    await fs.rm(roadmap);
    await fs.mkdir(roadmap);
    let result = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.ok(result.errors.some((error) => error.code === "closeout_archive_file_missing"));

    await fs.rm(roadmap, { recursive: true });
    await fs.writeFile(roadmap, roadmapRaw);

    await fs.cp(
      path.join(root, "milestones/v3.4/phases/113.1-source"),
      path.join(root, "milestones/v3.4/phases/113.1-duplicate"),
      { recursive: true },
    );
    result = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.ok(result.errors.some((error) => error.code === "closeout_duplicate_phase_identity"));
    await fs.rm(path.join(root, "milestones/v3.4/phases/113.1-duplicate"), { recursive: true });

    const summary = path.join(root, "milestones/v3.4/phases/113.1-source/113.1-01-SUMMARY.md");
    const summaryRaw = await fs.readFile(summary, "utf8");
    await fs.writeFile(summary, summaryRaw.replace("status: complete", "status: \"complete'"));
    result = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.ok(result.errors.some((error) => error.code === "closeout_summary_status_nonterminal"));

    await fs.writeFile(summary, summaryRaw.replace("status: complete", "status: complete\nstatus: complete"));
    result = await checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) });
    assert.ok(result.errors.some((error) => error.code === "closeout_frontmatter_status_duplicate"));

    await fs.writeFile(path.join(meta(root).projectRoot, "head-drift.txt"), "drift\n");
    execFileSync("git", ["add", "head-drift.txt"], { cwd: meta(root).projectRoot });
    execFileSync("git", ["commit", "-m", "head drift"], { cwd: meta(root).projectRoot, stdio: "ignore" });
    await assert.rejects(
      checkPlanningCloseout({ planningRoot: root, milestone: "v3.4", strict: true, ...strictOptions(root) }),
      (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "closeout_live_source_sha_mismatch",
    );
  });

  it("rejects a typoed strict CLI flag instead of silently downgrading", async () => {
    const root = await copyFixture("v3.4-canonical");
    const result = spawnSync(
      process.execPath,
      ["scripts/workflow/planning-closeout.mjs", "check", `--planning-root=${root}`, "--milestone=v3.4", "--strcit"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, "closeout_usage_error");
  });
});
