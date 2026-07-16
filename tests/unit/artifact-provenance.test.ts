import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ArtifactProvenanceError,
  checkArtifactProvenance,
  stampArtifactProvenance,
} from "../../scripts/workflow/artifact-provenance.mjs";
import { acquireWorkflowLease, releaseWorkflowLease } from "../../scripts/workflow/workflow-lease.mjs";

const tempDirs = new Set<string>();
function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function receiptPayload(value: Record<string, unknown>) {
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    status: value.status,
    state: value.state,
    artifactKind: value.artifactKind,
    artifactIdentitySha256: value.artifactIdentitySha256,
    artifactBeforeSha256: value.artifactBeforeSha256,
    artifactAfterSha256: value.artifactAfterSha256,
    artifactProvenanceSha256: value.artifactProvenanceSha256,
    artifactProvenanceSignature: value.artifactProvenanceSignature,
    workflowLeaseId: value.workflowLeaseId,
    artifactWorkflowFenceId: value.artifactWorkflowFenceId,
    receiptWorkflowFenceId: value.receiptWorkflowFenceId,
    leaseAttestationSha256: value.leaseAttestationSha256,
    worktreeIdentitySha256: value.worktreeIdentitySha256,
    gitCommonIdentitySha256: value.gitCommonIdentitySha256,
    sourceSha: value.sourceSha,
    executionRuntime: value.executionRuntime,
    gsdVersion: value.gsdVersion,
    modelProfile: value.modelProfile,
  };
}

async function makeFixture(runtime: "codex" | "claude" = "codex") {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-artifact-provenance-"));
  const root = await fs.realpath(created);
  tempDirs.add(root);
  const projectRoot = path.join(root, "project");
  const phase = path.join(projectRoot, ".planning", "phases", "1-fixture");
  const tokenFile = path.join(root, "private", "holder-token.json");
  const receiptRoot = path.join(root, "receipts");
  await fs.mkdir(phase, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: projectRoot });
  spawnSync("git", ["config", "user.name", "Provenance Test"], { cwd: projectRoot });
  spawnSync("git", ["config", "user.email", "provenance@example.invalid"], { cwd: projectRoot });
  await fs.mkdir(path.join(projectRoot, ".planning"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".planning/config.json"), '{"runtime":"codex"}\n');
  const artifacts = ["1-01-PLAN.md", "1-01-SUMMARY.md", "1-VERIFICATION.md"];
  for (const artifact of artifacts) {
    await fs.writeFile(
      path.join(phase, artifact),
      `---\nphase: 1\nstatus: ready\n---\n\n# ${artifact}\n\nSynthetic fixture only.\n`,
      { mode: 0o644 },
    );
  }
  spawnSync("git", ["add", "."], { cwd: projectRoot });
  spawnSync("git", ["commit", "-qm", "fixture"], { cwd: projectRoot });
  const sourceSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).stdout.trim();
  await acquireWorkflowLease({
    projectRoot,
    tokenFile,
    executionRuntime: runtime,
    gsdVersion: "1.7.0",
    modelProfile: runtime === "codex" ? "sol-high" : "claude-sonnet",
    ttlSeconds: 600,
    now: new Date("2026-07-15T00:00:00Z"),
  });
  return { root, projectRoot, phase, commonDir: path.join(projectRoot, ".git"), tokenFile, receiptRoot, artifacts, sourceSha };
}

async function stamp(fixture: Awaited<ReturnType<typeof makeFixture>>, artifact: string, index: number) {
  const artifactPath = path.join(fixture.phase, artifact);
  const raw = await fs.readFile(artifactPath);
  return stampArtifactProvenance({
    projectRoot: fixture.projectRoot,
    tokenFile: fixture.tokenFile,
    artifact: artifactPath,
    expectedRuntime: "codex",
    confirmArtifactSha256: digest(raw),
    receiptPath: path.join(fixture.receiptRoot, `${index}.json`),
    sourceSha: fixture.sourceSha,
    now: new Date("2026-07-15T00:01:00Z"),
  });
}

function check(fixture: Awaited<ReturnType<typeof makeFixture>>, options: Record<string, unknown>) {
  return checkArtifactProvenance({
    projectRoot: fixture.projectRoot,
    expectedSourceSha: fixture.sourceSha,
    ...options,
  });
}

afterEach(async () => {
  for (const root of tempDirs) await fs.rm(root, { recursive: true, force: true });
  tempDirs.clear();
});

describe("workflow artifact runtime provenance", () => {
  it("stamps PLAN/SUMMARY/VERIFICATION from the active lease and emits private immutable receipts", async () => {
    const fixture = await makeFixture();
    const stamped = [];
    for (const [index, artifact] of fixture.artifacts.entries()) stamped.push(await stamp(fixture, artifact, index));
    assert.equal(stamped.every((result) => result.changed && result.receiptCommitted), true);
    assert.equal(stamped.every((result) => result.kind === "workflow_artifact_provenance_stamp"), true);
    assert.equal(Object.hasOwn(stamped[0], "receiptSignature"), false);
    const firstReceipt = stamped[0].receipt;
    assert.ok(firstReceipt);
    assert.equal(firstReceipt.kind, "workflow_artifact_provenance_receipt");
    assert.equal(firstReceipt.status, "pass");
    assert.equal(firstReceipt.state, "committed");
    assert.equal(firstReceipt.receiptSha256, digest(JSON.stringify(receiptPayload(firstReceipt))));

    const checked = await check(fixture, {
      artifacts: fixture.artifacts.map((artifact) => `.planning/phases/1-fixture/${artifact}`),
      receiptPaths: fixture.artifacts.map((_, index) => path.join(fixture.receiptRoot, `${index}.json`)),
      expectedRuntime: "codex",
      expectedGsdVersion: "1.7.0",
    });
    assert.equal(checked.status, "pass");
    assert.deepEqual(checked.records.map((record) => record.artifactKind), ["plan", "summary", "verification"]);

    const receipt = await fs.readFile(path.join(fixture.receiptRoot, "0.json"), "utf8");
    assert.equal(JSON.parse(receipt).state, "committed");
    assert.doesNotMatch(receipt, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(receipt, /holder-token|prompt|Synthetic fixture|tokenSha256/);
    assert.equal((await fs.stat(path.join(fixture.phase, fixture.artifacts[0]))).mode & 0o777, 0o644);
  });

  it("detects body drift, requires both file CAS and prior provenance CAS, then chains a replacement", async () => {
    const fixture = await makeFixture();
    const artifact = fixture.artifacts[0];
    const first = await stamp(fixture, artifact, 0);
    const artifactPath = path.join(fixture.phase, artifact);
    await fs.appendFile(artifactPath, "\nchanged after first writer\n");
    const stale = await check(fixture, {
      artifacts: [`.planning/phases/1-fixture/${artifact}`],
      receiptPaths: [path.join(fixture.receiptRoot, "0.json")],
    });
    assert.equal(stale.findings[0].code, "artifact_payload_stale");

    const changedRaw = await fs.readFile(artifactPath);
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: "0".repeat(64),
        replaceProvenanceSha256: first.artifactProvenanceSha256,
        receiptPath: path.join(fixture.receiptRoot, "wrong-preimage.json"),
        sourceSha: fixture.sourceSha,
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "artifact_preimage_confirmation_mismatch",
    );
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(changedRaw),
        receiptPath: path.join(fixture.receiptRoot, "missing-prior.json"),
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:02:00Z"),
      }),
      (error: unknown) =>
        error instanceof ArtifactProvenanceError && error.code === "artifact_provenance_replace_digest_required",
    );
    const replacement = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(changedRaw),
      replaceProvenanceSha256: first.artifactProvenanceSha256,
      receiptPath: path.join(fixture.receiptRoot, "replacement.json"),
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    assert.notEqual(replacement.artifactProvenanceSha256, first.artifactProvenanceSha256);
    assert.equal(
      (
        await check(fixture, {
          artifacts: [`.planning/phases/1-fixture/${artifact}`],
          receiptPaths: [path.join(fixture.receiptRoot, "replacement.json")],
        })
      ).status,
      "pass",
    );
    assert.match(await fs.readFile(artifactPath, "utf8"), new RegExp(`previous_artifact_provenance_sha256: ${first.artifactProvenanceSha256}`));

    const current = await fs.readFile(artifactPath);
    const idempotent = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(current),
      receiptPath: path.join(fixture.receiptRoot, "unused-idempotent.json"),
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:03:00Z"),
    });
    assert.equal(idempotent.changed, false);
    assert.equal(idempotent.receiptCommitted, true);
    assert.equal(JSON.parse(await fs.readFile(path.join(fixture.receiptRoot, "unused-idempotent.json"), "utf8")).state, "committed");
  });

  it("uses explicit lease identity even when shared config claims another runtime", async () => {
    const fixture = await makeFixture("claude");
    const artifact = fixture.artifacts[1];
    const artifactPath = path.join(fixture.phase, artifact);
    const result = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "claude",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      receiptPath: path.join(fixture.receiptRoot, "claude.json"),
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:01:00Z"),
    });
    assert.equal(result.executionRuntime, "claude");
    const content = await fs.readFile(artifactPath, "utf8");
    assert.match(content, /^execution_runtime: claude$/m);
    assert.doesNotMatch(content, /^execution_runtime: codex$/m);
  });

  it("fails closed for missing provenance, duplicate or quoted provenance keys, and symlinks", async () => {
    const fixture = await makeFixture();
    const missing = await check(fixture, { artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"] });
    assert.equal(missing.findings[0].code, "artifact_provenance_missing");
    await stamp(fixture, fixture.artifacts[0], 0);
    const planPath = path.join(fixture.phase, fixture.artifacts[0]);
    await fs.writeFile(planPath, (await fs.readFile(planPath, "utf8")).replace("execution_runtime: codex", "execution_runtime: codex\nexecution_runtime: codex"));
    const duplicate = await check(fixture, { artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"] });
    assert.equal(duplicate.findings[0].code, "artifact_frontmatter_duplicate_key");

    const summaryPath = path.join(fixture.phase, fixture.artifacts[1]);
    const symlinkPath = path.join(fixture.phase, "1-02-SUMMARY.md");
    await fs.symlink(summaryPath, symlinkPath);
    const unsafe = await check(fixture, { artifacts: [".planning/phases/1-fixture/1-02-SUMMARY.md"] });
    assert.equal(unsafe.findings[0].code, "artifact_missing_or_unsafe");

    const quotedPath = path.join(fixture.phase, fixture.artifacts[1]);
    await fs.writeFile(
      quotedPath,
      (await fs.readFile(quotedPath, "utf8")).replace("status: ready", 'status: ready\n"execution_runtime": codex'),
    );
    const quoted = await check(fixture, {
      artifacts: [".planning/phases/1-fixture/1-01-SUMMARY.md"],
    });
    assert.equal(quoted.findings[0].code, "artifact_frontmatter_unsupported_key_encoding");
  });

  it("reaches and exactly classifies expected runtime and GSD version mismatches", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    const options = {
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
      receiptPaths: [path.join(fixture.receiptRoot, "0.json")],
    };
    const runtime = await check(fixture, { ...options, expectedRuntime: "claude" });
    assert.deepEqual(runtime.findings, [{ artifact: ".planning/phases/1-fixture/1-01-PLAN.md", code: "artifact_runtime_mismatch" }]);
    const version = await check(fixture, { ...options, expectedGsdVersion: "9.9.9" });
    assert.deepEqual(version.findings, [{ artifact: ".planning/phases/1-fixture/1-01-PLAN.md", code: "artifact_gsd_version_mismatch" }]);
  });

  it("offers a deterministic read-only CLI checker", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[2], 0);
    const result = spawnSync(
      process.execPath,
      [
        "scripts/workflow/artifact-provenance.mjs",
        "check",
        `--project-root=${fixture.projectRoot}`,
        "--artifact=.planning/phases/1-fixture/1-VERIFICATION.md",
        `--receipt=${path.join(fixture.receiptRoot, "0.json")}`,
        "--runtime=codex",
        "--gsd-version=1.7.0",
        `--source-sha=${fixture.sourceSha}`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "pass");

    const override = spawnSync(
      process.execPath,
      [
        "scripts/workflow/artifact-provenance.mjs",
        "check",
        `--project-root=${fixture.projectRoot}`,
        `--common-dir=${fixture.commonDir}`,
        "--artifact=.planning/phases/1-fixture/1-VERIFICATION.md",
        `--receipt=${path.join(fixture.receiptRoot, "0.json")}`,
        `--source-sha=${fixture.sourceSha}`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(override.status, 1);
    assert.match(override.stderr, /artifact_provenance_usage_error/);
  });

  it("rejects a symlinked artifact ancestor before reading or replacing an outside file", async () => {
    const fixture = await makeFixture();
    const outside = path.join(fixture.root, "outside");
    const outsideArtifact = path.join(outside, "9-01-PLAN.md");
    const original = "---\nphase: 9\nstatus: ready\n---\n\noutside\n";
    await fs.mkdir(outside);
    await fs.writeFile(outsideArtifact, original);
    await fs.symlink(outside, path.join(fixture.projectRoot, "linked-phase"));
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: "linked-phase/9-01-PLAN.md",
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(original),
        receiptPath: path.join(fixture.receiptRoot, "outside.json"),
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:01:00Z"),
      }),
      (error: unknown) =>
        error instanceof ArtifactProvenanceError && error.code === "workflow_phase_root_missing_or_unsafe",
    );
    assert.equal(await fs.readFile(outsideArtifact, "utf8"), original);
    await assert.rejects(fs.access(path.join(fixture.receiptRoot, "outside.json")));
  });

  it("requires both the Ed25519 lease attestation and committed external receipt", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const withoutReceipt = await check(fixture, {
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
    });
    assert.equal(withoutReceipt.findings[0].code, "provenance_receipt_required");

    let content = await fs.readFile(artifactPath, "utf8");
    const field = (name: string) => content.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1] ?? "";
    content = content.replace(/^execution_runtime: codex$/m, "execution_runtime: claude");
    const forgedPayload = {
      schemaVersion: 1,
      artifactKind: "plan",
      executionRuntime: "claude",
      gsdVersion: field("gsd_version"),
      modelProfile: field("model_profile"),
      workflowLeaseId: field("workflow_lease_id"),
      workflowFenceId: field("workflow_fence_id"),
      sourceSha: field("source_sha"),
      leaseAttestationSha256: field("lease_attestation_sha256"),
      worktreeIdentitySha256: field("worktree_identity_sha256"),
      gitCommonIdentitySha256: field("git_common_identity_sha256"),
      artifactIdentitySha256: field("artifact_identity_sha256"),
      artifactPayloadSha256: field("artifact_payload_sha256"),
      previousArtifactProvenanceSha256: null,
    };
    const forgedDigest = digest(JSON.stringify(forgedPayload));
    content = content.replace(/^artifact_provenance_sha256: .+$/m, `artifact_provenance_sha256: ${forgedDigest}`);
    await fs.writeFile(artifactPath, content);
    const forged = await check(fixture, {
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
      receiptPaths: [path.join(fixture.receiptRoot, "0.json")],
    });
    assert.equal(forged.findings[0].code, "lease_signature_invalid");
  });

  it("rejects cross-path replay of a signed artifact and its receipt", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    await fs.copyFile(path.join(fixture.phase, fixture.artifacts[0]), path.join(fixture.phase, "1-02-PLAN.md"));
    await fs.copyFile(path.join(fixture.receiptRoot, "0.json"), path.join(fixture.receiptRoot, "replay.json"));
    const replay = await check(fixture, {
      artifacts: [".planning/phases/1-fixture/1-02-PLAN.md"],
      receiptPaths: [path.join(fixture.receiptRoot, "replay.json")],
    });
    assert.equal(replay.status, "fail");
    assert.equal(replay.findings[0].code, "artifact_identity_mismatch");
  });

  it("rejects a signed artifact replayed into a linked worktree with the same Git common directory", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    const linkedRoot = path.join(fixture.root, "linked-worktree");
    assert.equal(
      spawnSync("git", ["worktree", "add", "-q", "-b", "linked-proof", linkedRoot, fixture.sourceSha], {
        cwd: fixture.projectRoot,
      }).status,
      0,
    );
    const linkedArtifact = path.join(linkedRoot, ".planning", "phases", "1-fixture", "1-01-PLAN.md");
    await fs.copyFile(path.join(fixture.phase, fixture.artifacts[0]), linkedArtifact);
    const replay = await checkArtifactProvenance({
      projectRoot: linkedRoot,
      expectedSourceSha: fixture.sourceSha,
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
      receiptPaths: [path.join(fixture.receiptRoot, "0.json")],
    });
    assert.equal(replay.status, "fail");
    assert.equal(replay.findings[0].code, "artifact_worktree_identity_mismatch");
  });

  it("rejects signed receipt field tampering even after the attacker recomputes its plain digest", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    const receipt = JSON.parse(await fs.readFile(path.join(fixture.receiptRoot, "0.json"), "utf8"));
    receipt.artifactBeforeSha256 = "f".repeat(64);
    receipt.receiptSha256 = digest(JSON.stringify(receiptPayload(receipt)));
    const tamperedPath = path.join(fixture.receiptRoot, "tampered.json");
    await fs.writeFile(tamperedPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const tampered = await check(fixture, {
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
      receiptPaths: [tamperedPath],
    });
    assert.equal(tampered.status, "fail");
    assert.equal(tampered.findings[0].code, "lease_signature_invalid");
  });

  it("requires the expected source HEAD for both stamp and check", async () => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath: path.join(fixture.receiptRoot, "wrong-source.json"),
        sourceSha: "0".repeat(40),
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "artifact_source_sha_mismatch",
    );
    await assert.rejects(
      checkArtifactProvenance({
        projectRoot: fixture.projectRoot,
        expectedSourceSha: "0".repeat(40),
        artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "artifact_source_sha_mismatch",
    );
  });

  it("verifies predecessor signatures before chaining a replacement", async () => {
    const fixture = await makeFixture();
    const first = await stamp(fixture, fixture.artifacts[0], 0);
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    let content = await fs.readFile(artifactPath, "utf8");
    content = content.replace(/^artifact_provenance_signature: .+$/m, "artifact_provenance_signature: A");
    content += "\nchanged body\n";
    await fs.writeFile(artifactPath, content);
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(content),
        replaceProvenanceSha256: first.artifactProvenanceSha256,
        receiptPath: path.join(fixture.receiptRoot, "forged-predecessor.json"),
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:02:00Z"),
      }),
      (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "lease_signature_invalid",
    );
  });

  it("rejects a symlinked receipt ancestor before creating or reading evidence", async () => {
    const fixture = await makeFixture();
    const outside = path.join(fixture.root, "outside-receipts");
    const linked = path.join(fixture.root, "linked-receipts");
    await fs.mkdir(outside);
    await fs.symlink(outside, linked);
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath: path.join(linked, "unsafe.json"),
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:01:00Z"),
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "provenance_receipt_parent_unsafe",
    );
    await assert.rejects(fs.access(path.join(outside, "unsafe.json")));
  });

  it("rejects physical receipt paths inside the checkout or Git metadata", async (t) => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const base = {
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:01:00Z"),
    };
    await assert.rejects(
      stampArtifactProvenance({
        ...base,
        receiptPath: path.join(fixture.projectRoot, ".git", "forbidden-receipt.json"),
      }),
      (error: unknown) =>
        error instanceof ArtifactProvenanceError && error.code === "provenance_receipt_inside_project",
    );

    const alias = path.join(
      path.dirname(fixture.projectRoot),
      path.basename(fixture.projectRoot).toUpperCase(),
    );
    const physical = await fs.realpath(alias).catch(() => null);
    if (physical !== fixture.projectRoot) {
      t.diagnostic("case-sensitive filesystem: checkout assertion completed");
      return;
    }
    await assert.rejects(
      stampArtifactProvenance({ ...base, receiptPath: path.join(alias, "case-receipt.json") }),
      (error: unknown) =>
        error instanceof ArtifactProvenanceError && error.code === "provenance_receipt_inside_project",
    );
  });

  it("rejects canonical path aliases and physical artifact or receipt reuse", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    await stamp(fixture, fixture.artifacts[1], 1);

    await assert.rejects(
      check(fixture, {
        artifacts: [".planning/phases/1-fixture/1-01-PLAN.md", ".planning/phases/1-fixture/./1-01-PLAN.md"],
        receiptPaths: [path.join(fixture.receiptRoot, "0.json"), path.join(fixture.receiptRoot, "1.json")],
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "artifact_list_duplicate",
    );
    await assert.rejects(
      check(fixture, {
        artifacts: [".planning/phases/1-fixture/1-01-PLAN.md", ".planning/phases/1-fixture/1-01-SUMMARY.md"],
        receiptPaths: [
          path.join(fixture.receiptRoot, "0.json"),
          `${fixture.receiptRoot}/./0.json`,
        ],
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "provenance_receipt_duplicate",
    );

    await fs.link(path.join(fixture.phase, fixture.artifacts[0]), path.join(fixture.phase, "1-02-PLAN.md"));
    const artifactAlias = await check(fixture, {
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md", ".planning/phases/1-fixture/1-02-PLAN.md"],
      receiptPaths: [path.join(fixture.receiptRoot, "0.json")],
    });
    assert.equal(artifactAlias.findings.some((finding) => finding.code === "artifact_inode_duplicate"), true);

    const receiptHardlink = path.join(fixture.receiptRoot, "hardlink.json");
    await fs.link(path.join(fixture.receiptRoot, "0.json"), receiptHardlink);
    const receiptAlias = await check(fixture, {
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md", ".planning/phases/1-fixture/1-01-SUMMARY.md"],
      receiptPaths: [path.join(fixture.receiptRoot, "0.json"), receiptHardlink],
    });
    assert.equal(receiptAlias.findings.some((finding) => finding.code === "provenance_receipt_inode_duplicate"), true);
  });

  it("returns structured reconciliation when receipt preparation sync or cleanup fails", async () => {
    for (const [stage, expectedCode] of [
      ["receipt_prepare_sync", "provenance_receipt_prepare_sync_failed"],
      ["receipt_prepare_temp_cleanup", "provenance_receipt_prepare_cleanup_failed"],
    ] as const) {
      const fixture = await makeFixture();
      const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
      const before = await fs.readFile(artifactPath);
      const receiptPath = path.join(fixture.receiptRoot, `${stage}.json`);
      const result = await stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(before),
        receiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:01:00Z"),
        testFaults: [stage],
      });
      assert.equal(result.status, "needs_reconciliation");
      assert.equal(result.changed, false);
      assert.equal(result.receipt, null);
      assert.equal(result.receiptCommitted, false);
      assert.equal(result.reconciliationCode, expectedCode);
      assert.deepEqual(await fs.readFile(artifactPath), before);
      assert.equal(JSON.parse(await fs.readFile(receiptPath, "utf8")).state, "prepared");

      const retry = await stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:02:00Z"),
      });
      assert.equal(retry.status, "pass");
      assert.equal(retry.receiptCommitted, true);
      assert.equal(retry.recoveryAction, "rolled_back_prepared_receipt");
      assert.equal(
        (
          await check(fixture, {
            artifacts: [`.planning/phases/1-fixture/${fixture.artifacts[0]}`],
            receiptPaths: [receiptPath],
          })
        ).status,
        "pass",
      );
      assert.deepEqual(
        (await fs.readdir(path.dirname(receiptPath))).filter((name) => name.startsWith(`.${path.basename(receiptPath)}.tmp-`)),
        [],
      );
    }
  });

  it("rebinds receipt recovery to the caller-confirmed artifact inode and digest", async () => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const first = await stamp(fixture, fixture.artifacts[0], 0);
    const oldSignedArtifact = await fs.readFile(artifactPath);

    await fs.appendFile(artifactPath, "\nnew payload\n");
    const second = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      replaceProvenanceSha256: first.artifactProvenanceSha256,
      receiptPath: path.join(fixture.receiptRoot, "replacement.json"),
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    assert.equal(second.status, "pass");
    const callerConfirmed = await fs.readFile(artifactPath);

    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(callerConfirmed),
        receiptPath: path.join(fixture.receiptRoot, "0.json"),
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:03:00Z"),
        testCheckpoint: async (stage: string) => {
          if (stage !== "before_receipt_recovery") return;
          const replacement = path.join(fixture.phase, "concurrent-old-signed-artifact");
          await fs.writeFile(replacement, oldSignedArtifact);
          await fs.rename(replacement, artifactPath);
        },
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "artifact_changed_during_stamp",
    );
  });

  it("does not accept an old lease/runtime receipt as current-holder stamping", async () => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    await stamp(fixture, fixture.artifacts[0], 0);
    const oldReceiptPath = path.join(fixture.receiptRoot, "0.json");
    const oldReceipt = await fs.readFile(oldReceiptPath);

    await releaseWorkflowLease({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
    });
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
      executionRuntime: "claude",
      gsdVersion: "1.7.0",
      modelProfile: "claude-sonnet",
      ttlSeconds: 600,
      now: new Date("2026-07-15T00:03:00Z"),
    });

    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "claude",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath: oldReceiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:04:00Z"),
      }),
      (error: unknown) =>
        error instanceof ArtifactProvenanceError && error.code === "provenance_receipt_holder_mismatch",
    );
    assert.deepEqual(await fs.readFile(oldReceiptPath), oldReceipt);
  });

  it("deterministically removes one authenticated orphan artifact temp before retrying", async () => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const receiptPath = path.join(fixture.receiptRoot, "orphan-artifact-temp.json");
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:01:00Z"),
        testFaults: ["artifact_temp_sync"],
      }),
      /injected_artifact_temp_sync/,
    );
    const artifactTempPrefix = `.${path.basename(artifactPath)}.tmp-`;
    assert.equal((await fs.readdir(fixture.phase)).filter((name) => name.startsWith(artifactTempPrefix)).length, 1);
    await assert.rejects(fs.access(receiptPath));

    const retry = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      receiptPath,
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    assert.equal(retry.status, "pass");
    assert.equal(retry.recoveryAction, "removed_orphan_artifact_temp");
    assert.deepEqual((await fs.readdir(fixture.phase)).filter((name) => name.startsWith(artifactTempPrefix)), []);
  });

  it("preserves unauthenticated artifact temps and fails closed", async () => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const orphan = path.join(
      fixture.phase,
      `.${path.basename(artifactPath)}.tmp-00000000-0000-4000-8000-000000000001`,
    );
    await fs.writeFile(orphan, "not a signed planning artifact\n");
    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath: path.join(fixture.receiptRoot, "invalid-orphan.json"),
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:01:00Z"),
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "artifact_temp_recovery_ambiguous",
    );
    assert.equal(await fs.readFile(orphan, "utf8"), "not a signed planning artifact\n");
  });

  it("returns structured reconciliation after artifact or receipt replacement sync failure", async () => {
    for (const [stage, expectedCode] of [
      ["artifact_commit_sync", "artifact_commit_sync_failed"],
      ["receipt_commit_sync", "provenance_receipt_commit_sync_failed"],
    ] as const) {
      const fixture = await makeFixture();
      const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
      const receiptPath = path.join(fixture.receiptRoot, `${stage}.json`);
      const result = await stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:01:00Z"),
        testFaults: [stage],
      });
      assert.equal(result.status, "needs_reconciliation");
      assert.equal(result.changed, true);
      assert.equal(result.receipt, null);
      assert.equal(result.reconciliationCode, expectedCode);
      assert.match(await fs.readFile(artifactPath, "utf8"), /^artifact_provenance_sha256: [0-9a-f]{64}$/m);
      const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
      assert.equal(receipt.state, stage === "artifact_commit_sync" ? "prepared" : "committed");
      assert.equal(result.receiptCommitted, false);

      const retry = await stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:02:00Z"),
      });
      assert.equal(retry.status, "pass");
      assert.equal(retry.changed, false);
      assert.equal(retry.receiptCommitted, true);
      assert.equal(
        retry.recoveryAction,
        stage === "artifact_commit_sync" ? "finalized_prepared_receipt" : "already_committed",
      );
      assert.equal(
        (
          await check(fixture, {
            artifacts: [`.planning/phases/1-fixture/${fixture.artifacts[0]}`],
            receiptPaths: [receiptPath],
          })
        ).status,
        "pass",
      );
      assert.deepEqual(
        (await fs.readdir(path.dirname(receiptPath))).filter((name) => name.startsWith(`.${path.basename(receiptPath)}.tmp-`)),
        [],
      );
    }
  });

  it("rereads the final on-disk artifact and receipt pair before reporting a normal commit pass", async () => {
    for (const changedTarget of ["artifact", "receipt"] as const) {
      const fixture = await makeFixture();
      const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
      const receiptPath = path.join(fixture.receiptRoot, `final-${changedTarget}.json`);
      const result = await stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:01:00Z"),
        testCheckpoint: async (stage: string) => {
          if (stage !== "before_final_pair_validation") return;
          if (changedTarget === "artifact") await fs.appendFile(artifactPath, "\npost-commit artifact drift\n");
          else await fs.appendFile(receiptPath, "\n");
        },
      });
      assert.equal(result.status, "needs_reconciliation");
      assert.equal(result.receiptCommitted, true);
      assert.equal(
        result.reconciliationCode,
        changedTarget === "artifact" ? "provenance_receipt_artifact_mismatch" : "provenance_receipt_changed",
      );
    }
  });

  it("rereads the final pair after recovery publishes a committed receipt", async () => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const receiptPath = path.join(fixture.receiptRoot, "recovery-final-pair.json");
    const interrupted = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      receiptPath,
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:01:00Z"),
      testFaults: ["artifact_commit_sync"],
    });
    assert.equal(interrupted.status, "needs_reconciliation");

    await assert.rejects(
      stampArtifactProvenance({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        artifact: artifactPath,
        expectedRuntime: "codex",
        confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
        receiptPath,
        sourceSha: fixture.sourceSha,
        now: new Date("2026-07-15T00:02:00Z"),
        testCheckpoint: async (stage: string) => {
          if (stage === "before_final_pair_validation") await fs.appendFile(receiptPath, "\n");
        },
      }),
      (error: unknown) => error instanceof ArtifactProvenanceError && error.code === "provenance_receipt_changed",
    );
  });

  it("recovers a preparation temp whose target publication was lost, without touching unrelated hidden files", async () => {
    const fixture = await makeFixture();
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const receiptPath = path.join(fixture.receiptRoot, "lost-publication.json");
    const first = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      receiptPath,
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:01:00Z"),
      testFaults: ["receipt_prepare_sync"],
    });
    assert.equal(first.status, "needs_reconciliation");
    const exactTemps = (await fs.readdir(fixture.receiptRoot)).filter((name) =>
      name.startsWith(`.${path.basename(receiptPath)}.tmp-`),
    );
    assert.equal(exactTemps.length, 1);
    await fs.unlink(receiptPath);
    const unrelated = path.join(fixture.receiptRoot, ".lost-publication.json.notes");
    await fs.writeFile(unrelated, "keep\n");

    const retry = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      receiptPath,
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    assert.equal(retry.status, "pass");
    assert.equal(retry.recoveryAction, "rolled_back_prepared_receipt");
    assert.equal(await fs.readFile(unrelated, "utf8"), "keep\n");
    assert.deepEqual(
      (await fs.readdir(fixture.receiptRoot)).filter((name) => name.startsWith(`.${path.basename(receiptPath)}.tmp-`)),
      [],
    );
  });

  it("finishes a no-op prepared receipt on retry", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
    const receiptPath = path.join(fixture.receiptRoot, "no-op.json");
    const first = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      receiptPath,
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:02:00Z"),
      testFaults: ["receipt_prepare_sync"],
    });
    assert.equal(first.status, "needs_reconciliation");
    const retry = await stampArtifactProvenance({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      artifact: artifactPath,
      expectedRuntime: "codex",
      confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
      receiptPath,
      sourceSha: fixture.sourceSha,
      now: new Date("2026-07-15T00:03:00Z"),
    });
    assert.equal(retry.status, "pass");
    assert.equal(retry.changed, false);
    assert.equal(retry.recoveryAction, "finalized_prepared_receipt");
  });

  it("preserves ambiguous or tampered recovery evidence and fails closed", async () => {
    for (const mode of ["invalid-temp", "multiple-temp", "artifact-neither"] as const) {
      const fixture = await makeFixture();
      const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
      const receiptPath = path.join(fixture.receiptRoot, `${mode}.json`);
      if (mode === "invalid-temp") {
        await fs.mkdir(fixture.receiptRoot, { recursive: true });
        await fs.writeFile(
          path.join(fixture.receiptRoot, `.${path.basename(receiptPath)}.tmp-00000000-0000-4000-8000-000000000001`),
          "not-json\n",
        );
      } else {
        const first = await stampArtifactProvenance({
          projectRoot: fixture.projectRoot,
          tokenFile: fixture.tokenFile,
          artifact: artifactPath,
          expectedRuntime: "codex",
          confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
          receiptPath,
          sourceSha: fixture.sourceSha,
          now: new Date("2026-07-15T00:01:00Z"),
          testFaults: ["receipt_prepare_sync"],
        });
        assert.equal(first.status, "needs_reconciliation");
        if (mode === "multiple-temp") {
          const temp = (await fs.readdir(fixture.receiptRoot)).find((name) =>
            name.startsWith(`.${path.basename(receiptPath)}.tmp-`),
          );
          assert.ok(temp);
          await fs.unlink(receiptPath);
          await fs.link(
            path.join(fixture.receiptRoot, temp),
            path.join(fixture.receiptRoot, `.${path.basename(receiptPath)}.tmp-00000000-0000-4000-8000-000000000002`),
          );
        } else {
          await fs.appendFile(artifactPath, "\nambiguous drift\n");
        }
      }
      const beforeNames = (await fs.readdir(fixture.receiptRoot)).sort();
      await assert.rejects(
        stampArtifactProvenance({
          projectRoot: fixture.projectRoot,
          tokenFile: fixture.tokenFile,
          artifact: artifactPath,
          expectedRuntime: "codex",
          confirmArtifactSha256: digest(await fs.readFile(artifactPath)),
          receiptPath,
          sourceSha: fixture.sourceSha,
          now: new Date("2026-07-15T00:02:00Z"),
        }),
        (error: unknown) =>
          error instanceof ArtifactProvenanceError && error.code === "provenance_receipt_recovery_ambiguous",
      );
      assert.deepEqual((await fs.readdir(fixture.receiptRoot)).sort(), beforeNames);
    }
  });

  it("fails the checker if Git HEAD changes after artifact verification", async () => {
    const fixture = await makeFixture();
    await stamp(fixture, fixture.artifacts[0], 0);
    const result = await checkArtifactProvenance({
      projectRoot: fixture.projectRoot,
      expectedSourceSha: fixture.sourceSha,
      artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
      receiptPaths: [path.join(fixture.receiptRoot, "0.json")],
      testCheckpoint: async (stage: string) => {
        assert.equal(stage, "before_final_source_check");
        await fs.writeFile(path.join(fixture.projectRoot, "head-drift.txt"), "drift\n");
        assert.equal(spawnSync("git", ["add", "head-drift.txt"], { cwd: fixture.projectRoot }).status, 0);
        assert.equal(spawnSync("git", ["commit", "-qm", "move head"], { cwd: fixture.projectRoot }).status, 0);
      },
    });
    assert.equal(result.status, "fail");
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.findings, [{ artifact: "$source", code: "artifact_source_sha_changed_during_check" }]);
  });

  it("invalidates all records if an artifact or receipt changes during the final freshness window", async () => {
    for (const targetKind of ["artifact", "receipt"] as const) {
      const fixture = await makeFixture();
      await stamp(fixture, fixture.artifacts[0], 0);
      const artifactPath = path.join(fixture.phase, fixture.artifacts[0]);
      const receiptPath = path.join(fixture.receiptRoot, "0.json");
      const result = await checkArtifactProvenance({
        projectRoot: fixture.projectRoot,
        expectedSourceSha: fixture.sourceSha,
        artifacts: [".planning/phases/1-fixture/1-01-PLAN.md"],
        receiptPaths: [receiptPath],
        testCheckpoint: async () => {
          if (targetKind === "artifact") await fs.appendFile(artifactPath, "\nchanged during check\n");
          else await fs.appendFile(receiptPath, "\n");
        },
      });
      assert.equal(result.status, "fail");
      assert.deepEqual(result.records, []);
      assert.equal(
        result.findings.some((finding) =>
          finding.code === (targetKind === "artifact" ? "artifact_changed_during_check" : "provenance_receipt_changed_during_check"),
        ),
        true,
      );
    }
  });
});
