import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGsdPilotSeed, GsdPilotSeedError } from "../../scripts/workflow/gsd-pilot-seed.mjs";
import { checkWorkflowState } from "../../scripts/workflow/state-check.mjs";

const roots = new Set<string>();
const PILOT_ID = "GSDP-20260715-01";
const PILOT_BRANCH = "codex/gsd-pilot-test";

async function fixture() {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-gsd-pilot-seed-"));
  const root = await fs.realpath(created);
  roots.add(root);
  const sourceRoot = path.join(root, "source");
  const projectRoot = path.join(root, "pilot");
  await fs.mkdir(sourceRoot);
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.name", "Pilot Test"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.email", "pilot@example.invalid"], { cwd: sourceRoot });
  await fs.writeFile(path.join(sourceRoot, "tracked.txt"), "source\n");
  await fs.copyFile(path.resolve(".gitignore"), path.join(sourceRoot, ".gitignore"));
  await fs.mkdir(path.join(sourceRoot, "tests/fixtures/workflow"), { recursive: true });
  await fs.cp(
    path.resolve("tests/fixtures/workflow/gsd-pilot-seed"),
    path.join(sourceRoot, "tests/fixtures/workflow/gsd-pilot-seed"),
    { recursive: true },
  );
  execFileSync("git", ["add", ".gitignore", "tracked.txt", "tests/fixtures/workflow/gsd-pilot-seed"], { cwd: sourceRoot });
  execFileSync("git", ["commit", "-qm", "seed"], { cwd: sourceRoot });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).trim();
  execFileSync("git", ["clone", "-q", "--no-hardlinks", sourceRoot, projectRoot]);
  execFileSync("git", ["remote", "remove", "origin"], { cwd: projectRoot });
  execFileSync("git", ["checkout", "-qb", PILOT_BRANCH], { cwd: projectRoot });
  await fs.writeFile(
    path.join(projectRoot, ".nutrition-gsd-pilot-root"),
    `${JSON.stringify({ schemaVersion: 1, kind: "nutrition_gsd_pilot_root", pilotId: PILOT_ID, sourceSha })}\n`,
  );
  return { root, sourceRoot, projectRoot, sourceSha };
}

function options(value: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  return {
    projectRoot: value.projectRoot,
    sourceRoot: value.sourceRoot,
    pilotId: PILOT_ID,
    confirmSourceSha: value.sourceSha,
    expectedBranch: PILOT_BRANCH,
    confirm: `CREATE_SYNTHETIC_GSD_PILOT:${PILOT_ID}:999:${value.sourceSha}`,
    ...extra,
  };
}

function rejectsCode(code: string) {
  return (error: unknown) => error instanceof GsdPilotSeedError && error.code === code;
}

afterEach(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
  roots.clear();
});

describe("synthetic GSD pilot seed", () => {
  it("creates one deterministic Phase 999 scratch state that passes the invariant checker", async () => {
    const value = await fixture();
    const receipt = await createGsdPilotSeed(options(value));
    assert.equal(receipt.status, "pass");
    assert.match(receipt.seedManifestSha256, /^[0-9a-f]{64}$/);
    assert.equal(checkWorkflowState(path.join(value.projectRoot, ".planning")).status, "pass");
    assert.equal(
      spawnSync("git", ["check-ignore", "-q", ".planning/STATE.md"], { cwd: value.projectRoot }).status,
      0,
    );
    assert.equal(
      execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: value.projectRoot,
        encoding: "utf8",
      }).trim(),
      "?? .nutrition-gsd-pilot-root",
    );
    const all = await fs.readdir(path.join(value.projectRoot, ".planning"), { recursive: true });
    assert.equal(all.some((entry) => /(^|\D)115(\D|$)|v3\.4\.1/.test(String(entry))), false);
  });

  it("rejects each remote, marker, existing-planning, SHA, branch, and status drift independently", async () => {
    const value = await fixture();
    execFileSync("git", ["remote", "add", "origin", value.sourceRoot], { cwd: value.projectRoot });
    await assert.rejects(createGsdPilotSeed(options(value)), rejectsCode("pilot_remote_present"));
    await assert.rejects(fs.access(path.join(value.projectRoot, ".planning")));

    const marker = await fixture();
    await fs.writeFile(
      path.join(marker.projectRoot, ".nutrition-gsd-pilot-root"),
      `${JSON.stringify({ schemaVersion: 1, kind: "nutrition_gsd_pilot_root", pilotId: "GSDP-20260715-99", sourceSha: marker.sourceSha })}\n`,
    );
    await assert.rejects(createGsdPilotSeed(options(marker)), rejectsCode("pilot_marker_mismatch"));

    const planning = await fixture();
    await fs.mkdir(path.join(planning.projectRoot, ".planning"));
    await assert.rejects(createGsdPilotSeed(options(planning)), rejectsCode("pilot_planning_already_exists"));

    const sha = await fixture();
    execFileSync("git", ["-c", "user.name=Pilot Test", "-c", "user.email=pilot@example.invalid", "commit", "--allow-empty", "-qm", "drift"], {
      cwd: sha.projectRoot,
    });
    await assert.rejects(createGsdPilotSeed(options(sha)), rejectsCode("pilot_project_sha_mismatch"));

    const branch = await fixture();
    await assert.rejects(
      createGsdPilotSeed(options(branch, { expectedBranch: "codex/not-the-approved-branch" })),
      rejectsCode("pilot_project_branch_mismatch"),
    );

    const status = await fixture();
    await fs.writeFile(path.join(status.projectRoot, "unexpected.txt"), "drift\n");
    await assert.rejects(createGsdPilotSeed(options(status)), rejectsCode("pilot_project_status_unexpected"));
  });

  it("rejects a project worktree that shares the source Git common directory", async () => {
    const value = await fixture();
    const shared = path.join(value.root, "shared-worktree");
    execFileSync("git", ["worktree", "add", "-q", "-b", "codex/shared-pilot", shared, value.sourceSha], {
      cwd: value.sourceRoot,
    });
    await fs.writeFile(
      path.join(shared, ".nutrition-gsd-pilot-root"),
      `${JSON.stringify({ schemaVersion: 1, kind: "nutrition_gsd_pilot_root", pilotId: PILOT_ID, sourceSha: value.sourceSha })}\n`,
    );
    await assert.rejects(
      createGsdPilotSeed(options(value, { projectRoot: shared, expectedBranch: "codex/shared-pilot" })),
      rejectsCode("pilot_must_use_independent_git_common_dir"),
    );
  });

  it("requires the disposable project to be a standalone primary clone with no linked worktrees", async () => {
    const linked = await fixture();
    const linkedRoot = path.join(linked.root, "linked-project-worktree");
    execFileSync("git", ["worktree", "add", "-q", "-b", "codex/linked-pilot", linkedRoot, linked.sourceSha], {
      cwd: linked.projectRoot,
    });
    await fs.writeFile(
      path.join(linkedRoot, ".nutrition-gsd-pilot-root"),
      `${JSON.stringify({ schemaVersion: 1, kind: "nutrition_gsd_pilot_root", pilotId: PILOT_ID, sourceSha: linked.sourceSha })}\n`,
    );

    await assert.rejects(
      createGsdPilotSeed(options(linked, { projectRoot: linkedRoot, expectedBranch: "codex/linked-pilot" })),
      rejectsCode("pilot_project_repository_layout_unsafe"),
    );
    await assert.rejects(
      createGsdPilotSeed(options(linked)),
      rejectsCode("pilot_project_repository_layout_unsafe"),
    );
    await assert.rejects(fs.access(path.join(linkedRoot, ".planning")));
    await assert.rejects(fs.access(path.join(linked.projectRoot, ".planning")));
  });

  it("rejects either worktree nested under the other before seed publication", async () => {
    const nestedProject = await fixture();
    const nestedProjectRoot = path.join(nestedProject.sourceRoot, ".worktrees", "pilot");
    await fs.mkdir(path.dirname(nestedProjectRoot), { recursive: true });
    await fs.rename(nestedProject.projectRoot, nestedProjectRoot);
    await assert.rejects(
      createGsdPilotSeed(options(nestedProject, { projectRoot: nestedProjectRoot })),
      rejectsCode("pilot_worktree_paths_overlap"),
    );
    await assert.rejects(fs.access(path.join(nestedProjectRoot, ".planning")));

    const nestedSource = await fixture();
    const nestedSourceRoot = path.join(nestedSource.projectRoot, ".worktrees", "source");
    await fs.mkdir(path.dirname(nestedSourceRoot), { recursive: true });
    await fs.rename(nestedSource.sourceRoot, nestedSourceRoot);
    await assert.rejects(
      createGsdPilotSeed(options(nestedSource, { sourceRoot: nestedSourceRoot })),
      rejectsCode("pilot_worktree_paths_overlap"),
    );
    await assert.rejects(fs.access(path.join(nestedSource.projectRoot, ".planning")));
  });

  it("rejects symlinked declared source and project roots", async () => {
    const sourceAlias = await fixture();
    const aliasedSource = path.join(sourceAlias.root, "source-alias");
    await fs.symlink(sourceAlias.sourceRoot, aliasedSource);
    await assert.rejects(
      createGsdPilotSeed(options(sourceAlias, { sourceRoot: aliasedSource })),
      rejectsCode("pilot_source_root_unsafe"),
    );
    await assert.rejects(fs.access(path.join(sourceAlias.projectRoot, ".planning")));

    const projectAlias = await fixture();
    const aliasedProject = path.join(projectAlias.root, "project-alias");
    await fs.symlink(projectAlias.projectRoot, aliasedProject);
    await assert.rejects(
      createGsdPilotSeed(options(projectAlias, { projectRoot: aliasedProject })),
      rejectsCode("pilot_project_root_unsafe"),
    );
    await assert.rejects(fs.access(path.join(projectAlias.projectRoot, ".planning")));
  });

  it("rejects ambient Git routing before repository or seed side effects", async () => {
    const value = await fixture();
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(value.sourceRoot, ".git");
    try {
      await assert.rejects(createGsdPilotSeed(options(value)), rejectsCode("pilot_git_environment_unsafe"));
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
    await assert.rejects(fs.access(path.join(value.projectRoot, ".planning")));
    await assert.rejects(fs.access(path.join(value.projectRoot, ".nutrition-gsd-pilot-seed.lock")));
  });

  it("rejects a separate project Git directory nested in the other worktree", async () => {
    const value = await fixture();
    await fs.rm(value.projectRoot, { recursive: true, force: true });
    await fs.appendFile(path.join(value.sourceRoot, ".git", "info", "exclude"), "\n.pilot-common/\n");
    const nestedCommonDir = path.join(value.sourceRoot, ".pilot-common");
    execFileSync(
      "git",
      ["clone", "-q", "--no-hardlinks", `--separate-git-dir=${nestedCommonDir}`, value.sourceRoot, value.projectRoot],
    );
    execFileSync("git", ["remote", "remove", "origin"], { cwd: value.projectRoot });
    execFileSync("git", ["checkout", "-qb", PILOT_BRANCH], { cwd: value.projectRoot });
    await fs.writeFile(
      path.join(value.projectRoot, ".nutrition-gsd-pilot-root"),
      `${JSON.stringify({ schemaVersion: 1, kind: "nutrition_gsd_pilot_root", pilotId: PILOT_ID, sourceSha: value.sourceSha })}\n`,
    );

    await assert.rejects(
      createGsdPilotSeed(options(value)),
      rejectsCode("pilot_project_repository_layout_unsafe"),
    );
    await assert.rejects(fs.access(path.join(value.projectRoot, ".planning")));
  });

  it("rejects a dirty source and the removed clean-source bypass", async () => {
    const value = await fixture();
    const seedState = path.join(value.sourceRoot, "tests/fixtures/workflow/gsd-pilot-seed/STATE.md");
    await fs.writeFile(seedState, "uncommitted substitution\n");
    await assert.rejects(createGsdPilotSeed(options(value)), rejectsCode("pilot_source_not_clean"));
    await assert.rejects(
      createGsdPilotSeed(options(value, { requireCleanSource: false })),
      rejectsCode("pilot_seed_scope_override_forbidden"),
    );
  });

  it("pins the approved commit, exact seed path/mode/digest manifest, and final source CAS", async () => {
    const moving = await fixture();
    await assert.rejects(
      createGsdPilotSeed(options(moving, {
        testCheckpoint: async (stage: string) => {
          if (stage !== "before_seed_snapshot") return;
          execFileSync(
            "git",
            ["-c", "user.name=Pilot Test", "-c", "user.email=pilot@example.invalid", "commit", "--allow-empty", "-qm", "moving-head"],
            { cwd: moving.sourceRoot },
          );
        },
      })),
      rejectsCode("pilot_source_changed"),
    );
    await assert.rejects(fs.access(path.join(moving.projectRoot, ".planning")));

    const expanded = await fixture();
    const roguePath = path.join(expanded.sourceRoot, "tests/fixtures/workflow/gsd-pilot-seed/rogue.sh");
    await fs.writeFile(roguePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    execFileSync("git", ["add", roguePath], { cwd: expanded.sourceRoot });
    execFileSync("git", ["-c", "user.name=Pilot Test", "-c", "user.email=pilot@example.invalid", "commit", "-qm", "rogue-seed"], {
      cwd: expanded.sourceRoot,
    });
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: expanded.sourceRoot, encoding: "utf8" }).trim();
    execFileSync("git", ["fetch", "-q", expanded.sourceRoot, sourceSha], { cwd: expanded.projectRoot });
    execFileSync("git", ["reset", "--hard", "-q", sourceSha], { cwd: expanded.projectRoot });
    await fs.writeFile(
      path.join(expanded.projectRoot, ".nutrition-gsd-pilot-root"),
      `${JSON.stringify({ schemaVersion: 1, kind: "nutrition_gsd_pilot_root", pilotId: PILOT_ID, sourceSha })}\n`,
    );
    const updated = { ...expanded, sourceSha };
    await assert.rejects(createGsdPilotSeed(options(updated)), rejectsCode("pilot_seed_manifest_mismatch"));
  });

  it("fails closed and preserves evidence when published planning bytes drift in the final window", async () => {
    const value = await fixture();
    const rogue = path.join(value.projectRoot, ".planning/rogue.txt");
    await assert.rejects(
      createGsdPilotSeed(options(value, {
        testCheckpoint: async (stage: string) => {
          if (stage === "after_seed_publish") await fs.writeFile(rogue, "post-publish drift\n");
        },
      })),
      rejectsCode("pilot_seed_published_fingerprint_changed"),
    );
    assert.equal(await fs.readFile(rogue, "utf8"), "post-publish drift\n");
    await fs.access(path.join(value.projectRoot, ".nutrition-gsd-pilot-seed.lock"));
  });

  it("never overwrites a concurrent planning root at the publication boundary", async () => {
    const value = await fixture();
    const planningRoot = path.join(value.projectRoot, ".planning");
    await assert.rejects(
      createGsdPilotSeed(options(value, {
        testCheckpoint: async (stage: string) => {
          if (stage === "before_seed_publish") await fs.mkdir(planningRoot);
        },
      })),
      rejectsCode("pilot_seed_publish_collision"),
    );
    assert.deepEqual(await fs.readdir(planningRoot), []);
    await assert.rejects(fs.access(path.join(value.projectRoot, ".nutrition-gsd-pilot-seed.lock")));
  });

  it("preserves evidence and the lock when standalone layout drifts in the terminal window", async () => {
    const value = await fixture();
    const escapedWorktree = path.join(value.root, "escaped-pilot-worktree");
    const lockPath = path.join(value.projectRoot, ".nutrition-gsd-pilot-seed.lock");
    await assert.rejects(
      createGsdPilotSeed(options(value, {
        testCheckpoint: async (stage: string) => {
          if (stage !== "before_seed_lock_release") return;
          execFileSync(
            "git",
            ["worktree", "add", "-q", "-b", "codex/escaped-pilot", escapedWorktree, value.sourceSha],
            { cwd: value.projectRoot },
          );
        },
      })),
      rejectsCode("pilot_project_repository_layout_unsafe"),
    );
    assert.equal(checkWorkflowState(path.join(value.projectRoot, ".planning")).status, "pass");
    await fs.access(escapedWorktree);
    await fs.access(lockPath);
  });

  it("preserves the published tree and substituted lock at the terminal release boundary", async () => {
    const value = await fixture();
    const lockPath = path.join(value.projectRoot, ".nutrition-gsd-pilot-seed.lock");
    await assert.rejects(
      createGsdPilotSeed(options(value, {
        testCheckpoint: async (stage: string) => {
          if (stage !== "before_seed_lock_release") return;
          const replacement = `${lockPath}.replacement`;
          await fs.writeFile(replacement, await fs.readFile(lockPath), { mode: 0o600 });
          await fs.rename(replacement, lockPath);
        },
      })),
      rejectsCode("pilot_seed_lock_changed"),
    );
    assert.equal(checkWorkflowState(path.join(value.projectRoot, ".planning")).status, "pass");
    await fs.access(lockPath);
  });

  it("rejects unknown CLI flags", () => {
    const result = spawnSync(process.execPath, ["scripts/workflow/gsd-pilot-seed.mjs", "--strcit=true"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pilot_seed_usage_error/);
  });
});
