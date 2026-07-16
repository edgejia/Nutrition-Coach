import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VerificationSealError,
  checkVerificationSeal,
  createVerificationSeal,
  writeVerificationSeal,
} from "../../scripts/workflow/verification-seal.mjs";
import { acquireWorkflowLease } from "../../scripts/workflow/workflow-lease.mjs";

const fixtureRoot = fileURLToPath(new URL("../fixtures/workflow/verification/", import.meta.url));
const inputs = [
  "1-01-SUMMARY.md",
  "1-UAT.md",
  "1-VALIDATION.md",
  "1-VERIFICATION.md",
];
const tempDirs = new Set<string>();

async function copyFixture() {
  const container = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-verification-seal-")));
  tempDirs.add(container);
  const projectRoot = path.join(container, "project");
  const planningRoot = path.join(projectRoot, ".planning");
  const root = path.join(planningRoot, "phases", "1-fixture");
  await fs.mkdir(root, { recursive: true });
  for (const [source, destination] of [
    ["fixture-01-SUMMARY.md", "1-01-SUMMARY.md"],
    ["fixture-UAT.md", "1-UAT.md"],
    ["fixture-VALIDATION.md", "1-VALIDATION.md"],
    ["fixture-VERIFICATION.md", "1-VERIFICATION.md"],
  ]) {
    await fs.copyFile(path.join(fixtureRoot, "phase", source), path.join(root, destination));
  }
  await fs.copyFile(path.join(fixtureRoot, "unrelated.md"), path.join(planningRoot, "unrelated.md"));
  execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "workflow-test@example.invalid"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "Workflow Test"], { cwd: projectRoot });
  execFileSync("git", ["add", "."], { cwd: projectRoot });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectRoot, stdio: "ignore" });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  const commonDir = path.join(projectRoot, ".git");
  const tokenFile = path.join(container, "private", "token.json");
  const lease = await acquireWorkflowLease({
    projectRoot,
    commonDir,
    tokenFile,
    executionRuntime: "codex",
    gsdVersion: "1.7.0",
    modelProfile: "sol-high",
    ttlSeconds: 3600,
  });
  return { container, root, projectRoot, sourceSha, commonDir, tokenFile, leaseId: lease.leaseId };
}

async function makeSeal(fixture: Awaited<ReturnType<typeof copyFixture>>, now: string) {
  return createVerificationSeal({
    root: fixture.root,
    projectRoot: fixture.projectRoot,
    phaseId: "1",
    verifiedSourceSha: fixture.sourceSha,
    executionRuntime: "codex",
    gsdVersion: "1.7.0",
    modelProfile: "sol-high",
    inputs,
    now: new Date(now),
  });
}

function writer(fixture: Awaited<ReturnType<typeof copyFixture>>) {
  return {
    projectRoot: fixture.projectRoot,
    commonDir: fixture.commonDir,
    tokenFile: fixture.tokenFile,
    expectedRuntime: "codex",
  };
}

function checker(fixture: Awaited<ReturnType<typeof copyFixture>>, sealPath: string) {
  return {
    root: fixture.root,
    projectRoot: fixture.projectRoot,
    sealPath,
    expectedPhaseId: "1",
    expectedSourceSha: fixture.sourceSha,
    expectedRuntime: "codex",
    expectedGsdVersion: "1.7.0",
    expectedModelProfile: "sol-high",
    expectedWorkflowLeaseId: fixture.leaseId,
  };
}

afterEach(async () => {
  for (const root of tempDirs) {
    await fs.rm(root, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("verification dependency seal", () => {
  it("fails stale on declared summary/UAT changes but ignores unrelated files", async () => {
    const fixture = await copyFixture();
    const sealPath = "1-SEAL.json";
    const initial = await makeSeal(fixture, "2026-07-15T07:00:00.000Z");
    const initialWrite = await writeVerificationSeal({ root: fixture.root, sealPath, seal: initial, ...writer(fixture) });
    assert.equal((await checkVerificationSeal(checker(fixture, sealPath))).status, "pass");

    await fs.appendFile(path.join(fixture.projectRoot, ".planning", "unrelated.md"), "\nchanged\n");
    assert.equal((await checkVerificationSeal(checker(fixture, sealPath))).status, "pass");

    await fs.appendFile(path.join(fixture.root, "1-01-SUMMARY.md"), "\nmetadata changed\n");
    const staleSummary = await checkVerificationSeal(checker(fixture, sealPath));
    assert.equal(staleSummary.status, "fail");
    assert.equal(staleSummary.code, "stale_verification");
    assert.deepEqual(staleSummary.staleInputs, ["1-01-SUMMARY.md"]);

    const replacement = await makeSeal(fixture, "2026-07-15T07:05:00.000Z");
    assert.notEqual(replacement.evidenceManifestSha256, initial.evidenceManifestSha256);
    await writeVerificationSeal({
      root: fixture.root,
      sealPath,
      seal: replacement,
      replaceDigest: initialWrite.evidenceManifestSha256,
      ...writer(fixture),
    });
    assert.equal((await checkVerificationSeal(checker(fixture, sealPath))).status, "pass");

    await fs.appendFile(path.join(fixture.root, "1-UAT.md"), "\nresult: fail\n");
    const staleUat = await checkVerificationSeal(checker(fixture, sealPath));
    assert.equal(staleUat.code, "stale_verification");
    assert.deepEqual(staleUat.staleInputs, ["1-UAT.md"]);
  });

  it("requires CAS replacement so a rerun cannot overwrite an unexplained verdict", async () => {
    const fixture = await copyFixture();
    const sealPath = "1-SEAL.json";
    const initial = await makeSeal(fixture, "2026-07-15T07:00:00.000Z");
    const initialWrite = await writeVerificationSeal({ root: fixture.root, sealPath, seal: initial, ...writer(fixture) });
    const replacement = await makeSeal(fixture, "2026-07-15T07:05:00.000Z");

    await assert.rejects(
      writeVerificationSeal({ root: fixture.root, sealPath, seal: replacement, ...writer(fixture) }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_replace_digest_required",
    );
    await assert.rejects(
      writeVerificationSeal({ root: fixture.root, sealPath, seal: replacement, replaceDigest: "0".repeat(64), ...writer(fixture) }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_replace_digest_mismatch",
    );
    const persisted = JSON.parse(await fs.readFile(path.join(fixture.root, sealPath), "utf8"));
    assert.equal(persisted.evidenceManifestSha256, initialWrite.evidenceManifestSha256);
  });

  it("refuses a tampered or stale seal before publishing it", async () => {
    const tamperedFixture = await copyFixture();
    const tampered = await makeSeal(tamperedFixture, "2026-07-15T07:00:00.000Z");
    tampered.evidenceManifestSha256 = "0".repeat(64);
    await assert.rejects(
      writeVerificationSeal({ root: tamperedFixture.root, sealPath: "1-SEAL.json", seal: tampered, ...writer(tamperedFixture) }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_manifest_tampered",
    );
    await assert.rejects(fs.access(path.join(tamperedFixture.root, "1-SEAL.json")));

    const staleFixture = await copyFixture();
    const stale = await makeSeal(staleFixture, "2026-07-15T07:00:00.000Z");
    await fs.appendFile(path.join(staleFixture.root, inputs[0]), "\nchanged between create and write\n");
    await assert.rejects(
      writeVerificationSeal({ root: staleFixture.root, sealPath: "1-SEAL.json", seal: stale, ...writer(staleFixture) }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_input_changed_before_write",
    );
    await assert.rejects(fs.access(path.join(staleFixture.root, "1-SEAL.json")));
  });

  it("rejects an alternate phase namespace before acquiring a writer fence", async () => {
    const fixture = await copyFixture();
    const alternate = path.join(fixture.projectRoot, "alternate", "1-fixture");
    await fs.cp(fixture.root, alternate, { recursive: true });
    await assert.rejects(
      createVerificationSeal({
        root: alternate,
        projectRoot: fixture.projectRoot,
        phaseId: "1",
        verifiedSourceSha: fixture.sourceSha,
        executionRuntime: "codex",
        gsdVersion: "1.7.0",
        modelProfile: "sol-high",
        inputs,
      }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "workflow_phase_root_override_forbidden",
    );
    await assert.rejects(fs.access(path.join(fixture.commonDir, "nutrition-workflow", "writer.lock")));
  });

  it("rejects a seal replayed into a linked worktree with the same source and phase path", async () => {
    const fixture = await copyFixture();
    const seal = await makeSeal(fixture, "2026-07-15T07:00:00.000Z");
    await writeVerificationSeal({ root: fixture.root, sealPath: "1-SEAL.json", seal, ...writer(fixture) });
    const linkedRoot = path.join(fixture.container, "linked-worktree");
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked-seal", linkedRoot, fixture.sourceSha], {
      cwd: fixture.projectRoot,
    });
    const linkedPhase = path.join(linkedRoot, ".planning", "phases", "1-fixture");
    await fs.copyFile(path.join(fixture.root, "1-SEAL.json"), path.join(linkedPhase, "1-SEAL.json"));
    const replay = await checkVerificationSeal({
      root: linkedPhase,
      projectRoot: linkedRoot,
      sealPath: "1-SEAL.json",
      expectedPhaseId: "1",
      expectedSourceSha: fixture.sourceSha,
      expectedRuntime: "codex",
      expectedGsdVersion: "1.7.0",
      expectedModelProfile: "sol-high",
      expectedWorkflowLeaseId: fixture.leaseId,
    });
    assert.equal(replay.status, "fail");
    assert.equal(replay.code, "seal_worktree_identity_mismatch");
  });

  it("rejects traversal, duplicate inputs, and symlinks", async () => {
    const fixture = await copyFixture();
    await assert.rejects(
      createVerificationSeal({
        root: fixture.root,
        projectRoot: fixture.projectRoot,
        phaseId: "1",
        verifiedSourceSha: fixture.sourceSha,
        executionRuntime: "codex",
        gsdVersion: "1.7.0",
        modelProfile: "sol-high",
        inputs: ["../outside.md"],
      }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_input_invalid",
    );
    await assert.rejects(
      createVerificationSeal({
        root: fixture.root,
        projectRoot: fixture.projectRoot,
        phaseId: "1",
        verifiedSourceSha: fixture.sourceSha,
        executionRuntime: "codex",
        gsdVersion: "1.7.0",
        modelProfile: "sol-high",
        inputs: [inputs[0], inputs[0]],
      }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_input_duplicate",
    );

    const symlink = path.join(fixture.root, "1-02-SUMMARY.md");
    await fs.symlink(path.join(fixture.root, inputs[0]), symlink);
    await assert.rejects(
      createVerificationSeal({
        root: fixture.root,
        projectRoot: fixture.projectRoot,
        phaseId: "1",
        verifiedSourceSha: fixture.sourceSha,
        executionRuntime: "codex",
        gsdVersion: "1.7.0",
        modelProfile: "sol-high",
        inputs: ["1-02-SUMMARY.md"],
      }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_input_missing_or_unsafe",
    );
  });

  it("provides a read-only CLI checker with deterministic exit status", async () => {
    const fixture = await copyFixture();
    const sealPath = "1-SEAL.json";
    const seal = await makeSeal(fixture, "2026-07-15T07:00:00.000Z");
    await writeVerificationSeal({ root: fixture.root, sealPath, seal, ...writer(fixture) });
    const pass = spawnSync(
      process.execPath,
      [
        "scripts/workflow/verification-seal.mjs",
        "check",
        `--root=${fixture.root}`,
        `--project-root=${fixture.projectRoot}`,
        `--seal=${sealPath}`,
        "--phase=1",
        `--source-sha=${fixture.sourceSha}`,
        "--runtime=codex",
        "--gsd-version=1.7.0",
        "--model-profile=sol-high",
        `--lease-id=${fixture.leaseId}`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(JSON.parse(pass.stdout).code, "verification_fresh");

    await fs.appendFile(path.join(fixture.root, inputs[2]), "\nchanged\n");
    const fail = spawnSync(
      process.execPath,
      [
        "scripts/workflow/verification-seal.mjs",
        "check",
        `--root=${fixture.root}`,
        `--project-root=${fixture.projectRoot}`,
        `--seal=${sealPath}`,
        "--phase=1",
        `--source-sha=${fixture.sourceSha}`,
        "--runtime=codex",
        "--gsd-version=1.7.0",
        "--model-profile=sol-high",
        `--lease-id=${fixture.leaseId}`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(fail.status, 1, fail.stderr);
    assert.equal(JSON.parse(fail.stdout).code, "stale_verification");
  });

  it("fails closed on added dependencies, source drift, and non-closed seal fields", async () => {
    const fixture = await copyFixture();
    const sealPath = "1-SEAL.json";
    const seal = await makeSeal(fixture, "2026-07-15T07:00:00.000Z");
    await writeVerificationSeal({ root: fixture.root, sealPath, seal, ...writer(fixture) });

    await fs.writeFile(path.join(fixture.root, "1-02-SUMMARY.md"), "---\nstatus: complete\n---\n");
    const addedDependency = await checkVerificationSeal(checker(fixture, sealPath));
    assert.equal(addedDependency.status, "fail");
    assert.equal(addedDependency.code, "seal_input_set_mismatch");
    await fs.rm(path.join(fixture.root, "1-02-SUMMARY.md"));

    const persisted = JSON.parse(await fs.readFile(path.join(fixture.root, sealPath), "utf8"));
    persisted.rawOutput = "cookie=session-secret";
    await fs.writeFile(path.join(fixture.root, sealPath), `${JSON.stringify(persisted, null, 2)}\n`);
    const extraTopLevel = await checkVerificationSeal(checker(fixture, sealPath));
    assert.equal(extraTopLevel.code, "seal_schema_invalid");
    delete persisted.rawOutput;
    persisted.inputs[0].unexpected = true;
    await fs.writeFile(path.join(fixture.root, sealPath), `${JSON.stringify(persisted, null, 2)}\n`);
    const extraInputField = await checkVerificationSeal(checker(fixture, sealPath));
    assert.equal(extraInputField.code, "seal_input_schema_invalid");

    await fs.writeFile(path.join(fixture.projectRoot, "source-drift.txt"), "drift\n");
    execFileSync("git", ["add", "source-drift.txt"], { cwd: fixture.projectRoot });
    execFileSync("git", ["commit", "-m", "source drift"], { cwd: fixture.projectRoot, stdio: "ignore" });
    const sourceDrift = await checkVerificationSeal(checker(fixture, sealPath));
    assert.equal(sourceDrift.code, "seal_live_source_sha_mismatch");
  });

  it("uses a strict check CLI and rejects ignored dependency or unknown arguments", async () => {
    const fixture = await copyFixture();
    const script = path.resolve("scripts/workflow/verification-seal.mjs");
    for (const extra of [`--input=${inputs[0]}`, "--unknown=value", "--source-sha="]) {
      const result = spawnSync(
        process.execPath,
        [
          script,
          "check",
          `--root=${fixture.root}`,
          `--project-root=${fixture.projectRoot}`,
          "--seal=1-SEAL.json",
          "--phase=1",
          `--source-sha=${fixture.sourceSha}`,
          "--runtime=codex",
          "--gsd-version=1.7.0",
          "--model-profile=sol-high",
          `--lease-id=${fixture.leaseId}`,
          extra,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stderr).code, "seal_usage_error");
    }
  });

  it("derives signed identity from the holder and requires the checker expectation", async () => {
    const fixture = await copyFixture();
    const sealPath = "1-SEAL.json";
    const draft = await createVerificationSeal({
      root: fixture.root,
      projectRoot: fixture.projectRoot,
      phaseId: "1",
      verifiedSourceSha: fixture.sourceSha,
      executionRuntime: "claude",
      gsdVersion: "9.9.9",
      modelProfile: "caller-spoof",
      inputs,
    });
    await writeVerificationSeal({ root: fixture.root, sealPath, seal: draft, ...writer(fixture) });
    const persisted = JSON.parse(await fs.readFile(path.join(fixture.root, sealPath), "utf8"));
    assert.equal(persisted.schemaVersion, 2);
    assert.equal(persisted.executionRuntime, "codex");
    assert.equal(persisted.gsdVersion, "1.7.0");
    assert.equal(persisted.modelProfile, "sol-high");
    assert.match(persisted.sealSignature, /^[A-Za-z0-9_-]+$/);

    const mismatch = await checkVerificationSeal({ ...checker(fixture, sealPath), expectedModelProfile: "wrong-profile" });
    assert.equal(mismatch.code, "seal_model_profile_mismatch");
    persisted.sealSignature = `${persisted.sealSignature}x`;
    await fs.writeFile(path.join(fixture.root, sealPath), `${JSON.stringify(persisted, null, 2)}\n`);
    const tampered = await checkVerificationSeal(checker(fixture, sealPath));
    assert.equal(tampered.code, "seal_signature_invalid");
  });

  it("fails deterministic write/check races at the final seal-input pair boundary", async () => {
    const writeFixture = await copyFixture();
    const writeDraft = await makeSeal(writeFixture, "2026-07-15T07:00:00.000Z");
    await assert.rejects(
      writeVerificationSeal({
        root: writeFixture.root,
        sealPath: "1-SEAL.json",
        seal: writeDraft,
        ...writer(writeFixture),
        testHook: async (stage: string) => {
          if (stage === "after_seal_publication") {
            await fs.appendFile(path.join(writeFixture.root, inputs[0]), "\nraced after publication\n");
          }
        },
      }),
      (error: unknown) => error instanceof VerificationSealError && error.code === "seal_input_changed_after_write",
    );

    const checkFixture = await copyFixture();
    const checkDraft = await makeSeal(checkFixture, "2026-07-15T07:00:00.000Z");
    await writeVerificationSeal({ root: checkFixture.root, sealPath: "1-SEAL.json", seal: checkDraft, ...writer(checkFixture) });
    const checked = await checkVerificationSeal({
      ...checker(checkFixture, "1-SEAL.json"),
      testHook: async (stage: string) => {
        if (stage === "before_final_pair_check") {
          await fs.appendFile(path.join(checkFixture.root, inputs[1]), "\nraced during check\n");
        }
      },
    });
    assert.equal(checked.status, "fail");
    assert.equal(checked.code, "seal_input_changed_during_check");
  });
});
