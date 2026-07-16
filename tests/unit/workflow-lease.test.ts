import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, createPrivateKey, randomBytes, randomUUID, sign as signBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WorkflowLeaseError,
  acquireWorkflowLease,
  assertWorkflowLeaseHolder,
  getWorkflowLeaseStatus,
  recoverCorruptWorkflowLeaseMutex,
  recoverWorkflowLeaseMutex,
  recoverWorkflowWriterFence,
  releaseWorkflowLease,
  renewWorkflowLease,
  takeoverWorkflowLease,
  workflowTakeoverAuthorizationPayload,
  withWorkflowWriterFence,
} from "../../scripts/workflow/workflow-lease.mjs";

const tempDirs = new Set<string>();
const holder = {
  executionRuntime: "codex",
  gsdVersion: "1.7.0",
  modelProfile: "sol-high",
  ttlSeconds: 300,
} as const;

async function makeFixture() {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-workflow-lease-"));
  const root = await fs.realpath(created);
  tempDirs.add(root);
  const projectRoot = path.join(root, "project");
  await fs.mkdir(projectRoot);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: projectRoot }).status, 0);
  return {
    root,
    projectRoot,
    commonDir: path.join(projectRoot, ".git"),
    tokenFile: path.join(root, "private", "holder-token.json"),
  };
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof WorkflowLeaseError && error.code === code;
}

function taipeiTimestamp(now: Date) {
  return new Date(now.valueOf() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

async function acquireExpiredLeaseFromExitedOwner(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  const moduleUrl = pathToFileURL(path.resolve("scripts/workflow/workflow-lease.mjs")).href;
  const script = `
    import { acquireWorkflowLease } from ${JSON.stringify(moduleUrl)};
    await acquireWorkflowLease(${JSON.stringify({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      executionRuntime: "codex",
      gsdVersion: "1.7.0",
      modelProfile: "sol-high",
      ttlSeconds: 60,
    }).replace(/}$/, ", now: new Date(Date.now() - 120000) }")});
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  return getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
}

async function operatorTakeoverBundle(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  prior: Record<string, any>,
  tokenFile: string,
  reasonCode: "abandoned_session" | "operator_recovery" = "operator_recovery",
) {
  const authorityId = randomUUID();
  const requestId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const authorityFile = path.join(fixture.root, "operator-private", `operator-${authorityId}.json`);
  await fs.mkdir(path.dirname(authorityFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    authorityFile,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "workflow_takeover_operator_authority",
      authorityId,
      secret,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const now = new Date();
  const issuedAt = taipeiTimestamp(new Date(now.valueOf() - 1_000));
  const notAfter = taipeiTimestamp(new Date(now.valueOf() + 30_000));
  const confirm = `TAKEOVER:${prior.leaseId}:${prior.leaseDigest}:${reasonCode}`;
  const payload = workflowTakeoverAuthorizationPayload({
    authorizationMode: "operator_hmac",
    priorLeaseId: prior.leaseId,
    priorLeaseDigest: prior.leaseDigest,
    priorLeaseEvidenceSha256: prior.priorLeaseEvidenceSha256,
    reasonCode,
    confirmation: confirm,
    successorExecutionRuntime: "claude",
    successorGsdVersion: holder.gsdVersion,
    successorModelProfile: holder.modelProfile,
    successorTtlSeconds: holder.ttlSeconds,
    successorCredentialPathSha256: createHash("sha256").update(path.resolve(tokenFile)).digest("hex"),
    issuedAt,
    notAfter,
    successorAcquiredAt: taipeiTimestamp(now),
    authorityId,
    requestId,
  });
  const operatorAuthorization = createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(Buffer.from(JSON.stringify(payload), "utf8"))
    .digest("base64url");
  return {
    commonDir: fixture.commonDir,
    projectRoot: fixture.projectRoot,
    tokenFile,
    ...holder,
    executionRuntime: "claude" as const,
    expectedLeaseId: prior.leaseId,
    expectedLeaseDigest: prior.leaseDigest,
    reasonCode,
    confirm,
    now,
    operatorAuthorityFile: authorityFile,
    operatorRequestId: requestId,
    operatorAuthorization,
    operatorIssuedAt: issuedAt,
    operatorNotAfter: notAfter,
    operatorSuccessorAcquiredAt: taipeiTimestamp(now),
  };
}

afterEach(async () => {
  for (const root of tempDirs) {
    await fs.rm(root, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("workflow single-writer lease", () => {
  it("rejects alternate governance namespaces and nested declared project roots before side effects", async () => {
    const fixture = await makeFixture();
    const alternateCommon = path.join(fixture.root, "alternate-common");
    await assert.rejects(
      getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: alternateCommon }),
      hasCode("workflow_common_dir_override_forbidden"),
    );
    assert.equal(await fs.stat(alternateCommon).catch(() => null), null);

    const nested = path.join(fixture.projectRoot, "nested");
    const insideActualCheckout = path.join(fixture.projectRoot, "private-token.json");
    await fs.mkdir(nested);
    await assert.rejects(
      acquireWorkflowLease({
        projectRoot: nested,
        tokenFile: insideActualCheckout,
        ...holder,
      }),
      hasCode("workflow_project_git_scope_invalid"),
    );
    assert.equal(await fs.stat(insideActualCheckout).catch(() => null), null);
    assert.equal(await fs.stat(path.join(fixture.commonDir, "nutrition-workflow")).catch(() => null), null);
  });

  it("makes linked worktrees contend on the one verified Git-common ledger", async () => {
    const fixture = await makeFixture();
    spawnSync("git", ["config", "user.name", "Lease Test"], { cwd: fixture.projectRoot });
    spawnSync("git", ["config", "user.email", "lease@example.invalid"], { cwd: fixture.projectRoot });
    await fs.writeFile(path.join(fixture.projectRoot, "tracked.txt"), "fixture\n");
    assert.equal(spawnSync("git", ["add", "."], { cwd: fixture.projectRoot }).status, 0);
    assert.equal(spawnSync("git", ["commit", "-qm", "fixture"], { cwd: fixture.projectRoot }).status, 0);
    const linkedRoot = path.join(fixture.root, "linked-worktree");
    assert.equal(spawnSync("git", ["worktree", "add", "-q", "-b", "linked", linkedRoot], { cwd: fixture.projectRoot }).status, 0);

    const acquired = await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const linkedStatus = await getWorkflowLeaseStatus({ projectRoot: linkedRoot });
    assert.equal(linkedStatus.active, true);
    assert.equal(linkedStatus.leaseId, acquired.leaseId);
    await assert.rejects(
      acquireWorkflowLease({
        projectRoot: linkedRoot,
        tokenFile: path.join(fixture.root, "private", "linked-token.json"),
        ...holder,
      }),
      hasCode("workflow_lease_active"),
    );
    await assert.rejects(
      acquireWorkflowLease({
        projectRoot: linkedRoot,
        tokenFile: path.join(fixture.commonDir, "forbidden-token.json"),
        ...holder,
      }),
      hasCode("lease_token_path_inside_git_common_dir"),
    );
  });

  it("acquires exclusively without disclosing token material and releases to immutable history", async () => {
    const fixture = await makeFixture();
    const empty = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir, now: new Date("2026-07-15T00:00:00Z") });
    assert.equal(empty.active, false);
    assert.equal(await fs.stat(path.join(fixture.commonDir, "nutrition-workflow")).catch(() => null), null);

    const acquired = await acquireWorkflowLease({
      commonDir: fixture.commonDir,
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
      now: new Date("2026-07-15T00:00:00Z"),
    });
    assert.equal(acquired.status, "pass");
    const privateToken = JSON.parse(await fs.readFile(fixture.tokenFile, "utf8"));
    assert.equal(JSON.stringify(acquired).includes(privateToken.token), false);
    assert.equal(Object.hasOwn(acquired, "tokenSha256"), false);
    assert.equal(Object.hasOwn(acquired, "tokenFile"), false);
    const tokenStat = await fs.stat(fixture.tokenFile);
    assert.equal(tokenStat.mode & 0o777, 0o600);

    await assert.rejects(
      acquireWorkflowLease({
        commonDir: fixture.commonDir,
        projectRoot: fixture.projectRoot,
        tokenFile: path.join(fixture.root, "other-token.json"),
        ...holder,
      }),
      hasCode("workflow_lease_active"),
    );

    const released = await releaseWorkflowLease({
      commonDir: fixture.commonDir,
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      now: new Date("2026-07-15T00:01:00Z"),
    });
    assert.equal(released.active, false);
    assert.equal(await fs.stat(fixture.tokenFile).catch(() => null), null);
    assert.equal((await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir })).active, false);
    const history = path.join(fixture.commonDir, "nutrition-workflow", `release-${acquired.leaseId}.json`);
    assert.equal((await fs.stat(history)).isFile(), true);
    assert.doesNotMatch(await fs.readFile(history, "utf8"), /token|tokenSha256/i);
    const replayedRelease = await releaseWorkflowLease({
      commonDir: fixture.commonDir,
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      expectedTransitionId: released.transitionId,
    });
    assert.equal(replayedRelease.status, "pass");
    assert.equal(replayedRelease.transitionId, released.transitionId);
    assert.equal(replayedRelease.recoveryAction, "replayed_committed_release");
    const replayedCli = spawnSync(
      process.execPath,
      [
        "scripts/workflow/workflow-lease.mjs",
        "release",
        `--project-root=${fixture.projectRoot}`,
        `--token-file=${fixture.tokenFile}`,
        `--expected-transition-id=${released.transitionId}`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(replayedCli.status, 0, replayedCli.stderr);
    assert.equal(JSON.parse(replayedCli.stdout).recoveryAction, "replayed_committed_release");
  });

  it("requires the bound token and immutable holder identity for renewal", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
      ...holder,
      now: new Date("2026-07-15T00:00:00Z"),
    });
    const leasePath = path.join(fixture.commonDir, "nutrition-workflow", "lease.json");
    const before = await fs.readFile(leasePath, "utf8");
    const wrongToken = path.join(fixture.root, "private", "wrong-token.json");
    const wrongTokenValue = JSON.parse(await fs.readFile(fixture.tokenFile, "utf8"));
    wrongTokenValue.leaseId = crypto.randomUUID();
    await fs.writeFile(
      wrongToken,
      `${JSON.stringify(wrongTokenValue)}\n`,
      { mode: 0o600 },
    );
    await assert.rejects(
      renewWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: wrongToken,
        ...holder,
        now: new Date("2026-07-15T00:01:00Z"),
      }),
      hasCode("lease_token_lease_id_mismatch"),
    );
    await assert.rejects(
      renewWorkflowLease({
        commonDir: fixture.commonDir,
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        ...holder,
        executionRuntime: "claude",
        now: new Date("2026-07-15T00:01:00Z"),
      }),
      hasCode("lease_holder_identity_mismatch"),
    );
    assert.equal(await fs.readFile(leasePath, "utf8"), before);

    const renewed = await renewWorkflowLease({
      commonDir: fixture.commonDir,
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
      now: new Date("2026-07-15T00:01:00Z"),
    });
    assert.equal(renewed.status, "pass");
    assert.equal(
      (await assertWorkflowLeaseHolder({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        expectedRuntime: "codex",
        now: new Date("2026-07-15T00:01:30Z"),
      })).status,
      "pass",
    );
    await assert.rejects(
      renewWorkflowLease({
        commonDir: fixture.commonDir,
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        ...holder,
        now: new Date("2026-07-14T23:59:00Z"),
      }),
      hasCode("lease_time_regression"),
    );
    await assert.rejects(
      renewWorkflowLease({
        commonDir: fixture.commonDir,
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        ...holder,
        now: new Date("2026-07-15T00:07:00Z"),
      }),
      hasCode("workflow_lease_expired"),
    );
  });

  it("rejects token paths inside the project or through a symlinked parent", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      acquireWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: path.join(fixture.projectRoot, "token.json"),
        ...holder,
      }),
      hasCode("lease_token_path_inside_project"),
    );
    assert.equal(await fs.stat(path.join(fixture.commonDir, "nutrition-workflow")).catch(() => null), null);

    const privateDirectory = path.join(fixture.root, "real-private");
    const linkedDirectory = path.join(fixture.root, "linked-private");
    await fs.mkdir(privateDirectory);
    await fs.symlink(privateDirectory, linkedDirectory);
    await assert.rejects(
      acquireWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: path.join(linkedDirectory, "token.json"),
        ...holder,
      }),
      hasCode("lease_token_parent_unsafe"),
    );
  });

  it("rejects a case-folded physical alias into the project when the filesystem supports it", async (t) => {
    const fixture = await makeFixture();
    const alias = path.join(path.dirname(fixture.projectRoot), path.basename(fixture.projectRoot).toUpperCase());
    const physical = await fs.realpath(alias).catch(() => null);
    if (physical !== fixture.projectRoot) {
      t.skip("case-sensitive filesystem");
      return;
    }
    await assert.rejects(
      acquireWorkflowLease({
        projectRoot: fixture.projectRoot,
        tokenFile: path.join(alias, "case-alias-token.json"),
        ...holder,
      }),
      hasCode("lease_token_path_inside_project"),
    );
  });

  it("revalidates private token mode, link count, and designated parent on every holder read", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const holderOptions = {
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      expectedRuntime: "codex",
    };
    await fs.chmod(fixture.tokenFile, 0o644);
    await assert.rejects(assertWorkflowLeaseHolder(holderOptions), hasCode("lease_token_file_unsafe"));
    await fs.chmod(fixture.tokenFile, 0o600);

    const hardlink = path.join(fixture.root, "token-hardlink.json");
    await fs.link(fixture.tokenFile, hardlink);
    await assert.rejects(assertWorkflowLeaseHolder(holderOptions), hasCode("lease_token_file_unsafe"));
    await fs.unlink(hardlink);

    await fs.chmod(path.dirname(fixture.tokenFile), 0o777);
    await assert.rejects(assertWorkflowLeaseHolder(holderOptions), hasCode("lease_token_parent_unsafe"));
    await fs.chmod(path.dirname(fixture.tokenFile), 0o700);
    assert.equal((await assertWorkflowLeaseHolder(holderOptions)).status, "pass");
  });

  it("rejects hardlinked lease and attestation governance records", async () => {
    const fixture = await makeFixture();
    const acquired = await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const governance = path.join(fixture.commonDir, "nutrition-workflow");
    const leaseHardlink = path.join(fixture.root, "lease-hardlink.json");
    await fs.link(path.join(governance, "lease.json"), leaseHardlink);
    await assert.rejects(
      getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot }),
      hasCode("workflow_lease_invalid"),
    );
    await fs.unlink(leaseHardlink);

    const attestationHardlink = path.join(fixture.root, "attestation-hardlink.json");
    await fs.link(
      path.join(governance, "lease-attestations", `${acquired.leaseId}.json`),
      attestationHardlink,
    );
    await assert.rejects(
      assertWorkflowLeaseHolder({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        expectedRuntime: "codex",
      }),
      hasCode("lease_attestation_invalid"),
    );
    await fs.unlink(attestationHardlink);
  });

  it("rejects a group/world-writable governance directory", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const governance = path.join(fixture.commonDir, "nutrition-workflow");
    await fs.chmod(governance, 0o777);
    await assert.rejects(
      getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot }),
      hasCode("workflow_governance_directory_unsafe"),
    );
    await fs.chmod(governance, 0o700);
  });

  it("reports missing or tampered current attestation as not ready", async () => {
    const fixture = await makeFixture();
    const acquired = await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const attestationPath = path.join(
      fixture.commonDir,
      "nutrition-workflow",
      "lease-attestations",
      `${acquired.leaseId}.json`,
    );
    const original = await fs.readFile(attestationPath, "utf8");
    await fs.unlink(attestationPath);
    const missing = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    assert.equal(missing.status, "fail");
    assert.equal(missing.code, "lease_attestation_missing");
    assert.equal(missing.readyForWriter, false);

    await fs.writeFile(attestationPath, original, { mode: 0o600 });
    const tamperedValue = JSON.parse(original);
    tamperedValue.modelProfile = "forged-profile";
    await fs.writeFile(attestationPath, `${JSON.stringify(tamperedValue, null, 2)}\n`, { mode: 0o600 });
    const tampered = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    assert.equal(tampered.status, "fail");
    assert.equal(tampered.code, "lease_attestation_digest_mismatch");
    assert.equal(tampered.readyForWriter, false);
  });

  it("rejects forged legacy-shaped transition history instead of ignoring it", async () => {
    const fixture = await makeFixture();
    const governance = path.join(fixture.commonDir, "nutrition-workflow");
    await fs.mkdir(governance, { recursive: true, mode: 0o700 });
    const forgedId = "44444444-4444-4444-8444-444444444444";
    await fs.writeFile(
      path.join(governance, `release-${forgedId}.json`),
      `${JSON.stringify({ schemaVersion: 1, kind: "workflow_lease_history", state: "committed" })}\n`,
      { mode: 0o600 },
    );
    const status = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    assert.equal(status.status, "fail");
    assert.equal(status.code, "lease_transition_history_invalid");
    assert.equal(status.readyForWriter, false);
  });

  it("rejects ambient Git routing before creating a foreign governance ledger", async () => {
    const fixture = await makeFixture();
    const foreign = path.join(fixture.root, "foreign.git");
    await fs.mkdir(foreign);
    const prior = process.env.GIT_DIR;
    process.env.GIT_DIR = foreign;
    try {
      await assert.rejects(
        acquireWorkflowLease({
          projectRoot: fixture.projectRoot,
          tokenFile: fixture.tokenFile,
          ...holder,
        }),
        hasCode("workflow_git_environment_override_forbidden"),
      );
    } finally {
      if (prior === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prior;
    }
    assert.equal(await fs.stat(path.join(foreign, "nutrition-workflow")).catch(() => null), null);
    assert.equal(await fs.stat(fixture.tokenFile).catch(() => null), null);
  });

  it("prevents a stale token from releasing a successor lease", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir, tokenFile: fixture.tokenFile, ...holder });
    const staleToken = path.join(fixture.root, "stale-token.json");
    await fs.copyFile(fixture.tokenFile, staleToken);
    await releaseWorkflowLease({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir, tokenFile: fixture.tokenFile });

    const successorToken = path.join(fixture.root, "private", "successor-token.json");
    const successor = await acquireWorkflowLease({
      commonDir: fixture.commonDir,
      projectRoot: fixture.projectRoot,
      tokenFile: successorToken,
      ...holder,
    });
    await assert.rejects(
      releaseWorkflowLease({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir, tokenFile: staleToken }),
      hasCode("lease_token_lease_id_mismatch"),
    );
    const status = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir });
    assert.equal(status.leaseId, successor.leaseId);
    assert.equal(status.active, true);
  });

  it("does not auto-steal an expired lease and blocks operator takeover without a durable trust anchor", async () => {
    const fixture = await makeFixture();
    const expired = await acquireExpiredLeaseFromExitedOwner(fixture);
    assert.equal(expired.active, true);
    assert.equal(expired.expired, true);
    await assert.rejects(
      acquireWorkflowLease({
        commonDir: fixture.commonDir,
        projectRoot: fixture.projectRoot,
        tokenFile: path.join(fixture.root, "second-token.json"),
        ...holder,
      }),
      hasCode("workflow_lease_active"),
    );

    const takeoverToken = path.join(fixture.root, "private", "takeover-token.json");
    const takeoverBase = await operatorTakeoverBundle(fixture, expired, takeoverToken);
    await assert.rejects(
      takeoverWorkflowLease({ ...takeoverBase, confirm: "TAKEOVER:wrong" }),
      hasCode("lease_takeover_confirmation_mismatch"),
    );
    await assert.rejects(
      takeoverWorkflowLease({
        ...takeoverBase,
        reasonCode: "runtime_handoff",
        confirm: `TAKEOVER:${expired.leaseId}:${expired.leaseDigest}:runtime_handoff`,
        predecessorTokenFile: fixture.tokenFile,
      }),
      hasCode("lease_takeover_predecessor_lease_expired"),
    );
    await assert.rejects(
      takeoverWorkflowLease(takeoverBase),
      hasCode("lease_operator_takeover_durable_authority_unavailable"),
    );
    await assert.rejects(fs.access(takeoverToken));
    const unchanged = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    assert.equal(unchanged.leaseId, expired.leaseId);
    assert.equal(unchanged.expired, true);
    assert.equal(
      (await fs.readdir(path.join(fixture.commonDir, "nutrition-workflow"))).some((name) => name.startsWith("takeover-")),
      false,
    );
  });

  it("blocks even an exact fresh operator-HMAC takeover through the CLI", async () => {
    const fixture = await makeFixture();
    const expired = await acquireExpiredLeaseFromExitedOwner(fixture);
    const takeoverToken = path.join(fixture.root, "private", "cli-takeover-token.json");
    const takeover = await operatorTakeoverBundle(fixture, expired, takeoverToken, "abandoned_session");
    const result = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/workflow/workflow-lease.mjs"),
        "takeover",
        `--project-root=${fixture.projectRoot}`,
        "--runtime=claude",
        `--gsd-version=${holder.gsdVersion}`,
        `--model-profile=${holder.modelProfile}`,
        `--ttl-seconds=${holder.ttlSeconds}`,
        `--token-file=${takeoverToken}`,
        `--expected-lease-id=${expired.leaseId}`,
        `--expected-lease-digest=${expired.leaseDigest}`,
        "--reason-code=abandoned_session",
        `--confirm=${takeover.confirm}`,
        `--operator-authority-file=${takeover.operatorAuthorityFile}`,
        `--operator-request-id=${takeover.operatorRequestId}`,
        `--operator-authorization=${takeover.operatorAuthorization}`,
        `--operator-issued-at=${takeover.operatorIssuedAt}`,
        `--operator-not-after=${takeover.operatorNotAfter}`,
        `--successor-acquired-at=${takeover.operatorSuccessorAcquiredAt}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout);
    assert.equal(
      JSON.parse(result.stderr).code,
      "lease_operator_takeover_durable_authority_unavailable",
    );
    await assert.rejects(fs.access(takeoverToken));
  });

  it("keeps live owner identity stable across caller timezone changes", async () => {
    const fixture = await makeFixture();
    const priorTz = process.env.TZ;
    process.env.TZ = "Asia/Taipei";
    try {
      await acquireWorkflowLease({
        projectRoot: fixture.projectRoot,
        tokenFile: fixture.tokenFile,
        ...holder,
        ttlSeconds: 60,
        now: new Date(Date.now() - 120_000),
      });
      const expired = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
      process.env.TZ = "UTC";
      const takeover = await operatorTakeoverBundle(
        fixture,
        expired,
        path.join(fixture.root, "private", "timezone-takeover.json"),
      );
      await assert.rejects(takeoverWorkflowLease(takeover), hasCode("lease_takeover_owner_alive"));
    } finally {
      if (priorTz === undefined) delete process.env.TZ;
      else process.env.TZ = priorTz;
    }
  });

  it("durably reconciles every prepared release boundary and blocks status until committed", async () => {
    for (const fault of ["release_after_prepare", "release_after_lease_unlink", "release_after_token_unlink"]) {
      const fixture = await makeFixture();
      const acquired = await acquireWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
        ...holder,
        now: new Date("2026-07-15T00:00:00Z"),
      });
      const interrupted = await releaseWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
        now: new Date("2026-07-15T00:01:00Z"),
        testFaults: [fault],
      });
      assert.equal(interrupted.status, "needs_reconciliation", fault);
      assert.equal(interrupted.transitionAction, "release", fault);
      const blocked = await getWorkflowLeaseStatus({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
      });
      assert.equal(blocked.status, "fail", fault);
      assert.equal(blocked.code, "lease_transition_recovery_required", fault);
      assert.equal(blocked.readyForWriter, false, fault);
      if (fault === "release_after_prepare") {
        assert.equal(blocked.active, true);
        assert.equal((await fs.stat(fixture.tokenFile)).isFile(), true);
      }

      const recovered = await releaseWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
      });
      assert.equal(recovered.status, "pass", fault);
      assert.equal(recovered.transitionId, interrupted.transitionId, fault);
      assert.equal(recovered.cleanupRequired, false, fault);
      const inactive = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir });
      assert.equal(inactive.status, "pass", fault);
      assert.equal(inactive.active, false, fault);
      const directory = path.join(fixture.commonDir, "nutrition-workflow");
      const history = JSON.parse(await fs.readFile(path.join(directory, `release-${acquired.leaseId}.json`), "utf8"));
      assert.equal(history.schemaVersion, 2, fault);
      assert.equal(history.state, "committed", fault);
      assert.equal((await fs.readdir(directory)).some((name) => name.includes(".tmp-")), false, fault);
      assert.equal((await fs.readdir(path.dirname(fixture.tokenFile))).some((name) => name.includes(".tmp-")), false, fault);
      assert.equal(await fs.stat(fixture.tokenFile).catch(() => null), null, fault);
    }
  });

  it("recovers takeover boundaries without deleting credentials after successor CAS", async () => {
    for (const fault of [
      "takeover_after_prepare",
      "takeover_after_token",
      "takeover_after_attestation",
      "takeover_after_lease_replace",
    ]) {
      const fixture = await makeFixture();
      await acquireWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
        ...holder,
      });
      const before = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir });
      const takeoverToken = path.join(fixture.root, "private", "takeover-token.json");
      const takeover = {
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: takeoverToken,
        predecessorTokenFile: fixture.tokenFile,
        ...holder,
        executionRuntime: "claude" as const,
        expectedLeaseId: before.leaseId,
        expectedLeaseDigest: before.leaseDigest,
        reasonCode: "runtime_handoff" as const,
        confirm: `TAKEOVER:${before.leaseId}:${before.leaseDigest}:runtime_handoff`,
      };
      const interrupted = await takeoverWorkflowLease({ ...takeover, testFaults: [fault] });
      assert.equal(interrupted.status, "needs_reconciliation", fault);
      const blocked = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir });
      assert.equal(blocked.status, "fail", fault);
      assert.equal(blocked.code, "lease_transition_recovery_required", fault);
      if (fault === "takeover_after_prepare") {
        assert.equal(blocked.leaseId, before.leaseId);
        assert.equal(await fs.stat(takeoverToken).catch(() => null), null);
      }
      if (fault === "takeover_after_lease_replace") {
        assert.notEqual(blocked.leaseId, before.leaseId);
        const preservedToken = JSON.parse(await fs.readFile(takeoverToken, "utf8"));
        assert.equal(preservedToken.leaseId, blocked.leaseId);
      }

      const recovered = await takeoverWorkflowLease(takeover);
      assert.equal(recovered.status, "pass", fault);
      assert.equal(recovered.cleanupRequired, false, fault);
      if (fault === "takeover_after_prepare") assert.notEqual(recovered.transitionId, interrupted.transitionId);
      else assert.equal(recovered.transitionId, interrupted.transitionId, fault);
      const active = await getWorkflowLeaseStatus({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
      });
      const activeToken = JSON.parse(await fs.readFile(takeoverToken, "utf8"));
      assert.equal(active.status, "pass", `${fault}: ${JSON.stringify(active)}`);
      assert.equal(active.leaseId, recovered.leaseId, fault);
      assert.equal(activeToken.leaseId, recovered.leaseId, fault);
      const entries = await fs.readdir(path.join(fixture.commonDir, "nutrition-workflow"));
      assert.equal(entries.some((name) => name.includes(".tmp-")), false, fault);
      assert.equal((await fs.readdir(path.dirname(takeoverToken))).some((name) => name.includes(".tmp-")), false, fault);
    }
  });

  it("binds transition recovery to exact IDs, digests, reasons, credential paths, and signed bytes", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const before = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir });
    const takeoverToken = path.join(fixture.root, "private", "takeover-token.json");
    const takeover = {
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: takeoverToken,
      predecessorTokenFile: fixture.tokenFile,
      ...holder,
      executionRuntime: "claude" as const,
      expectedLeaseId: before.leaseId,
      expectedLeaseDigest: before.leaseDigest,
      reasonCode: "runtime_handoff" as const,
      confirm: `TAKEOVER:${before.leaseId}:${before.leaseDigest}:runtime_handoff`,
    };
    const interrupted = await takeoverWorkflowLease({ ...takeover, testFaults: ["takeover_after_token"] });
    assert.equal(interrupted.status, "needs_reconciliation");
    await assert.rejects(
      takeoverWorkflowLease({ ...takeover, expectedLeaseId: "11111111-1111-4111-8111-111111111111" }),
      hasCode("lease_takeover_id_mismatch"),
    );
    await assert.rejects(
      takeoverWorkflowLease({ ...takeover, expectedLeaseDigest: "0".repeat(64) }),
      hasCode("lease_takeover_digest_mismatch"),
    );
    await assert.rejects(
      takeoverWorkflowLease({
        ...takeover,
        tokenFile: path.join(fixture.root, "private", "different-token.json"),
      }),
      hasCode("lease_transition_token_path_mismatch"),
    );
    await assert.rejects(
      takeoverWorkflowLease({
        ...takeover,
        reasonCode: "operator_recovery",
        confirm: `TAKEOVER:${before.leaseId}:${before.leaseDigest}:operator_recovery`,
      }),
      hasCode("lease_takeover_reason_mismatch"),
    );
    assert.equal((await takeoverWorkflowLease(takeover)).status, "pass");

    const historyDirectory = path.join(fixture.commonDir, "nutrition-workflow");
    const predecessorAttestation = path.join(
      historyDirectory,
      "lease-attestations",
      `${before.leaseId}.json`,
    );
    const predecessorAttestationRaw = await fs.readFile(predecessorAttestation, "utf8");
    await fs.unlink(predecessorAttestation);
    const missingPredecessorAttestation = await getWorkflowLeaseStatus({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
    });
    assert.equal(missingPredecessorAttestation.status, "fail");
    assert.equal(missingPredecessorAttestation.code, "lease_transition_history_invalid");
    await fs.writeFile(predecessorAttestation, predecessorAttestationRaw, { mode: 0o600 });

    const historyName = (await fs.readdir(historyDirectory)).find((name) => name.startsWith(`takeover-${before.leaseId}-to-`));
    assert.equal(typeof historyName, "string");
    const historyPath = path.join(historyDirectory, historyName!);
    const originalHistory = await fs.readFile(historyPath, "utf8");
    const authorizationTamper = JSON.parse(originalHistory);
    authorizationTamper.takeoverAuthorization.signature =
      `${authorizationTamper.takeoverAuthorization.signature.startsWith("A") ? "B" : "A"}` +
      authorizationTamper.takeoverAuthorization.signature.slice(1);
    await fs.writeFile(historyPath, `${JSON.stringify(authorizationTamper, null, 2)}\n`);
    const authorizationRejected = await getWorkflowLeaseStatus({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
    });
    assert.equal(authorizationRejected.status, "fail");
    assert.equal(authorizationRejected.code, "lease_transition_history_invalid");
    await fs.writeFile(historyPath, originalHistory);

    const history = JSON.parse(originalHistory);
    history.stateAuthorizations.committed =
      `${history.stateAuthorizations.committed.startsWith("A") ? "B" : "A"}` +
      history.stateAuthorizations.committed.slice(1);
    await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
    const tampered = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir });
    assert.equal(tampered.status, "fail");
    assert.equal(tampered.code, "lease_transition_history_invalid");
    assert.equal(tampered.readyForWriter, false);
  });

  it("requires exactly one committed handoff record for an active successor lease", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const before = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    const successorToken = path.join(fixture.root, "private", "ledger-successor.json");
    const takeover = await takeoverWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: successorToken,
      predecessorTokenFile: fixture.tokenFile,
      ...holder,
      executionRuntime: "claude",
      expectedLeaseId: before.leaseId,
      expectedLeaseDigest: before.leaseDigest,
      reasonCode: "runtime_handoff",
      confirm: `TAKEOVER:${before.leaseId}:${before.leaseDigest}:runtime_handoff`,
    });
    assert.equal(takeover.status, "pass");
    const directory = path.join(fixture.commonDir, "nutrition-workflow");
    const historyName = (await fs.readdir(directory)).find((name) =>
      name.startsWith(`takeover-${before.leaseId}-to-${takeover.leaseId}`),
    );
    assert.equal(typeof historyName, "string");
    await fs.unlink(path.join(directory, historyName!));

    const status = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    assert.equal(status.status, "fail");
    assert.equal(status.code, "lease_transition_ledger_incomplete");
    assert.equal(status.readyForWriter, false);
    await assert.rejects(
      assertWorkflowLeaseHolder({
        projectRoot: fixture.projectRoot,
        tokenFile: successorToken,
        expectedRuntime: "claude",
      }),
      hasCode("lease_transition_ledger_incomplete"),
    );
  });

  it("rejects a successor-re-signed operator-HMAC replacement without an independent trust anchor", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    const before = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    const successorToken = path.join(fixture.root, "private", "hmac-forgery-successor.json");
    const takeover = await takeoverWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: successorToken,
      predecessorTokenFile: fixture.tokenFile,
      ...holder,
      executionRuntime: "claude",
      expectedLeaseId: before.leaseId,
      expectedLeaseDigest: before.leaseDigest,
      reasonCode: "runtime_handoff",
      confirm: `TAKEOVER:${before.leaseId}:${before.leaseDigest}:runtime_handoff`,
    });
    assert.equal(takeover.status, "pass");
    const historyPath = path.join(
      fixture.commonDir,
      "nutrition-workflow",
      `takeover-${before.leaseId}-to-${takeover.leaseId}.json`,
    );
    const history = JSON.parse(await fs.readFile(historyPath, "utf8"));
    const authorityId = randomUUID();
    const requestId = randomUUID();
    const operatorPayload = {
      ...history.takeoverAuthorization.payload,
      authorizationMode: "operator_hmac",
      authorityId,
      requestId,
    };
    const forgedAuthorization = randomBytes(32);
    history.takeoverAuthorization = {
      schemaVersion: 1,
      kind: "workflow_lease_takeover_authorization",
      mode: "operator_hmac",
      payload: operatorPayload,
      payloadSha256: createHash("sha256").update(JSON.stringify(operatorPayload)).digest("hex"),
      authorityId,
      authorityRecordSha256: createHash("sha256").update("untrusted-authority").digest("hex"),
      requestId,
      authorizationSignature: forgedAuthorization.toString("base64url"),
      authorizationSha256: createHash("sha256").update(forgedAuthorization).digest("hex"),
    };
    const token = JSON.parse(await fs.readFile(successorToken, "utf8"));
    const successorKey = createPrivateKey({
      key: Buffer.from(token.privateKeyPkcs8, "base64url"),
      type: "pkcs8",
      format: "der",
    });
    const transitionPayload = (state: string) => ({
      schemaVersion: history.schemaVersion,
      kind: history.kind,
      action: history.action,
      state,
      transitionId: history.transitionId,
      preparedAt: history.preparedAt,
      priorLeaseDigest: history.priorLeaseDigest,
      priorLease: history.priorLease,
      successorLeaseDigest: history.successorLeaseDigest,
      successorLease: history.successorLease,
      reasonCode: history.reasonCode,
      credentialPathSha256: history.credentialPathSha256,
      credentialRecordSha256: history.credentialRecordSha256,
      signerLeaseId: history.signerLeaseId,
      signerAttestationSha256: history.signerAttestationSha256,
      takeoverAuthorization: history.takeoverAuthorization,
    });
    for (const state of ["prepared", "committed", "aborted"]) {
      history.stateAuthorizations[state] = signBytes(
        null,
        Buffer.from(JSON.stringify(transitionPayload(state))),
        successorKey,
      ).toString("base64url");
    }
    await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
    const status = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    assert.equal(status.status, "fail");
    assert.equal(status.code, "lease_transition_history_invalid");
    assert.equal(status.readyForWriter, false);
  });

  it("fails inactive status closed when the terminal release history is deleted", async () => {
    const fixture = await makeFixture();
    const acquired = await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
      ...holder,
    });
    await releaseWorkflowLease({
      projectRoot: fixture.projectRoot,
      tokenFile: fixture.tokenFile,
    });
    const directory = path.join(fixture.commonDir, "nutrition-workflow");
    await fs.unlink(path.join(directory, `release-${acquired.leaseId}.json`));
    const status = await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot });
    assert.equal(status.status, "fail");
    assert.equal(status.code, "lease_transition_ledger_incomplete");
    assert.equal(status.active, null);
    assert.equal(status.readyForWriter, false);
  });

  it("fails closed for malformed, oversized, or symlinked lease records", async () => {
    const fixture = await makeFixture();
    const leaseDir = path.join(fixture.commonDir, "nutrition-workflow");
    const leasePath = path.join(leaseDir, "lease.json");
    await fs.mkdir(leaseDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(leasePath, "{not-json\n");
    await assert.rejects(getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir }), hasCode("workflow_lease_invalid"));

    await fs.writeFile(leasePath, "x".repeat(16 * 1024 + 1));
    await assert.rejects(getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir }), hasCode("workflow_lease_invalid"));

    await fs.rm(leasePath);
    const target = path.join(fixture.root, "lease-target.json");
    await fs.writeFile(target, "{}\n");
    await fs.symlink(target, leasePath);
    await assert.rejects(getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir }), hasCode("workflow_lease_invalid"));
  });

  it("keeps release unchanged when receipt inputs are invalid", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
      ...holder,
      now: new Date("2026-07-15T00:00:00Z"),
    });
    const leasePath = path.join(fixture.commonDir, "nutrition-workflow", "lease.json");
    const before = await fs.readFile(leasePath, "utf8");
    await assert.rejects(
      releaseWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
        now: new Date("invalid"),
      }),
      hasCode("lease_time_invalid"),
    );
    assert.equal(await fs.readFile(leasePath, "utf8"), before);
    assert.equal((await fs.stat(fixture.tokenFile)).isFile(), true);
  });

  it("exposes a stale operation mutex and clears it only with exact delayed recovery confirmation", async () => {
    const fixture = await makeFixture();
    const operationDirectory = path.join(fixture.commonDir, "nutrition-workflow");
    const mutexPath = path.join(operationDirectory, "operation.lock");
    const operationId = "11111111-1111-4111-8111-111111111111";
    await fs.mkdir(operationDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      mutexPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "workflow_lease_operation",
          operationId,
          acquiredAt: "2026-07-15T08:00:00.000+08:00",
          recoverAfter: "2026-07-15T08:01:00.000+08:00",
          processId: 999999,
          processFingerprint: "0".repeat(64),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const status = await getWorkflowLeaseStatus({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    assert.equal(status.status, "fail");
    assert.equal(status.active, null);
    assert.equal(status.code, "lease_transition_in_progress");
    await assert.rejects(
      recoverWorkflowLeaseMutex({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        expectedOperationId: operationId,
        expectedOperationDigest: status.operationDigest,
        reasonCode: "operator_recovery",
        confirm: "RECOVER_MUTEX:wrong",
        now: new Date("2026-07-15T00:02:00Z"),
      }),
      hasCode("lease_mutex_recovery_confirmation_mismatch"),
    );
    const recovery = {
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      expectedOperationId: operationId,
      expectedOperationDigest: status.operationDigest,
      reasonCode: "operator_recovery" as const,
      confirm: `RECOVER_MUTEX:${operationId}:${status.operationDigest}:operator_recovery`,
      now: new Date("2026-07-15T00:02:00Z"),
    };
    const recovered = await recoverWorkflowLeaseMutex(recovery);
    assert.equal(recovered.status, "pass");
    const replayed = await recoverWorkflowLeaseMutex(recovery);
    assert.equal(replayed.status, "pass");
    assert.equal(replayed.alreadyRecovered, true);
    const recoveryHistory = path.join(operationDirectory, `operation-recovery-${operationId}.json`);
    const tamperedHistory = JSON.parse(await fs.readFile(recoveryHistory, "utf8"));
    tamperedHistory.unexpected = true;
    await fs.writeFile(recoveryHistory, `${JSON.stringify(tamperedHistory, null, 2)}\n`);
    await assert.rejects(recoverWorkflowLeaseMutex(recovery), hasCode("lease_history_invalid"));
    assert.equal(
      (await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir })).active,
      false,
    );
  });

  it("rejects recovery path components before governance side effects", async () => {
    const fixture = await makeFixture();
    const commonRecovery = {
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      reasonCode: "operator_recovery" as const,
      now: new Date("2026-07-15T00:02:00Z"),
    };
    await assert.rejects(
      recoverWorkflowLeaseMutex({
        ...commonRecovery,
        expectedOperationId: "../../outside",
        expectedOperationDigest: "0".repeat(64),
        confirm: "RECOVER_MUTEX:invalid",
      }),
      hasCode("lease_mutex_recovery_input_invalid"),
    );
    await assert.rejects(
      recoverCorruptWorkflowLeaseMutex({
        ...commonRecovery,
        expectedOperationDigest: "../outside",
        confirm: "RECOVER_CORRUPT_MUTEX:invalid",
      }),
      hasCode("lease_mutex_recovery_input_invalid"),
    );
    await assert.rejects(
      recoverWorkflowWriterFence({
        ...commonRecovery,
        expectedFenceId: "../../outside",
        expectedFenceDigest: "0".repeat(64),
        confirm: "RECOVER_WRITER:invalid",
      }),
      hasCode("writer_fence_recovery_input_invalid"),
    );
    assert.equal(await fs.stat(path.join(fixture.commonDir, "nutrition-workflow")).catch(() => null), null);
    assert.equal(await fs.stat(path.join(fixture.root, "outside.json")).catch(() => null), null);
  });

  it("binds artifact writers to an unexpired holder and rejects CLI flag typos", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
      ...holder,
      now: new Date("2026-07-15T00:00:00Z"),
      ttlSeconds: 60,
    });
    const bound = await assertWorkflowLeaseHolder({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
      expectedRuntime: "codex",
      now: new Date("2026-07-15T00:00:30Z"),
    });
    assert.equal(bound.executionRuntime, "codex");
    await assert.rejects(
      assertWorkflowLeaseHolder({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
        now: new Date("2026-07-15T00:02:00Z"),
      }),
      hasCode("workflow_lease_expired"),
    );

    const cli = spawnSync(
      process.execPath,
      ["scripts/workflow/workflow-lease.mjs", "status", `--project-root=${process.cwd()}`, "--strcit=true"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(cli.status, 1);
    assert.equal(JSON.parse(cli.stderr).code, "lease_usage_error");
  });

  it("allows exactly one concurrent acquisition", async () => {
    const fixture = await makeFixture();
    const attempts = await Promise.allSettled([
      acquireWorkflowLease({
        commonDir: fixture.commonDir,
        projectRoot: fixture.projectRoot,
        tokenFile: path.join(fixture.root, "private", "one.json"),
        ...holder,
      }),
      acquireWorkflowLease({
        commonDir: fixture.commonDir,
        projectRoot: fixture.projectRoot,
        tokenFile: path.join(fixture.root, "private", "two.json"),
        ...holder,
      }),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason instanceof WorkflowLeaseError, true);
    assert.equal(["lease_operation_in_progress", "workflow_lease_active"].includes(rejected.reason.code), true);
  });

  it("holds a lease-bound writer fence across nested work and blocks takeover", async () => {
    const fixture = await makeFixture();
    await acquireWorkflowLease({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      tokenFile: fixture.tokenFile,
      ...holder,
      now: new Date("2026-07-15T00:00:00Z"),
    });
    let enter!: (value: { fenceId: string; nestedEnvironment(): Record<string, string> }) => void;
    let unblock!: () => void;
    const entered = new Promise<{ fenceId: string; nestedEnvironment(): Record<string, string> }>((resolve) => {
      enter = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const operation = withWorkflowWriterFence(
      {
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
        expectedRuntime: "codex",
        purpose: "workflow_command",
        maxDurationSeconds: 120,
        now: new Date("2026-07-15T00:01:00Z"),
      },
      async (context) => {
        enter(context);
        await blocked;
        return context.fenceId;
      },
    );
    const activeFence = await entered;
    const moduleUrl = pathToFileURL(path.resolve("scripts/workflow/workflow-lease.mjs")).href;
    const childProgram = `
      import { withWorkflowWriterFence } from ${JSON.stringify(moduleUrl)};
      try {
        await withWorkflowWriterFence({
          projectRoot: process.env.CHILD_PROJECT_ROOT,
          tokenFile: process.env.CHILD_TOKEN_FILE,
          expectedRuntime: "codex",
          fenceId: process.env.CHILD_FENCE_ID,
          purpose: "artifact_stamp",
          maxDurationSeconds: 30,
          now: new Date("2026-07-15T00:01:10Z"),
        }, async () => "joined");
        process.stdout.write("joined");
      } catch (error) {
        process.stderr.write(JSON.stringify({ code: error?.code ?? "unexpected" }));
        process.exitCode = 1;
      }
    `;
    const childEnv = {
      ...process.env,
      CHILD_PROJECT_ROOT: fixture.projectRoot,
      CHILD_TOKEN_FILE: fixture.tokenFile,
      CHILD_FENCE_ID: activeFence.fenceId,
      NUTRITION_WORKFLOW_FENCE_CAPABILITY: "",
    };
    const unauthorizedNested = spawnSync(process.execPath, ["--input-type=module", "-e", childProgram], {
      cwd: process.cwd(),
      env: childEnv,
      encoding: "utf8",
    });
    assert.equal(unauthorizedNested.status, 1);
    assert.equal(JSON.parse(unauthorizedNested.stderr).code, "workflow_writer_nested_authority_invalid");

    const delegatedNested = spawnSync(process.execPath, ["--input-type=module", "-e", childProgram], {
      cwd: process.cwd(),
      env: { ...childEnv, ...activeFence.nestedEnvironment() },
      encoding: "utf8",
    });
    assert.equal(delegatedNested.status, 0);
    assert.equal(delegatedNested.stdout, "joined");
    const nested = await withWorkflowWriterFence(
      {
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: fixture.tokenFile,
        expectedRuntime: "codex",
        fenceId: activeFence.fenceId,
        purpose: "artifact_stamp",
        maxDurationSeconds: 30,
        now: new Date("2026-07-15T00:01:10Z"),
      },
      async (context) => context.fenceId,
    );
    assert.equal(nested, activeFence.fenceId);
    const status = await getWorkflowLeaseStatus({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      now: new Date("2026-07-15T00:01:10Z"),
    });
    assert.equal(status.writerBlocked, true);
    assert.equal(status.status, "fail");
    assert.equal(status.code, "workflow_writer_active");
    assert.equal(status.readyForWriter, false);
    const takeoverToken = path.join(fixture.root, "private", "blocked-takeover.json");
    await assert.rejects(
      takeoverWorkflowLease({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        tokenFile: takeoverToken,
        predecessorTokenFile: fixture.tokenFile,
        ...holder,
        executionRuntime: "claude",
        expectedLeaseId: status.leaseId,
        expectedLeaseDigest: status.leaseDigest,
        reasonCode: "runtime_handoff",
        confirm: `TAKEOVER:${status.leaseId}:${status.leaseDigest}:runtime_handoff`,
      }),
      hasCode("workflow_writer_active"),
    );
    await assert.rejects(fs.access(takeoverToken));
    unblock();
    assert.equal(await operation, activeFence.fenceId);
    assert.equal(
      (await getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot, commonDir: fixture.commonDir })).writerBlocked,
      false,
    );
  });

  it("recovers only an exact expired writer fence whose owner is gone", async () => {
    const fixture = await makeFixture();
    const directory = path.join(fixture.commonDir, "nutrition-workflow");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const fenceId = "33333333-3333-4333-8333-333333333333";
    await fs.writeFile(
      path.join(directory, "writer.lock"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_writer_fence",
        fenceId,
        leaseId: "44444444-4444-4444-8444-444444444444",
        leaseDigest: "1".repeat(64),
        executionRuntime: "codex",
        purpose: "workflow_command",
        processId: 999999,
        processFingerprint: "2".repeat(64),
        nestedCapabilitySha256: "3".repeat(64),
        acquiredAt: "2026-07-15T08:00:00.000+08:00",
        expiresAt: "2026-07-15T08:01:00.000+08:00",
      }, null, 2)}\n`,
    );
    const status = await getWorkflowLeaseStatus({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    await assert.rejects(
      recoverWorkflowWriterFence({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        expectedFenceId: fenceId,
        expectedFenceDigest: status.writerFenceDigest,
        reasonCode: "operator_recovery",
        confirm: "RECOVER_WRITER:wrong",
        now: new Date("2026-07-15T00:02:00Z"),
      }),
      hasCode("writer_fence_recovery_confirmation_mismatch"),
    );
    const recovery = {
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      expectedFenceId: fenceId,
      expectedFenceDigest: status.writerFenceDigest,
      reasonCode: "operator_recovery" as const,
      confirm: `RECOVER_WRITER:${fenceId}:${status.writerFenceDigest}:operator_recovery`,
      now: new Date("2026-07-15T00:02:00Z"),
    };
    const recovered = await recoverWorkflowWriterFence(recovery);
    assert.equal(recovered.status, "pass");
    assert.equal((await recoverWorkflowWriterFence(recovery)).alreadyRecovered, true);
    const historyPath = path.join(directory, `writer-recovery-${fenceId}.json`);
    const history = JSON.parse(await fs.readFile(historyPath, "utf8"));
    history.unexpected = true;
    await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
    await assert.rejects(recoverWorkflowWriterFence(recovery), hasCode("lease_history_invalid"));
  });

  it("refuses writer recovery while its registered child process group is alive", async () => {
    const fixture = await makeFixture();
    const directory = path.join(fixture.commonDir, "nutrition-workflow");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    const fenceId = "55555555-5555-4555-8555-555555555555";
    const writerPath = path.join(directory, "writer.lock");
    await fs.writeFile(
      writerPath,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_writer_fence",
        fenceId,
        leaseId: "66666666-6666-4666-8666-666666666666",
        leaseDigest: "3".repeat(64),
        executionRuntime: "codex",
        purpose: "workflow_command",
        processId: 999999,
        processFingerprint: "4".repeat(64),
        nestedCapabilitySha256: "5".repeat(64),
        acquiredAt: "2026-07-15T08:00:00.000+08:00",
        expiresAt: "2026-07-15T08:01:00.000+08:00",
        childProcessGroupId: child.pid,
        childProcessGroupRegisteredAt: "2026-07-15T08:00:01.000+08:00",
      }, null, 2)}\n`,
    );
    const status = await getWorkflowLeaseStatus({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    const recovery = {
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      expectedFenceId: fenceId,
      expectedFenceDigest: status.writerFenceDigest,
      reasonCode: "operator_recovery" as const,
      confirm: `RECOVER_WRITER:${fenceId}:${status.writerFenceDigest}:operator_recovery`,
      now: new Date("2026-07-15T00:02:00Z"),
    };
    try {
      await assert.rejects(recoverWorkflowWriterFence(recovery), hasCode("workflow_writer_child_group_alive"));
    } finally {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // The assertion still verifies that a live group blocked recovery.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal((await recoverWorkflowWriterFence(recovery)).status, "pass");
  });

  it("reports a stale corrupt transition lock but never removes it without owner-absence evidence", async () => {
    const fixture = await makeFixture();
    const directory = path.join(fixture.commonDir, "nutrition-workflow");
    const mutex = path.join(directory, "operation.lock");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(mutex, Buffer.alloc(0));
    await fs.utimes(mutex, new Date("2026-07-15T00:00:00Z"), new Date("2026-07-15T00:00:00Z"));
    const mutexHardlink = path.join(fixture.root, "corrupt-mutex-hardlink");
    await fs.link(mutex, mutexHardlink);
    await assert.rejects(
      getWorkflowLeaseStatus({ projectRoot: fixture.projectRoot }),
      hasCode("lease_operation_lock_invalid"),
    );
    await fs.unlink(mutexHardlink);
    const status = await getWorkflowLeaseStatus({
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      now: new Date("2026-07-15T00:02:00Z"),
    });
    assert.equal(status.code, "lease_operation_lock_invalid");
    assert.equal(status.operationByteLength, 0);
    assert.equal(status.corruptMutexRecoveryEligible, false);
    assert.equal(
      status.corruptMutexRecoveryBlockingCode,
      "lease_corrupt_mutex_recovery_owner_evidence_unavailable",
    );
    const recovery = {
      projectRoot: fixture.projectRoot,
      commonDir: fixture.commonDir,
      expectedOperationDigest: status.operationDigest,
      reasonCode: "operator_recovery" as const,
      confirm: `RECOVER_CORRUPT_MUTEX:${status.operationDigest}:operator_recovery`,
      now: new Date("2026-07-15T00:02:00Z"),
    };
    await assert.rejects(
      recoverCorruptWorkflowLeaseMutex(recovery),
      hasCode("lease_corrupt_mutex_recovery_owner_evidence_unavailable"),
    );
    assert.equal((await fs.stat(mutex)).isFile(), true);
    const cli = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/workflow/workflow-lease.mjs"),
        "recover-corrupt-mutex",
        `--project-root=${fixture.projectRoot}`,
        `--expected-operation-digest=${status.operationDigest}`,
        "--reason-code=operator_recovery",
        `--confirm=${recovery.confirm}`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 1, cli.stdout);
    assert.equal(
      JSON.parse(cli.stderr).code,
      "lease_corrupt_mutex_recovery_owner_evidence_unavailable",
    );

    for (const invalid of ["{}\n", '{"schemaVersion":999,"kind":"workflow_lease_operation"}\n']) {
      await fs.writeFile(mutex, invalid);
      await fs.utimes(mutex, new Date("2026-07-15T00:00:00Z"), new Date("2026-07-15T00:00:00Z"));
      const invalidStatus = await getWorkflowLeaseStatus({
        projectRoot: fixture.projectRoot,
        commonDir: fixture.commonDir,
        now: new Date("2026-07-15T00:02:00Z"),
      });
      assert.equal(invalidStatus.code, "lease_operation_lock_invalid");
      await assert.rejects(
        recoverCorruptWorkflowLeaseMutex({
          projectRoot: fixture.projectRoot,
          commonDir: fixture.commonDir,
          expectedOperationDigest: invalidStatus.operationDigest,
          reasonCode: "operator_recovery",
          confirm: `RECOVER_CORRUPT_MUTEX:${invalidStatus.operationDigest}:operator_recovery`,
          now: new Date("2026-07-15T00:02:00Z"),
        }),
        hasCode("lease_corrupt_mutex_recovery_owner_evidence_unavailable"),
      );
      assert.equal((await fs.stat(mutex)).isFile(), true);
    }
    assert.equal(
      (await fs.readdir(directory)).some((name) => name.startsWith("operation-corrupt-recovery-")),
      false,
    );
  });
});
