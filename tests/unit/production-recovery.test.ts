process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, verify as verifyBytes } from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  RecoveryError,
  assessRecoveryState,
  createRecoveryBackup,
  verifyRecoveryBackup,
} from "../../scripts/workflow/production-recovery.mjs";

const SOURCE_SHA = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const RUNTIME_SHA = "b".repeat(40);
const BACKUP_ID = "20260715t120000z-pre-r05-aaaaaaaa";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const tempDirs = new Set<string>();
const servers = new Set<http.Server>();

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, canonicalJsonValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

async function makeFixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-recovery-unit-")));
  tempDirs.add(root);
  const dbPath = path.join(root, "live", "nutrition.db");
  const assetsDir = path.join(root, "live", "assets");
  const uploadsDir = path.join(root, "live", "uploads");
  const backupRoot = path.join(root, "backups");
  const keyRoot = path.join(root, "keys");
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.mkdir(path.join(assetsDir, "nested"), { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(backupRoot, { mode: 0o700 });
  await fs.mkdir(keyRoot, { recursive: true });
  await fs.writeFile(path.join(assetsDir, "nested", "private-photo.bin"), "asset-sentinel");
  await fs.writeFile(path.join(uploadsDir, "request.tmp"), "upload-sentinel");

  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    for (const table of [
      "devices",
      "meals",
      "chat_messages",
      "assets",
      "meal_transactions",
      "meal_revisions",
      "chat_meal_receipts",
      "chat_mutation_outcomes",
      "chat_proposal_cards",
      "chat_proposal_action_events",
      "meal_revision_items",
      "asset_references",
      "turn_states",
    ]) {
      sqlite.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY)`);
    }
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )`);
    sqlite.prepare('INSERT INTO "devices" (id) VALUES (?)').run("private-device-row");
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
      .run("private-migration-hash", 1);
  } finally {
    sqlite.close();
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const attestationPrivateKeyPath = path.join(keyRoot, "recovery-private.pem");
  const attestationPublicKeyPath = path.join(keyRoot, "recovery-public.pem");
  await fs.writeFile(attestationPrivateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await fs.writeFile(attestationPublicKeyPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const expectedAttestationPublicKeySha256 = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const server = http.createServer((request, response) => {
    if (request.url !== "/api/runtime-provenance") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ sourceSha: RUNTIME_SHA }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.add(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const runtimeProvenanceOrigin = `http://127.0.0.1:${address.port}`;

  return {
    root,
    dbPath,
    assetsDir,
    uploadsDir,
    backupRoot,
    runtimeProvenanceOrigin,
    attestationPrivateKeyPath,
    attestationPublicKeyPath,
    expectedAttestationPublicKeySha256,
  };
}

async function createBackup(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  extra: Partial<Parameters<typeof createRecoveryBackup>[0]> = {},
) {
  return createRecoveryBackup({
    checkoutRoot: process.cwd(),
    dbPath: fixture.dbPath,
    assetsDir: fixture.assetsDir,
    uploadsDir: fixture.uploadsDir,
    backupRoot: fixture.backupRoot,
    backupId: BACKUP_ID,
    intendedSourceSha: SOURCE_SHA,
    preRefreshRuntimeSha: RUNTIME_SHA,
    scope: "non-production",
    quiesced: true,
    runtimeProvenanceOrigin: fixture.runtimeProvenanceOrigin,
    attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
    attestationPublicKeyPath: fixture.attestationPublicKeyPath,
    expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
    now: new Date("2026-07-15T04:00:00.000Z"),
    ...extra,
  });
}

function backupEvidence(backup: Awaited<ReturnType<typeof createRecoveryBackup>>) {
  return {
    expectedPrivateManifestSha256: backup.receipt.privateManifestSha256 as string,
    expectedBackupBundleSha256: backup.receipt.backupBundleSha256 as string,
  };
}

async function receiptSignatureIsValid(receipt: Record<string, unknown>, publicKeyPath: string) {
  const { receiptSignature, ...payload } = receipt;
  assert.ok(typeof receiptSignature === "string");
  const publicKey = createPublicKey(await fs.readFile(publicKeyPath));
  return verifyBytes(
    null,
    Buffer.from(JSON.stringify(canonicalJsonValue(payload)), "utf8"),
    publicKey,
    Buffer.from(receiptSignature, "base64url"),
  );
}

function assessmentOptions(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  backup: Awaited<ReturnType<typeof createRecoveryBackup>>,
) {
  return {
    checkoutRoot: process.cwd(),
    backupDir: backup.backupDir,
    backupId: BACKUP_ID,
    intendedSourceSha: SOURCE_SHA,
    preRefreshRuntimeSha: RUNTIME_SHA,
    scope: "non-production" as const,
    requestId: REQUEST_ID,
    dbPath: fixture.dbPath,
    assetsDir: fixture.assetsDir,
    uploadsDir: fixture.uploadsDir,
    runtimeStopped: true,
    ...backupEvidence(backup),
    attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
    attestationPublicKeyPath: fixture.attestationPublicKeyPath,
    expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
  };
}

afterEach(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
  servers.clear();
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("production recovery backup contract", () => {
  it("creates an integrity-bound private manifest and a metadata-only public receipt", async () => {
    const fixture = await makeFixture();
    const result = await createBackup(fixture);

    assert.equal(result.receipt.schemaVersion, 2);
    assert.equal(result.receipt.kind, "production_storage_backup");
    assert.equal(result.receipt.scope, "non-production");
    assert.equal(result.receipt.backupId, BACKUP_ID);
    assert.equal(result.receipt.observedAt, "2026-07-15T12:00:00.000+08:00");
    assert.equal(result.receipt.intendedSourceSha, SOURCE_SHA);
    assert.equal(result.receipt.preRefreshRuntimeSha, RUNTIME_SHA);
    assert.equal(result.receipt.restoreReady, true);
    assert.equal(result.receipt.publishedDurably, true);
    assert.equal(result.receipt.checkoutSourceVerified, true);
    assert.equal(result.receipt.runtimeProvenanceVerified, true);
    assert.equal(result.receipt.attestationPublicKeySha256, fixture.expectedAttestationPublicKeySha256);
    assert.match(result.receipt.privateManifestSha256, /^[0-9a-f]{64}$/);
    assert.match(result.receipt.privateManifestSignature, /^[A-Za-z0-9_-]+$/);
    assert.match(result.receipt.receiptSignature, /^[A-Za-z0-9_-]+$/);
    assert.equal(await receiptSignatureIsValid(result.receipt, fixture.attestationPublicKeyPath), true);
    assert.equal((await fs.stat(path.join(result.backupDir, "database.sqlite"))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(result.backupDir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(result.backupDir, "private-manifest.json"))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(result.backupDir, "assets"))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(result.backupDir, "assets", "nested", "private-photo.bin"))).mode & 0o777, 0o600);

    const serialized = JSON.stringify(result.receipt);
    for (const forbidden of [
      fixture.root,
      "private-photo.bin",
      "request.tmp",
      "private-device-row",
      "private-migration-hash",
      "asset-sentinel",
      "upload-sentinel",
      "sha256",
      "durableTableCounts",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    const verification = await verifyRecoveryBackup({
      checkoutRoot: process.cwd(),
      backupDir: result.backupDir,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      requestId: REQUEST_ID,
      attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
      attestationPublicKeyPath: fixture.attestationPublicKeyPath,
      expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      now: new Date("2026-07-15T04:05:00.000Z"),
    });
    assert.equal(verification.restoreReady, true);
    assert.equal(verification.privateManifestMatch, true);
    assert.equal(verification.bundleReadbackVerified, true);
    assert.equal(verification.requestId, REQUEST_ID);
    assert.equal(verification.issuedAt, "2026-07-15T12:05:00.000+08:00");
    assert.equal(verification.notAfter, "2026-07-15T12:10:00.000+08:00");
    assert.equal(await receiptSignatureIsValid(verification, fixture.attestationPublicKeyPath), true);
    assert.equal(
      await receiptSignatureIsValid(
        Object.fromEntries(Object.entries(verification).reverse()),
        fixture.attestationPublicKeyPath,
      ),
      true,
    );
    assert.equal(
      await receiptSignatureIsValid(
        { ...verification, bundleReadbackVerified: false },
        fixture.attestationPublicKeyPath,
      ),
      false,
    );
    assert.equal(
      await receiptSignatureIsValid(
        { ...verification, requestId: "22222222-2222-4222-8222-222222222222" },
        fixture.attestationPublicKeyPath,
      ),
      false,
    );
  });

  it("fails closed when runtime quiescence is not declared", async () => {
    const fixture = await makeFixture();

    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
        quiesced: false,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "runtime_quiescence_required",
    );
  });

  it("rejects symlinks and never publishes a partial backup", async () => {
    const fixture = await makeFixture();
    await fs.symlink(path.join(fixture.assetsDir, "nested", "private-photo.bin"), path.join(fixture.assetsDir, "link"));

    await assert.rejects(
      createBackup(fixture),
      (error: unknown) => error instanceof RecoveryError && error.code === "storage_tree_symlink_rejected",
    );
    await assert.rejects(fs.access(path.join(fixture.backupRoot, BACKUP_ID)));
  });

  it("rejects hard-link aliases before copying private storage", async () => {
    const fixture = await makeFixture();
    await fs.link(
      path.join(fixture.assetsDir, "nested", "private-photo.bin"),
      path.join(fixture.root, "private-photo-hardlink-alias.bin"),
    );

    await assert.rejects(
      createBackup(fixture),
      (error: unknown) => error instanceof RecoveryError && error.code === "storage_tree_hardlink_rejected",
    );
    await assert.rejects(fs.access(path.join(fixture.backupRoot, BACKUP_ID)));
  });

  it("refuses to overwrite an existing backup destination", async () => {
    const fixture = await makeFixture();
    await fs.mkdir(path.join(fixture.backupRoot, BACKUP_ID), { recursive: true, mode: 0o700 });

    await assert.rejects(
      createBackup(fixture),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_destination_exists",
    );
  });

  it("rechecks an absent backup destination at the exclusive publication boundary", async () => {
    const fixture = await makeFixture();
    const destination = path.join(fixture.backupRoot, BACKUP_ID);
    const sentinel = path.join(destination, "foreign-sentinel");
    await assert.rejects(
      createBackup(fixture, {
        async testCheckpoint(stage: string) {
          if (stage !== "before_backup_publish") return;
          await fs.mkdir(destination, { mode: 0o700 });
          await fs.writeFile(sentinel, "foreign\n");
        },
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_destination_exists",
    );
    assert.equal(await fs.readFile(sentinel, "utf8"), "foreign\n");
    assert.equal(
      (await fs.readdir(fixture.backupRoot)).some((name) => name.startsWith(`.${BACKUP_ID}.tmp-`)),
      false,
    );
  });

  it("preserves substituted backup staging and owned evidence for reconciliation", async () => {
    const fixture = await makeFixture();
    let stagingPath = "";
    const preserved = path.join(fixture.backupRoot, "preserved-owned-staging");
    await assert.rejects(
      createBackup(fixture, {
        async testCheckpoint(stage: string) {
          if (stage !== "before_backup_publish") return;
          const stagingName = (await fs.readdir(fixture.backupRoot)).find((name) =>
            name.startsWith(`.${BACKUP_ID}.tmp-`),
          );
          assert.ok(stagingName);
          stagingPath = path.join(fixture.backupRoot, stagingName);
          await fs.rename(stagingPath, preserved);
          await fs.mkdir(stagingPath, { mode: 0o700 });
          await fs.writeFile(path.join(stagingPath, "foreign-sentinel"), "foreign\n");
          throw new Error("simulated staging substitution");
        },
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_reconciliation_required",
    );
    assert.equal(await fs.readFile(path.join(stagingPath, "foreign-sentinel"), "utf8"), "foreign\n");
    await fs.access(path.join(preserved, "private-manifest.json"));
    await assert.rejects(fs.access(path.join(fixture.backupRoot, BACKUP_ID)));
  });

  it("requires an explicitly pre-provisioned private backup root", async () => {
    const fixture = await makeFixture();
    await fs.rmdir(fixture.backupRoot);
    await assert.rejects(
      createBackup(fixture),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_root_unsafe",
    );
    await assert.rejects(fs.access(fixture.backupRoot));
    await fs.mkdir(fixture.backupRoot, { mode: 0o750 });
    await assert.rejects(
      createBackup(fixture),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_root_invalid",
    );
  });

  it("detects later private bundle corruption", async () => {
    const fixture = await makeFixture();
    const result = await createBackup(fixture);
    await fs.writeFile(path.join(result.backupDir, "assets", "nested", "private-photo.bin"), "corrupted");

    await assert.rejects(
      verifyRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: result.backupDir,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        requestId: REQUEST_ID,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_assets_digest_mismatch",
    );
  });

  it("rejects private manifest and bundle-container permission drift", async () => {
    const fixture = await makeFixture();
    const result = await createBackup(fixture);
    const verify = () => verifyRecoveryBackup({
      checkoutRoot: process.cwd(),
      backupDir: result.backupDir,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      requestId: REQUEST_ID,
      attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
      attestationPublicKeyPath: fixture.attestationPublicKeyPath,
      expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
    });

    await fs.chmod(path.join(result.backupDir, "private-manifest.json"), 0o644);
    await assert.rejects(
      verify(),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_manifest_permissions_unsafe",
    );
    await fs.chmod(path.join(result.backupDir, "private-manifest.json"), 0o600);
    await fs.chmod(result.backupDir, 0o755);
    await assert.rejects(
      verify(),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_directory_permissions_unsafe",
    );
  });

  it("includes turn_states in exact durable-state assessment", async () => {
    const fixture = await makeFixture();
    const result = await createBackup(fixture);
    const sqlite = new Database(fixture.dbPath);
    try {
      sqlite.prepare('INSERT INTO "turn_states" (id) VALUES (?)').run("late-turn-state");
    } finally {
      sqlite.close();
    }
    const assessment = await assessRecoveryState({
      checkoutRoot: process.cwd(),
      backupDir: result.backupDir,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      requestId: REQUEST_ID,
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      runtimeStopped: true,
      ...backupEvidence(result),
      attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
      attestationPublicKeyPath: fixture.attestationPublicKeyPath,
      expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      now: new Date("2026-07-15T04:15:00.000Z"),
    });
    assert.equal(assessment.durableCountsMatch, false);
    assert.equal(assessment.durableContentMatch, false);
    assert.equal(assessment.exactPreBackupState, false);
    assert.equal(assessment.requestId, REQUEST_ID);
    assert.equal(assessment.issuedAt, "2026-07-15T12:15:00.000+08:00");
    assert.equal(assessment.notAfter, "2026-07-15T12:20:00.000+08:00");
    assert.equal(await receiptSignatureIsValid(assessment, fixture.attestationPublicKeyPath), true);
    assert.equal(
      await receiptSignatureIsValid(
        { ...assessment, exactPreBackupState: true },
        fixture.attestationPublicKeyPath,
      ),
      false,
    );
    assert.equal(
      await receiptSignatureIsValid(
        { ...assessment, notAfter: "2026-07-15T12:21:00.000+08:00" },
        fixture.attestationPublicKeyPath,
      ),
      false,
    );
  });

  it("detects added schema objects, extra tables, and >2^53 integer drift", async () => {
    const fixture = await makeFixture();
    const sqlite = new Database(fixture.dbPath);
    sqlite.defaultSafeIntegers(true);
    try {
      sqlite.exec('CREATE TABLE "extra_private" (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
      sqlite.exec('CREATE INDEX "extra_private_value_idx" ON "extra_private" (value)');
      sqlite.exec('CREATE VIEW "extra_private_view" AS SELECT id, value FROM "extra_private"');
      sqlite.prepare('INSERT INTO "extra_private" (id, value) VALUES (?, ?)').run(1n, 9007199254740993n);
    } finally {
      sqlite.close();
    }
    const backup = await createBackup(fixture);

    const changedInteger = new Database(fixture.dbPath);
    changedInteger.defaultSafeIntegers(true);
    try {
      changedInteger.prepare('UPDATE "extra_private" SET value = ? WHERE id = ?').run(9007199254740995n, 1n);
    } finally {
      changedInteger.close();
    }
    const integerAssessment = await assessRecoveryState(assessmentOptions(fixture, backup));
    assert.equal(integerAssessment.databaseSchemaMatch, true);
    assert.equal(integerAssessment.allTableCountsMatch, true);
    assert.equal(integerAssessment.allTableContentMatch, false);
    assert.equal(integerAssessment.fullLogicalStateMatch, false);
    assert.equal(integerAssessment.exactPreBackupState, false);

    const changedSchema = new Database(fixture.dbPath);
    try {
      changedSchema.exec('CREATE TABLE "late_private" (id TEXT PRIMARY KEY)');
      changedSchema.exec('CREATE TRIGGER "late_private_trigger" AFTER INSERT ON "late_private" BEGIN DELETE FROM "late_private" WHERE id = NEW.id; END');
    } finally {
      changedSchema.close();
    }
    const schemaAssessment = await assessRecoveryState(assessmentOptions(fixture, backup));
    assert.equal(schemaAssessment.databaseSchemaMatch, false);
    assert.equal(schemaAssessment.allTableCountsMatch, false);
    assert.equal(schemaAssessment.fullLogicalStateMatch, false);
    assert.equal(schemaAssessment.exactPreBackupState, false);
  });

  it("requires a stopped runtime and rejects live-state drift during assessment", async () => {
    const fixture = await makeFixture();
    const result = await createBackup(fixture);
    const assessmentOptions = {
      checkoutRoot: process.cwd(),
      backupDir: result.backupDir,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      requestId: REQUEST_ID,
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      ...backupEvidence(result),
      attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
      attestationPublicKeyPath: fixture.attestationPublicKeyPath,
      expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
    };
    await assert.rejects(
      assessRecoveryState(assessmentOptions),
      (error: unknown) => error instanceof RecoveryError && error.code === "runtime_stop_required",
    );
    await assert.rejects(
      assessRecoveryState({
        ...assessmentOptions,
        runtimeStopped: true,
        testCheckpoint: async (stage: string) => {
          if (stage === "after_assessment_snapshot") {
            await fs.writeFile(path.join(fixture.assetsDir, "late-write.bin"), "drift\n");
          }
        },
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "assessment_live_state_changed",
    );
  });

  it("binds backup to the real checkout and observed runtime provenance", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: "d".repeat(40),
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
        runtimeProvenanceOrigin: fixture.runtimeProvenanceOrigin,
        attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "checkout_source_sha_mismatch",
    );
    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: "e".repeat(40),
        scope: "non-production",
        quiesced: true,
        runtimeProvenanceOrigin: fixture.runtimeProvenanceOrigin,
        attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "runtime_provenance_sha_mismatch",
    );
  });

  it("requires the canonical Git top level and ignores ambient Git authority variables", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: path.join(process.cwd(), "server"),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
        runtimeProvenanceOrigin: fixture.runtimeProvenanceOrigin,
        attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "checkout_root_not_git_top_level",
    );

    const originalGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(fixture.root, "ambient-wrong-git-dir");
    try {
      const backup = await createBackup(fixture);
      assert.equal(backup.receipt.intendedSourceSha, SOURCE_SHA);
    } finally {
      if (originalGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = originalGitDir;
    }
  });

  it("rejects hidden index flags and ignores fsmonitor/config and optional-lock false-clean paths", async () => {
    const fixture = await makeFixture();
    const cleanGitEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
    );
    async function expectProductionCheckoutRejection(checkoutRoot: string, code: string) {
      const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: checkoutRoot,
        encoding: "utf8",
        env: cleanGitEnvironment,
      }).trim();
      await assert.rejects(
        createRecoveryBackup({
          checkoutRoot,
          dbPath: fixture.dbPath,
          assetsDir: fixture.assetsDir,
          uploadsDir: fixture.uploadsDir,
          backupRoot: fixture.backupRoot,
          backupId: BACKUP_ID,
          intendedSourceSha: sourceSha,
          preRefreshRuntimeSha: RUNTIME_SHA,
          scope: "production",
          quiesced: true,
          runtimeProvenanceOrigin: fixture.runtimeProvenanceOrigin,
          attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
          attestationPublicKeyPath: fixture.attestationPublicKeyPath,
          expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
        }),
        (error: unknown) => error instanceof RecoveryError && error.code === code,
      );
    }

    for (const [name, flag] of [
      ["assume", "--assume-unchanged"],
      ["skip", "--skip-worktree"],
    ] as const) {
      const checkoutRoot = path.join(fixture.root, `checkout-${name}`);
      execFileSync("git", ["clone", "--quiet", "--shared", process.cwd(), checkoutRoot], {
        env: cleanGitEnvironment,
        stdio: "ignore",
      });
      execFileSync("git", ["update-index", flag, "README.md"], {
        cwd: checkoutRoot,
        env: cleanGitEnvironment,
        stdio: "ignore",
      });
      await fs.appendFile(path.join(checkoutRoot, "README.md"), `\n${name}-hidden-drift\n`);
      await expectProductionCheckoutRejection(checkoutRoot, "checkout_index_flags_unsafe");
    }

    const fsmonitorCheckout = path.join(fixture.root, "checkout-fsmonitor");
    execFileSync("git", ["clone", "--quiet", "--shared", process.cwd(), fsmonitorCheckout], {
      env: cleanGitEnvironment,
      stdio: "ignore",
    });
    const falseCleanHook = path.join(fixture.root, "false-clean-fsmonitor.sh");
    await fs.writeFile(falseCleanHook, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    execFileSync("git", ["config", "core.fsmonitor", falseCleanHook], {
      cwd: fsmonitorCheckout,
      env: cleanGitEnvironment,
      stdio: "ignore",
    });
    await fs.appendFile(path.join(fsmonitorCheckout, "README.md"), "\nfsmonitor-hidden-drift\n");
    const indexLock = path.join(fsmonitorCheckout, ".git", "index.lock");
    await fs.writeFile(indexLock, "foreign-index-lock\n");
    await expectProductionCheckoutRejection(fsmonitorCheckout, "checkout_tracked_state_dirty");
    assert.equal(await fs.readFile(indexLock, "utf8"), "foreign-index-lock\n");
  });

  it("rejects every manifest-controlled path that is not the fixed bundle layout", async () => {
    const fixture = await makeFixture();
    const result = await createBackup(fixture);
    const manifestPath = path.join(result.backupDir, "private-manifest.json");
    const original = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const cases = [
      ["database", "file", "../external.sqlite"],
      ["database", "file", "/tmp/external.sqlite"],
      ["database", "file", "nested/../database.sqlite"],
      ["assets", "directory", "../external-assets"],
      ["assets", "directory", "/tmp/external-assets"],
      ["assets", "directory", "assets/../assets"],
      ["uploads", "directory", "../external-uploads"],
      ["uploads", "directory", "/tmp/external-uploads"],
      ["uploads", "directory", "uploads-staging/../uploads-staging"],
    ] as const;

    for (const [section, field, value] of cases) {
      const mutated = structuredClone(original);
      mutated[section][field] = value;
      await fs.writeFile(manifestPath, `${JSON.stringify(mutated, null, 2)}\n`);
      await assert.rejects(
        verifyRecoveryBackup({
          checkoutRoot: process.cwd(),
          backupDir: result.backupDir,
          backupId: BACKUP_ID,
          intendedSourceSha: SOURCE_SHA,
          preRefreshRuntimeSha: RUNTIME_SHA,
          scope: "non-production",
          requestId: REQUEST_ID,
          attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
          attestationPublicKeyPath: fixture.attestationPublicKeyPath,
          expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
        }),
        (error: unknown) => error instanceof RecoveryError && error.code === "recovery_signature_invalid",
      );
    }
  });

  it("rejects a symlinked private manifest and fixed bundle child", async () => {
    const fixture = await makeFixture();
    const result = await createBackup(fixture);
    const manifestPath = path.join(result.backupDir, "private-manifest.json");
    const externalManifest = path.join(fixture.root, "external-manifest.json");
    await fs.rename(manifestPath, externalManifest);
    await fs.symlink(externalManifest, manifestPath);
    await assert.rejects(
      verifyRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: result.backupDir,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        requestId: REQUEST_ID,
        attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_manifest_file_unsafe",
    );

    await fs.rm(manifestPath);
    await fs.rename(externalManifest, manifestPath);
    const assetsPath = path.join(result.backupDir, "assets");
    const externalAssets = path.join(fixture.root, "external-assets");
    await fs.rename(assetsPath, externalAssets);
    await fs.symlink(externalAssets, assetsPath);
    await assert.rejects(
      verifyRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: result.backupDir,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
          scope: "non-production",
          requestId: REQUEST_ID,
          attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
          attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_bundle_layout_invalid",
    );
  });

  it("rejects overlapping, in-checkout, and symlink-ancestor storage paths before publishing a backup", async () => {
    const fixture = await makeFixture();
    const overlappingBackupRoot = path.join(fixture.assetsDir, "nested", "backups");
    await fs.mkdir(overlappingBackupRoot, { mode: 0o700 });
    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: overlappingBackupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_root_overlaps_storage",
    );
    await assert.rejects(fs.access(path.join(overlappingBackupRoot, BACKUP_ID)));

    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: path.join(process.cwd(), "server"),
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_root_inside_checkout",
    );
    await assert.rejects(fs.access(path.join(fixture.backupRoot, BACKUP_ID)));

    const linkedLive = path.join(fixture.root, "linked-live");
    await fs.symlink(path.dirname(fixture.dbPath), linkedLive);
    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: path.join(linkedLive, path.basename(fixture.dbPath)),
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "database_path_unsafe",
    );

    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: path.join(fixture.assetsDir, "nested"),
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "storage_source_paths_overlap",
    );
  });

  it("canonicalizes case aliases before enforcing storage disjointness", async (context) => {
    const fixture = await makeFixture();
    const alias = path.join(path.dirname(fixture.assetsDir), path.basename(fixture.assetsDir).toUpperCase());
    const canonical = await fs.stat(fixture.assetsDir);
    const aliasStat = await fs.stat(alias).catch(() => null);
    if (aliasStat === null || aliasStat.dev !== canonical.dev || aliasStat.ino !== canonical.ino) {
      context.skip("fixture filesystem is case-sensitive");
      return;
    }
    const caseAliasBackupRoot = path.join(alias, "case-alias-backups");
    await fs.mkdir(caseAliasBackupRoot, { mode: 0o700 });

    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: caseAliasBackupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_root_overlaps_storage",
    );
  });

  it("marks any failure after backup publication as reconciliation-required", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        quiesced: true,
        runtimeProvenanceOrigin: fixture.runtimeProvenanceOrigin,
        attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
        testCheckpoint(stage: string) {
          if (stage === "after_backup_publish") throw new Error("simulated post-publication failure");
        },
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_reconciliation_required",
    );
    await fs.access(path.join(fixture.backupRoot, BACKUP_ID, "private-manifest.json"));
  });

  it("uses a closed CLI schema and rejects typos, duplicates, empty values, and flag/value confusion", () => {
    const script = path.resolve("scripts/workflow/production-recovery.mjs");
    const cases = [
      ["backup", "--unknown=value"],
      ["verify", "--scope=non-production", "--scope=production"],
      ["assess", "--scope="],
      ["restore", "--runtime-stoped"],
      ["backup", "--quiesced=true"],
      ["verify", "--scope"],
    ];
    for (const args of cases) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
      assert.equal(result.status, 1, `${args.join(" ")}\n${result.stdout}${result.stderr}`);
      assert.equal(result.stdout, "");
      const error = JSON.parse(result.stderr);
      assert.equal(error.code, "invalid_argument");
    }
  });
});
