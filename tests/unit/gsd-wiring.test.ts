import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyGsdHardeningWiring,
  checkGsdHardeningWiring,
} from "../../scripts/workflow/gsd-wiring.mjs";
import { acquireWorkflowLease } from "../../scripts/workflow/workflow-lease.mjs";

const tempDirs = new Set<string>();

async function makeConfig() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-gsd-wiring-")));
  tempDirs.add(root);
  const projectRoot = path.join(root, "project");
  const configPath = path.join(projectRoot, ".planning", "config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        runtime: "codex",
        agent_skills: {
          "gsd-executor": [".codex/skills/nutrition-gen-test"],
        },
      },
      null,
      2,
    )}\n`,
  );
  const skillPath = path.join(projectRoot, ".codex", "skills", "nutrition-planning-proof", "SKILL.md");
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), ".codex", "skills", "nutrition-planning-proof", "SKILL.md"), skillPath);
  const guidancePath = path.join(projectRoot, "docs", "workflow", "planning-proof.md");
  await fs.mkdir(path.dirname(guidancePath), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), "docs", "workflow", "planning-proof.md"), guidancePath);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "Workflow Test"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "workflow@example.invalid"], { cwd: projectRoot });
  execFileSync("git", ["add", "."], { cwd: projectRoot });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: projectRoot });
  const commonDir = path.join(projectRoot, ".git");
  const tokenFile = path.join(root, "private", "token.json");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  await acquireWorkflowLease({
    projectRoot,
    commonDir,
    tokenFile,
    executionRuntime: "codex",
    gsdVersion: "1.7.0",
    modelProfile: "sol-high",
    ttlSeconds: 3600,
  });
  return { root, configPath, projectRoot, commonDir, tokenFile, sourceSha };
}

function writer(fixture: Awaited<ReturnType<typeof makeConfig>>) {
  return {
    projectRoot: fixture.projectRoot,
    commonDir: fixture.commonDir,
    tokenFile: fixture.tokenFile,
    expectedRuntime: "codex" as const,
    sourceSha: fixture.sourceSha,
  };
}

afterEach(async () => {
  for (const root of tempDirs) {
    await fs.rm(root, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("GSD planning-proof wiring", () => {
  it("fails read-only check until both planner roles bind the tracked skill", async () => {
    const fixture = await makeConfig();
    const result = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(result.status, "fail");
    assert.deepEqual(
      result.findings.map((finding) => finding.role).filter(Boolean).sort(),
      ["gsd-plan-checker", "gsd-planner"],
    );
    const config = JSON.parse(await fs.readFile(fixture.configPath, "utf8"));
    assert.deepEqual(Object.keys(config.agent_skills), ["gsd-executor"]);
  });

  it("uses a config-digest CAS and preserves existing role bindings", async () => {
    const fixture = await makeConfig();
    const before = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    const original = await fs.readFile(fixture.configPath, "utf8");

    await assert.rejects(
      applyGsdHardeningWiring({
        configPath: fixture.configPath,
        ...writer(fixture),
        confirmDigest: "0".repeat(64),
      }),
      (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "wiring_confirmation_digest_mismatch",
    );
    assert.equal(await fs.readFile(fixture.configPath, "utf8"), original);

    const applied = await applyGsdHardeningWiring({
      configPath: fixture.configPath,
      ...writer(fixture),
      confirmDigest: before.configSha256,
    });
    assert.equal(applied.changed, true);
    const check = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(check.status, "pass");
    const config = JSON.parse(await fs.readFile(fixture.configPath, "utf8"));
    assert.deepEqual(config.agent_skills["gsd-executor"], [".codex/skills/nutrition-gen-test"]);
    assert.deepEqual(config.agent_skills["gsd-planner"], [".codex/skills/nutrition-planning-proof"]);
    assert.deepEqual(config.agent_skills["gsd-plan-checker"], [".codex/skills/nutrition-planning-proof"]);

    const second = await applyGsdHardeningWiring({
      configPath: fixture.configPath,
      ...writer(fixture),
      confirmDigest: check.configSha256,
    });
    assert.equal(second.changed, false);
  });

  it("rejects extra, duplicate, or non-string values in the closed role bindings", async () => {
    const fixture = await makeConfig();
    const config = JSON.parse(await fs.readFile(fixture.configPath, "utf8"));
    config.agent_skills["gsd-planner"] = [
      ".codex/skills/nutrition-planning-proof",
      ".codex/skills/unreviewed-planner-hook",
    ];
    config.agent_skills["gsd-plan-checker"] = [
      ".codex/skills/nutrition-planning-proof",
      ".codex/skills/nutrition-planning-proof",
    ];
    await fs.writeFile(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`);

    const check = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(check.status, "fail");
    assert.deepEqual(
      check.findings.filter((finding) => finding.code === "wiring_role_binding_not_exact").map((finding) => finding.role).sort(),
      ["gsd-plan-checker", "gsd-planner"],
    );
    await assert.rejects(
      applyGsdHardeningWiring({
        configPath: fixture.configPath,
        ...writer(fixture),
        confirmDigest: check.configSha256,
      }),
      (error: unknown) => (error as Error & { code?: string }).code === "wiring_role_binding_conflict",
    );
  });

  it("pins the worktree skill to the exact tracked 100644 HEAD blob", async () => {
    const fixture = await makeConfig();
    const skillPath = path.join(fixture.projectRoot, ".codex", "skills", "nutrition-planning-proof", "SKILL.md");
    await fs.appendFile(skillPath, "\nUnreviewed local override.\n");
    const tampered = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(tampered.status, "fail");
    assert.ok(tampered.findings.some((finding) => finding.code === "wiring_skill_digest_mismatch"));

    execFileSync("git", ["checkout", "--", ".codex/skills/nutrition-planning-proof/SKILL.md"], { cwd: fixture.projectRoot });
    await fs.chmod(skillPath, 0o755);
    const wrongMode = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(wrongMode.status, "fail");
    assert.ok(wrongMode.findings.some((finding) => finding.code === "wiring_skill_worktree_mode_invalid"));
    await fs.chmod(skillPath, 0o644);

    const hardlinkPath = path.join(fixture.root, "skill-hardlink.md");
    await fs.link(skillPath, hardlinkPath);
    const hardlinked = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(hardlinked.status, "fail");
    assert.ok(hardlinked.findings.some((finding) => finding.code === "wiring_skill_missing_or_unsafe"));
    await fs.unlink(hardlinkPath);

    execFileSync("git", ["rm", "--cached", "-q", ".codex/skills/nutrition-planning-proof/SKILL.md"], { cwd: fixture.projectRoot });
    execFileSync("git", ["commit", "-qm", "remove tracked wiring skill"], { cwd: fixture.projectRoot });
    const untracked = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(untracked.status, "fail");
    assert.ok(untracked.findings.some((finding) => finding.code === "wiring_skill_not_tracked_at_source"));
  });

  it("pins the delegated planning guidance to the exact tracked 100644 HEAD blob", async () => {
    const fixture = await makeConfig();
    const guidancePath = path.join(fixture.projectRoot, "docs", "workflow", "planning-proof.md");
    await fs.appendFile(guidancePath, "\nUnreviewed local guidance override.\n");
    const tampered = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(tampered.status, "fail");
    assert.ok(tampered.findings.some((finding) => finding.code === "wiring_guidance_digest_mismatch"));

    execFileSync("git", ["checkout", "--", "docs/workflow/planning-proof.md"], { cwd: fixture.projectRoot });
    await fs.chmod(guidancePath, 0o755);
    const wrongMode = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(wrongMode.status, "fail");
    assert.ok(wrongMode.findings.some((finding) => finding.code === "wiring_guidance_worktree_mode_invalid"));
    await fs.chmod(guidancePath, 0o644);

    execFileSync("git", ["rm", "--cached", "-q", "docs/workflow/planning-proof.md"], { cwd: fixture.projectRoot });
    execFileSync("git", ["commit", "-qm", "remove tracked planning guidance"], { cwd: fixture.projectRoot });
    const untracked = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(untracked.status, "fail");
    assert.ok(untracked.findings.some((finding) => finding.code === "wiring_guidance_not_tracked_at_source"));
  });

  it("fails closed while a GSD workstream overlay could replace role bindings", async () => {
    const fixture = await makeConfig();
    const before = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    const previous = process.env.GSD_WORKSTREAM;
    process.env.GSD_WORKSTREAM = "unreviewed-overlay";
    try {
      const check = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
      assert.equal(check.status, "fail");
      assert.ok(check.findings.some((finding) => finding.code === "wiring_workstream_override_active"));
      await assert.rejects(
        applyGsdHardeningWiring({
          configPath: fixture.configPath,
          ...writer(fixture),
          confirmDigest: before.configSha256,
        }),
        (error: unknown) => (error as Error & { code?: string }).code === "wiring_workstream_override_active",
      );
    } finally {
      if (previous === undefined) delete process.env.GSD_WORKSTREAM;
      else process.env.GSD_WORKSTREAM = previous;
    }
  });

  it("rejects shared, session-scoped, and standalone workstream namespaces", async () => {
    const fixture = await makeConfig();
    const planningRoot = path.dirname(fixture.configPath);

    await fs.writeFile(path.join(planningRoot, "active-workstream"), "review-bypass\n");
    let check = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.ok(check.findings.some((finding) => finding.code === "wiring_workstream_override_active"));
    await fs.rm(path.join(planningRoot, "active-workstream"));

    const workstreamRoot = path.join(planningRoot, "workstreams", "review-bypass");
    await fs.mkdir(workstreamRoot, { recursive: true });
    await fs.writeFile(path.join(workstreamRoot, "config.json"), '{"agent_skills":{}}\n');
    check = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.ok(check.findings.some((finding) => finding.code === "wiring_workstream_override_active"));
    await fs.rm(path.join(planningRoot, "workstreams"), { recursive: true });

    const planningRealpath = await fs.realpath(planningRoot);
    const projectId = createHash("sha1").update(planningRealpath).digest("hex").slice(0, 16);
    const sessionRoot = path.join(os.tmpdir(), "gsd-workstream-sessions", projectId);
    await fs.mkdir(sessionRoot, { recursive: true });
    await fs.writeFile(path.join(sessionRoot, "codex-thread-test"), "review-bypass\n");
    try {
      check = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
      assert.ok(check.findings.some((finding) => finding.code === "wiring_workstream_override_active"));
    } finally {
      await fs.rm(sessionRoot, { recursive: true, force: true });
    }
  });

  it("ignores Git blob replacement refs when pinning the tracked skill", async () => {
    const fixture = await makeConfig();
    const skillRelative = ".codex/skills/nutrition-planning-proof/SKILL.md";
    const skillPath = path.join(fixture.projectRoot, skillRelative);
    const originalOid = execFileSync("git", ["rev-parse", `HEAD:${skillRelative}`], {
      cwd: fixture.projectRoot,
      encoding: "utf8",
    }).trim();
    const replacement = Buffer.from("malicious replacement skill\n", "utf8");
    const replacementOid = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: fixture.projectRoot,
      input: replacement,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["replace", originalOid, replacementOid], { cwd: fixture.projectRoot });
    await fs.writeFile(skillPath, replacement);

    const check = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    assert.equal(check.status, "fail");
    assert.ok(check.findings.some((finding) => finding.code === "wiring_skill_digest_mismatch"));
  });

  it("detects config and skill A-to-B-to-A evidence mutation during read-only check", async () => {
    const fixture = await makeConfig();
    const initial = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    await applyGsdHardeningWiring({
      configPath: fixture.configPath,
      ...writer(fixture),
      confirmDigest: initial.configSha256,
    });
    const configOriginal = await fs.readFile(fixture.configPath);
    const skillPath = path.join(fixture.projectRoot, ".codex", "skills", "nutrition-planning-proof", "SKILL.md");
    const skillOriginal = await fs.readFile(skillPath);
    const guidancePath = path.join(fixture.projectRoot, "docs", "workflow", "planning-proof.md");
    const guidanceOriginal = await fs.readFile(guidancePath);

    const configChanged = await checkGsdHardeningWiring({
      configPath: fixture.configPath,
      projectRoot: fixture.projectRoot,
      async testCheckpoint(stage: string) {
        assert.equal(stage, "before_final_evidence_check");
        await fs.writeFile(fixture.configPath, Buffer.concat([configOriginal, Buffer.from(" ")]));
        await fs.writeFile(fixture.configPath, configOriginal);
      },
    });
    assert.equal(configChanged.status, "fail");
    assert.ok(configChanged.findings.some((finding) => finding.code === "wiring_evidence_changed_during_check"));

    const skillChanged = await checkGsdHardeningWiring({
      configPath: fixture.configPath,
      projectRoot: fixture.projectRoot,
      async testCheckpoint() {
        await fs.writeFile(skillPath, Buffer.concat([skillOriginal, Buffer.from("\nmutation\n")]));
        await fs.writeFile(skillPath, skillOriginal);
      },
    });
    assert.equal(skillChanged.status, "fail");
    assert.ok(
      skillChanged.findings.some(
        (finding) => finding.code === "wiring_evidence_changed_during_check" && finding.evidence === "skill",
      ),
    );

    const guidanceChanged = await checkGsdHardeningWiring({
      configPath: fixture.configPath,
      projectRoot: fixture.projectRoot,
      async testCheckpoint() {
        await fs.writeFile(guidancePath, Buffer.concat([guidanceOriginal, Buffer.from("\nmutation\n")]));
        await fs.writeFile(guidancePath, guidanceOriginal);
      },
    });
    assert.equal(guidanceChanged.status, "fail");
    assert.ok(
      guidanceChanged.findings.some(
        (finding) => finding.code === "wiring_evidence_changed_during_check" && finding.evidence === "guidance",
      ),
    );
  });

  it("rejects an A-to-B-to-A config mutation before the apply rename", async () => {
    const fixture = await makeConfig();
    const initial = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    await assert.rejects(
      applyGsdHardeningWiring({
        configPath: fixture.configPath,
        ...writer(fixture),
        confirmDigest: initial.configSha256,
        async testCheckpoint(stage: string) {
          if (stage !== "before_apply_compare_and_rename") return;
          const original = await fs.readFile(fixture.configPath);
          await fs.writeFile(fixture.configPath, Buffer.concat([original, Buffer.from(" ")]));
          await fs.writeFile(fixture.configPath, original);
        },
      }),
      (error: unknown) => (error as Error & { code?: string }).code === "wiring_config_changed_during_apply",
    );
  });

  it("rejects a replaced apply temp immediately before rename and preserves the original config", async () => {
    const fixture = await makeConfig();
    const initial = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    const original = await fs.readFile(fixture.configPath);
    await assert.rejects(
      applyGsdHardeningWiring({
        configPath: fixture.configPath,
        ...writer(fixture),
        confirmDigest: initial.configSha256,
        async testCheckpoint(stage: string) {
          if (stage !== "before_apply_compare_and_rename") return;
          const directory = path.dirname(fixture.configPath);
          const name = (await fs.readdir(directory)).find((entry) => entry.startsWith(".config.json.tmp-"));
          assert.ok(name);
          const tempPath = path.join(directory, name);
          const expected = await fs.readFile(tempPath);
          await fs.rm(tempPath);
          await fs.writeFile(tempPath, expected, { mode: 0o600 });
        },
      }),
      (error: unknown) => (error as Error & { code?: string }).code === "wiring_apply_temp_changed",
    );
    assert.deepEqual(await fs.readFile(fixture.configPath), original);
  });

  it("rejects A-to-B-to-A config mutation after apply rename and before final readback", async () => {
    const fixture = await makeConfig();
    const initial = await checkGsdHardeningWiring({ configPath: fixture.configPath, projectRoot: fixture.projectRoot });
    await assert.rejects(
      applyGsdHardeningWiring({
        configPath: fixture.configPath,
        ...writer(fixture),
        confirmDigest: initial.configSha256,
        async testCheckpoint(stage: string) {
          if (stage !== "before_final_readback") return;
          const original = await fs.readFile(fixture.configPath);
          await fs.writeFile(fixture.configPath, Buffer.concat([original, Buffer.from(" ")]));
          await fs.writeFile(fixture.configPath, original);
        },
      }),
      (error: unknown) => (error as Error & { code?: string }).code === "wiring_final_config_readback_mismatch",
    );
  });

  it("rejects an alternate config namespace before creating a writer fence", async () => {
    const fixture = await makeConfig();
    const alternate = path.join(fixture.projectRoot, "alternate-config.json");
    await fs.copyFile(fixture.configPath, alternate);
    await assert.rejects(
      checkGsdHardeningWiring({ configPath: alternate, projectRoot: fixture.projectRoot }),
      (error: unknown) => (error as Error & { code?: string }).code === "workflow_planning_config_override_forbidden",
    );
    await assert.rejects(
      applyGsdHardeningWiring({
        configPath: alternate,
        ...writer(fixture),
        confirmDigest: "0".repeat(64),
      }),
      (error: unknown) => (error as Error & { code?: string }).code === "workflow_planning_config_override_forbidden",
    );
    await assert.rejects(fs.access(path.join(fixture.commonDir, "nutrition-workflow", "writer.lock")));
  });

  it("fails closed for unknown, duplicate, and missing CLI arguments", async () => {
    const fixture = await makeConfig();
    const script = path.resolve("scripts/workflow/gsd-wiring.mjs");
    const cases = [
      ["check", `--config=${fixture.configPath}`, `--project-root=${fixture.projectRoot}`, "--strcit=true"],
      ["check", `--config=${fixture.configPath}`, `--config=${fixture.configPath}`, `--project-root=${fixture.projectRoot}`],
      ["apply", `--config=${fixture.configPath}`, `--project-root=${fixture.projectRoot}`],
    ];
    for (const args of cases) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /"code":"wiring_usage_error"/);
    }
  });
});
