process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, generateKeyPairSync, sign as signBytes } from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../server/db/migrate.js";
import {
  RecoveryError,
  assessRecoveryState,
  createRecoveryBackup,
  restoreRecoveryBackup,
  verifyRecoveryBackup,
} from "../../scripts/workflow/production-recovery.mjs";

const SOURCE_SHA = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const RUNTIME_SHA = "c".repeat(40);
const BACKUP_ID = "20260715t130000z-pre-r05-a84370bf";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const PRE_0011_MIGRATIONS = [
  "0000_brainy_rocket_racer.sql",
  "0001_sleepy_vivisector.sql",
  "0002_meal_transaction_v2_foundation.sql",
  "0003_aspiring_masque.sql",
  "0004_history_query_hot_path_indexes.sql",
  "0005_chat_message_status.sql",
  "0006_colossal_selene.sql",
  "0007_violet_living_lightning.sql",
  "0008_shiny_stellaris.sql",
  "0009_blushing_william_stryker.sql",
  "0010_fuzzy_black_tom.sql",
] as const;
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

async function seedPre0011Database(dbPath: string) {
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    for (const migration of PRE_0011_MIGRATIONS) {
      sqlite.exec(await fs.readFile(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8"));
    }
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )`);
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
      .run("0010-private-hash", 1781447465739);
    sqlite
      .prepare(`INSERT INTO devices (
        id, goal, daily_calories, daily_protein, daily_carbs, daily_fat, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("rehearsal-device", "fat_loss", 1800, 120, 180, 60, "2026-07-15T00:00:00.000Z");
  } finally {
    sqlite.close();
  }
}

async function createFixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-recovery-rehearsal-")));
  tempDirs.add(root);
  const liveDir = path.join(root, "live");
  const dbPath = path.join(liveDir, "nutrition.db");
  const assetsDir = path.join(liveDir, "assets");
  const uploadsDir = path.join(liveDir, "uploads-staging");
  const backupRoot = path.join(root, "backups");
  const quarantineRoot = path.join(root, "quarantine");
  const keyRoot = path.join(root, "keys");
  await fs.mkdir(path.join(assetsDir, "device"), { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(backupRoot, { mode: 0o700 });
  await fs.mkdir(quarantineRoot, { mode: 0o700 });
  await fs.mkdir(keyRoot, { recursive: true });
  await fs.writeFile(path.join(assetsDir, "device", "meal.jpg"), "pre-migration-asset-bytes");
  await fs.writeFile(path.join(uploadsDir, "active.tmp"), "pre-migration-upload-bytes");
  await seedPre0011Database(dbPath);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const attestationPrivateKeyPath = path.join(keyRoot, "recovery-private.pem");
  const attestationPublicKeyPath = path.join(keyRoot, "recovery-public.pem");
  await fs.writeFile(attestationPrivateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await fs.writeFile(attestationPublicKeyPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const expectedAttestationPublicKeySha256 = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const server = http.createServer((request, response) => {
    if (request.url !== "/api/runtime-provenance") return void response.writeHead(404).end();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ sourceSha: RUNTIME_SHA }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.add(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    root,
    dbPath,
    assetsDir,
    uploadsDir,
    backupRoot,
    quarantineRoot,
    runtimeProvenanceOrigin: `http://127.0.0.1:${address.port}`,
    attestationPrivateKeyPath,
    attestationPublicKeyPath,
    expectedAttestationPublicKeySha256,
  };
}

function recoveryAuthority(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    runtimeProvenanceOrigin: fixture.runtimeProvenanceOrigin,
    attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
    attestationPublicKeyPath: fixture.attestationPublicKeyPath,
    expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
  };
}

function backupEvidence(backup: Awaited<ReturnType<typeof createRecoveryBackup>>) {
  return {
    expectedPrivateManifestSha256: backup.receipt.privateManifestSha256 as string,
    expectedBackupBundleSha256: backup.receipt.backupBundleSha256 as string,
  };
}

function restoreConfirmation(
  backup: Awaited<ReturnType<typeof createRecoveryBackup>>,
  targetSourceSha: string,
  restoreAssets: boolean,
  restoreUploads: boolean,
) {
  const selection = restoreUploads ? "database+assets+uploads" : restoreAssets ? "database+assets" : "database";
  return `RESTORE:${BACKUP_ID}:${targetSourceSha}:${selection}:${backup.receipt.privateManifestSha256}:${backup.receipt.backupBundleSha256}`;
}

function assessmentOptionsForIntegration(
  fixture: Awaited<ReturnType<typeof createFixture>>,
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
    ...recoveryAuthority(fixture),
    ...backupEvidence(backup),
    dbPath: fixture.dbPath,
    assetsDir: fixture.assetsDir,
    uploadsDir: fixture.uploadsDir,
    runtimeStopped: true,
  };
}

function restoreOptions(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  backup: Awaited<ReturnType<typeof createRecoveryBackup>>,
  extra: Record<string, unknown> = {},
) {
  const restoreAssets = extra.restoreAssets === true;
  const restoreUploads = extra.restoreUploads === true;
  return {
    checkoutRoot: process.cwd(),
    backupDir: backup.backupDir,
    dbPath: fixture.dbPath,
    assetsDir: fixture.assetsDir,
    uploadsDir: fixture.uploadsDir,
    quarantineRoot: fixture.quarantineRoot,
    backupId: BACKUP_ID,
    intendedSourceSha: SOURCE_SHA,
    targetSourceSha: RUNTIME_SHA,
    preRefreshRuntimeSha: RUNTIME_SHA,
    scope: "non-production",
    ...recoveryAuthority(fixture),
    ...backupEvidence(backup),
    runtimeStopped: true,
    restoreAssets,
    restoreUploads,
    confirm: restoreConfirmation(backup, RUNTIME_SHA, restoreAssets, restoreUploads),
    ...extra,
  };
}

function databaseSnapshot(dbPath: string) {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return {
      integrity: sqlite.pragma("integrity_check"),
      foreignKeys: sqlite.pragma("foreign_key_check"),
      sessionVersionColumns: (sqlite.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>).filter(
        (column) => column.name === "session_version",
      ),
      device: sqlite.prepare("SELECT id, goal, daily_calories FROM devices WHERE id = ?").get("rehearsal-device") as {
        id: string;
        goal: string;
        daily_calories: number;
      },
      journal: sqlite
        .prepare('SELECT hash, created_at AS createdAt FROM "__drizzle_migrations" ORDER BY created_at, hash')
        .all(),
    };
  } finally {
    sqlite.close();
  }
}

async function pinCommittedWalFrame(dbPath: string) {
  const reader = new Database(dbPath);
  reader.pragma("journal_mode = WAL");
  reader.exec("BEGIN");
  const oldGoal = (reader.prepare("SELECT goal FROM devices WHERE id = ?").get("rehearsal-device") as { goal: string }).goal;

  const writer = new Database(dbPath);
  try {
    writer.pragma("journal_mode = WAL");
    writer.pragma("wal_autocheckpoint = 0");
    writer.prepare("UPDATE devices SET goal = ? WHERE id = ?").run("wal-only-goal", "rehearsal-device");
  } finally {
    writer.close();
  }

  const walPath = `${dbPath}-wal`;
  const walStat = await fs.stat(walPath);
  assert.ok(walStat.size > 0);
  const mainOnlyPath = path.join(path.dirname(dbPath), "main-file-only.sqlite");
  await fs.copyFile(dbPath, mainOnlyPath);
  const mainOnly = new Database(mainOnlyPath, { readonly: true });
  try {
    assert.equal(
      (mainOnly.prepare("SELECT goal FROM devices WHERE id = ?").get("rehearsal-device") as { goal: string }).goal,
      oldGoal,
    );
  } finally {
    mainOnly.close();
  }
  assert.equal(databaseSnapshot(dbPath).device.goal, "wal-only-goal");
  return {
    close() {
      reader.exec("ROLLBACK");
      reader.close();
    },
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

describe("non-production database recovery rehearsal", () => {
  it("backs up a committed pre-0011 WAL-only frame, migrates the copy, and restores exact pre-migration state", async () => {
    const fixture = await createFixture();
    const pinnedReader = await pinCommittedWalFrame(fixture.dbPath);
    const prestate = databaseSnapshot(fixture.dbPath);
    assert.deepEqual(prestate.sessionVersionColumns, []);

    let backup: Awaited<ReturnType<typeof createRecoveryBackup>>;
    try {
      backup = await createRecoveryBackup({
        checkoutRoot: process.cwd(),
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        backupRoot: fixture.backupRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        ...recoveryAuthority(fixture),
        quiesced: true,
        now: new Date("2026-07-15T05:00:00.000Z"),
      });
    } finally {
      pinnedReader.close();
    }
    assert.equal((await fs.stat(path.join(backup.backupDir, "database.sqlite"))).mode & 0o777, 0o600);

    const unchangedAssessment = await assessRecoveryState({
      checkoutRoot: process.cwd(),
      backupDir: backup.backupDir,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      requestId: REQUEST_ID,
      ...recoveryAuthority(fixture),
      ...backupEvidence(backup),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      runtimeStopped: true,
    });
    assert.equal(unchangedAssessment.exactPreBackupState, true);

    await runMigrations(fixture.dbPath);
    const migrated = databaseSnapshot(fixture.dbPath);
    assert.equal(migrated.sessionVersionColumns.length, 1);
    const migratedAssessment = await assessRecoveryState({
      checkoutRoot: process.cwd(),
      backupDir: backup.backupDir,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      requestId: REQUEST_ID,
      ...recoveryAuthority(fixture),
      ...backupEvidence(backup),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      runtimeStopped: true,
    });
    assert.equal(migratedAssessment.exactPreBackupState, false);
    assert.equal(migratedAssessment.migrationJournalMatch, false);

    const mutatedDb = new Database(fixture.dbPath);
    try {
      mutatedDb.prepare("UPDATE devices SET goal = ? WHERE id = ?").run("corrupted-goal", "rehearsal-device");
    } finally {
      mutatedDb.close();
    }
    await fs.writeFile(path.join(fixture.assetsDir, "device", "meal.jpg"), "corrupted-asset-bytes");
    await fs.writeFile(path.join(fixture.uploadsDir, "active.tmp"), "new-request-local-upload");

    await assert.rejects(
      restoreRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: backup.backupDir,
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        quarantineRoot: fixture.quarantineRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        targetSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        ...recoveryAuthority(fixture),
        ...backupEvidence(backup),
        runtimeStopped: true,
        restoreAssets: true,
        restoreUploads: false,
        confirm: restoreConfirmation(backup, SOURCE_SHA, true, false),
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_target_not_pre_refresh_runtime",
    );
    assert.deepEqual(await fs.readdir(fixture.quarantineRoot), []);

    const receipt = await restoreRecoveryBackup({
      checkoutRoot: process.cwd(),
      backupDir: backup.backupDir,
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      quarantineRoot: fixture.quarantineRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      targetSourceSha: RUNTIME_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      ...backupEvidence(backup),
      runtimeStopped: true,
      restoreAssets: true,
      restoreUploads: false,
      confirm: restoreConfirmation(backup, RUNTIME_SHA, true, false),
      now: new Date("2026-07-15T05:15:00.000Z"),
    });

    const restored = databaseSnapshot(fixture.dbPath);
    assert.deepEqual(restored, prestate);
    assert.equal((await fs.stat(fixture.dbPath)).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(path.join(fixture.assetsDir, "device", "meal.jpg"), "utf8"), "pre-migration-asset-bytes");
    assert.equal((await fs.stat(fixture.assetsDir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(fixture.assetsDir, "device"))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(fixture.assetsDir, "device", "meal.jpg"))).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(path.join(fixture.uploadsDir, "active.tmp"), "utf8"), "new-request-local-upload");
    assert.equal(receipt.databaseRestored, true);
    assert.equal(receipt.assetsRestored, true);
    assert.equal(receipt.uploadsRestored, false);
    assert.equal(receipt.quarantinePreserved, true);
    assert.equal(receipt.quarantineDurable, true);
    assert.equal(receipt.replacementDurable, true);
    assert.equal(receipt.journalCommitted, true);
    assert.match(receipt.journalRecordSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.privatePrestateRecordSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.receiptSignature, /^[A-Za-z0-9_-]+$/);

    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serialized, /rehearsal-device|corrupted-goal|meal\.jpg|active\.tmp|0010-private-hash/);
    const quarantineEntries = await fs.readdir(fixture.quarantineRoot);
    assert.equal(quarantineEntries.length, 1);
    const privatePrestatePath = path.join(fixture.quarantineRoot, quarantineEntries[0], "private-prestate.json");
    const privatePrestateRaw = await fs.readFile(privatePrestatePath);
    assert.equal((await fs.stat(privatePrestatePath)).mode & 0o777, 0o600);
    assert.equal(createHash("sha256").update(privatePrestateRaw).digest("hex"), receipt.privatePrestateRecordSha256);
    const journalDirectory = path.join(fixture.quarantineRoot, quarantineEntries[0], "recovery-journal");
    const journalNames = (await fs.readdir(journalDirectory)).sort();
    const finalJournal = JSON.parse(await fs.readFile(path.join(journalDirectory, journalNames.at(-1)!), "utf8"));
    assert.equal(finalJournal.status, "committed");
    assert.equal(finalJournal.pendingStep, null);
    assert.equal(finalJournal.privatePrestateRecordSha256, receipt.privatePrestateRecordSha256);
  });

  it("blocks a new restore when a signed prior journal needs reconciliation", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);
    const journalDirectory = path.join(fixture.quarantineRoot, "restore-prior-crash", "recovery-journal");
    await fs.mkdir(journalDirectory, { recursive: true, mode: 0o700 });
    const privateKey = createPrivateKey(await fs.readFile(fixture.attestationPrivateKeyPath));
    const signRecord = (payload: Record<string, unknown>) => ({
      ...payload,
      attestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      signature: signBytes(
        null,
        Buffer.from(JSON.stringify(canonicalJsonValue(payload)), "utf8"),
        privateKey,
      ).toString("base64url"),
    });
    const databaseStat = await fs.stat(fixture.dbPath);
    const immutableBase = {
      operationId: "prior-crash",
      backupId: BACKUP_ID,
      scope: "non-production",
      intendedSourceSha: SOURCE_SHA,
      targetSourceSha: RUNTIME_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      restoreSelection: "database",
      createdAt: "2026-07-15T13:00:00.000+08:00",
      manifestSha256: backup.receipt.privateManifestSha256,
      backupBundleSha256: backup.receipt.backupBundleSha256,
    };
    const privatePrestatePayload = {
      schemaVersion: 2,
      kind: "production_storage_restore_private_prestate",
      ...immutableBase,
      preRestoreState: {
        database: {
          present: true,
          dev: String(databaseStat.dev),
          ino: String(databaseStat.ino),
          mode: databaseStat.mode & 0o7777,
          size: databaseStat.size,
          sha256: createHash("sha256").update(await fs.readFile(fixture.dbPath)).digest("hex"),
        },
        databaseWal: { present: false },
        databaseShm: { present: false },
        assets: null,
        uploads: null,
      },
    };
    const privatePrestateRecord = signRecord(privatePrestatePayload);
    const privatePrestateRaw = Buffer.from(`${JSON.stringify(privatePrestateRecord, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(path.dirname(journalDirectory), "private-prestate.json"), privatePrestateRaw, { mode: 0o600 });
    const operations = [{
      step: "install_database",
      source: path.join(fixture.root, "stale-stage.sqlite"),
      destination: fixture.dbPath,
      phase: "install",
    }];
    const payload = {
      schemaVersion: 2,
      kind: "production_storage_restore_journal",
      ...immutableBase,
      privatePrestateRecordSha256: createHash("sha256").update(privatePrestateRaw).digest("hex"),
      operations,
      status: "applying",
      pendingStep: "install_database",
      reconciliationCode: null,
      completedSteps: [],
      sequence: 0,
      previousRecordSha256: null,
    };
    const record = signRecord(payload);
    await fs.writeFile(path.join(journalDirectory, "000000.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });

    await assert.rejects(
      restoreRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: backup.backupDir,
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        quarantineRoot: fixture.quarantineRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        targetSourceSha: RUNTIME_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        ...recoveryAuthority(fixture),
        ...backupEvidence(backup),
        runtimeStopped: true,
        restoreAssets: false,
        restoreUploads: false,
        confirm: restoreConfirmation(backup, RUNTIME_SHA, false, false),
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
  });

  it("expected-rejection: rejects a destructive restore without the exact backup-and-SHA confirmation", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: backup.backupDir,
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        quarantineRoot: fixture.quarantineRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        targetSourceSha: RUNTIME_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        ...recoveryAuthority(fixture),
        ...backupEvidence(backup),
        runtimeStopped: true,
        restoreAssets: false,
        restoreUploads: false,
        confirm: "RESTORE:wrong:binding",
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_confirmation_mismatch",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    assert.deepEqual(await fs.readdir(fixture.quarantineRoot), []);
  });

  it("binds assessment and restore to the approved manifest and bundle digests before mutation", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);
    const wrongManifest = "0".repeat(64);

    await assert.rejects(
      assessRecoveryState({
        ...assessmentOptionsForIntegration(fixture, backup),
        expectedPrivateManifestSha256: wrongManifest,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_evidence_correlation_mismatch",
    );
    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        expectedPrivateManifestSha256: wrongManifest,
        confirm: `RESTORE:${BACKUP_ID}:${RUNTIME_SHA}:database:${wrongManifest}:${backup.receipt.backupBundleSha256}`,
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "backup_evidence_correlation_mismatch",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    assert.deepEqual(await fs.readdir(fixture.quarantineRoot), []);
  });

  it("rejects verify, assess, and restore keys anywhere under the backup root", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const siblingPrivateKey = path.join(fixture.backupRoot, "sibling-private.pem");
    const siblingPublicKey = path.join(fixture.backupRoot, "sibling-public.pem");
    await fs.copyFile(fixture.attestationPrivateKeyPath, siblingPrivateKey);
    await fs.copyFile(fixture.attestationPublicKeyPath, siblingPublicKey);
    await fs.chmod(siblingPrivateKey, 0o600);
    await fs.chmod(siblingPublicKey, 0o600);

    await assert.rejects(
      verifyRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: backup.backupDir,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        requestId: REQUEST_ID,
        attestationPrivateKeyPath: siblingPrivateKey,
        attestationPublicKeyPath: fixture.attestationPublicKeyPath,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "attestation_key_overlaps_recovery_storage",
    );
    await assert.rejects(
      verifyRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: backup.backupDir,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        requestId: REQUEST_ID,
        attestationPrivateKeyPath: fixture.attestationPrivateKeyPath,
        attestationPublicKeyPath: siblingPublicKey,
        expectedAttestationPublicKeySha256: fixture.expectedAttestationPublicKeySha256,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "attestation_key_overlaps_recovery_storage",
    );
    await assert.rejects(
      assessRecoveryState({
        ...assessmentOptionsForIntegration(fixture, backup),
        attestationPrivateKeyPath: siblingPrivateKey,
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "attestation_key_overlaps_recovery_storage",
    );
    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        attestationPrivateKeyPath: siblingPrivateKey,
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "attestation_key_overlaps_recovery_storage",
    );
    assert.deepEqual(await fs.readdir(fixture.quarantineRoot), []);
    await assert.rejects(fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`));
  });

  it("rejects non-boolean restore selections and confirmations for a different selection", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, { restoreAssets: "yes" })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_selection_invalid",
    );
    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        restoreAssets: true,
        confirm: restoreConfirmation(backup, RUNTIME_SHA, false, false),
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_confirmation_mismatch",
    );
    assert.deepEqual(await fs.readdir(fixture.quarantineRoot), []);
  });

  it("durably binds a private prestate record to the surviving lock before any live move", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        testCheckpoint(stage: string) {
          if (stage === "after_private_prestate_published") throw new Error("simulated process crash boundary");
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    const lockPath = `${fixture.dbPath}.nutrition-recovery-restore.lock`;
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    const prestatePath = path.join(fixture.quarantineRoot, restoreDirectory, "private-prestate.json");
    const prestateRaw = await fs.readFile(prestatePath);
    assert.equal((await fs.stat(prestatePath)).mode & 0o777, 0o600);
    assert.equal(lock.privatePrestateRecordSha256, createHash("sha256").update(prestateRaw).digest("hex"));
    assert.equal(JSON.parse(prestateRaw.toString("utf8")).signature.length > 0, true);
    await assert.rejects(fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "recovery-journal")));
  });

  it("preserves a colliding stage namespace that the restore did not create", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        async testCheckpoint(stage: string) {
          if (stage !== "after_private_prestate_published") return;
          const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
          assert.ok(restoreDirectory);
          const foreignStage = path.join(fixture.quarantineRoot, restoreDirectory, "replacement-staging");
          await fs.mkdir(foreignStage, { mode: 0o700 });
          await fs.writeFile(path.join(foreignStage, "foreign-sentinel"), "preserve-me");
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    assert.equal(
      await fs.readFile(path.join(fixture.quarantineRoot, restoreDirectory, "replacement-staging", "foreign-sentinel"), "utf8"),
      "preserve-me",
    );
    await fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`);
  });

  it("rechecks approved backup evidence immediately before the first live move", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);
    const liveAssetBefore = await fs.readFile(path.join(fixture.assetsDir, "device", "meal.jpg"));

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        restoreAssets: true,
        confirm: restoreConfirmation(backup, RUNTIME_SHA, true, false),
        async testCheckpoint(stage: string) {
          if (stage === "before_destructive_restore_recheck") {
            await fs.writeFile(path.join(backup.backupDir, "assets", "device", "meal.jpg"), "late-backup-drift");
          }
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    assert.deepEqual(await fs.readFile(path.join(fixture.assetsDir, "device", "meal.jpg")), liveAssetBefore);
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    await assert.rejects(fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite")));
    await fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "replacement-staging", "database.sqlite"));
    await fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`);
  });

  it("rechecks private signing-key identity immediately before the first live move", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        async testCheckpoint(stage: string) {
          if (stage === "before_destructive_restore_recheck") {
            await fs.chmod(fixture.attestationPrivateKeyPath, 0o644);
          }
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    await assert.rejects(fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite")));
    await fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "replacement-staging", "database.sqlite"));
    await fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`);
  });

  it("rechecks the approved checkout commit immediately before the first live move", async () => {
    const fixture = await createFixture();
    const checkoutRoot = path.join(fixture.root, "source-checkout");
    const cleanGitEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
    );
    execFileSync("git", ["clone", "--quiet", "--shared", process.cwd(), checkoutRoot], {
      env: cleanGitEnvironment,
      stdio: "ignore",
    });
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: checkoutRoot,
      encoding: "utf8",
      env: cleanGitEnvironment,
    }).trim();
    const changedSha = execFileSync("git", ["rev-parse", "HEAD^"], {
      cwd: checkoutRoot,
      encoding: "utf8",
      env: cleanGitEnvironment,
    }).trim();
    assert.notEqual(changedSha, sourceSha);
    const backup = await createRecoveryBackup({
      checkoutRoot,
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: sourceSha,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup({
        checkoutRoot,
        backupDir: backup.backupDir,
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        quarantineRoot: fixture.quarantineRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: sourceSha,
        targetSourceSha: RUNTIME_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        ...recoveryAuthority(fixture),
        ...backupEvidence(backup),
        runtimeStopped: true,
        restoreAssets: false,
        restoreUploads: false,
        confirm: restoreConfirmation(backup, RUNTIME_SHA, false, false),
        testCheckpoint(stage: string) {
          if (stage === "before_destructive_restore_recheck") {
            execFileSync("git", ["update-ref", "HEAD", changedSha], {
              cwd: checkoutRoot,
              env: cleanGitEnvironment,
              stdio: "ignore",
            });
          }
        },
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    await assert.rejects(fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite")));
    await fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "replacement-staging", "database.sqlite"));
    await fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`);
  });

  it("rejects a symlinked quarantine root before any live storage mutation", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);
    const external = path.join(fixture.root, "external-quarantine");
    await fs.mkdir(external);
    await fs.rmdir(fixture.quarantineRoot);
    await fs.symlink(external, fixture.quarantineRoot);

    await assert.rejects(
      restoreRecoveryBackup({
        checkoutRoot: process.cwd(),
        backupDir: backup.backupDir,
        dbPath: fixture.dbPath,
        assetsDir: fixture.assetsDir,
        uploadsDir: fixture.uploadsDir,
        quarantineRoot: fixture.quarantineRoot,
        backupId: BACKUP_ID,
        intendedSourceSha: SOURCE_SHA,
        targetSourceSha: RUNTIME_SHA,
        preRefreshRuntimeSha: RUNTIME_SHA,
        scope: "non-production",
        ...recoveryAuthority(fixture),
        ...backupEvidence(backup),
        runtimeStopped: true,
        restoreAssets: false,
        restoreUploads: false,
        confirm: restoreConfirmation(backup, RUNTIME_SHA, false, false),
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === "quarantine_root_unsafe",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    assert.deepEqual(await fs.readdir(external), []);
  });

  it("requires an explicitly pre-provisioned private quarantine root", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);
    await fs.rmdir(fixture.quarantineRoot);
    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup)),
      (error: unknown) => error instanceof RecoveryError && error.code === "quarantine_root_unsafe",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    await assert.rejects(fs.access(fixture.quarantineRoot));
  });

  it("preflights the selected source object device, not only its parent device", async (context) => {
    const fixture = await createFixture();
    const quarantineDevice = (await fs.stat(fixture.quarantineRoot)).dev;
    let mountedDirectory: string | null = null;
    for (const candidate of ["/dev", "/proc", "/sys"]) {
      const source = await fs.lstat(candidate).catch(() => null);
      const parent = await fs.stat(path.dirname(candidate)).catch(() => null);
      if (
        source?.isDirectory() &&
        !source.isSymbolicLink() &&
        parent?.dev === quarantineDevice &&
        source.dev !== quarantineDevice
      ) {
        mountedDirectory = candidate;
        break;
      }
    }
    if (mountedDirectory === null) {
      context.skip("no cross-device mountpoint with a same-device parent is available");
      return;
    }
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        assetsDir: mountedDirectory,
        restoreAssets: true,
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "quarantine_cross_device_rejected",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    assert.deepEqual(await fs.readdir(fixture.quarantineRoot), []);
    await assert.rejects(fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`));
  });

  it("serializes concurrent restores with one durable database-scoped lock", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    let releaseFirst!: () => void;
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => { markAcquired = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = restoreRecoveryBackup(restoreOptions(fixture, backup, {
      testCheckpoint: async (stage: string) => {
        if (stage !== "after_restore_lock_acquired") return;
        markAcquired();
        await release;
      },
    }));
    await acquired;
    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup)),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    releaseFirst();
    const receipt = await first;
    assert.equal(receipt.journalCommitted, true);
    await assert.rejects(fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`));
  });

  it("returns reconciliation-required when the restore lock changes at release", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const lockPath = `${fixture.dbPath}.nutrition-recovery-restore.lock`;

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        async testCheckpoint(stage: string) {
          if (stage === "before_restore_lock_release") await fs.writeFile(lockPath, "foreign-lock-owner\n");
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.equal(await fs.readFile(lockPath, "utf8"), "foreign-lock-owner\n");
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    const journalDirectory = path.join(fixture.quarantineRoot, restoreDirectory, "recovery-journal");
    const journalNames = (await fs.readdir(journalDirectory)).sort();
    const finalJournal = JSON.parse(await fs.readFile(path.join(journalDirectory, journalNames.at(-1)!), "utf8"));
    assert.equal(finalJournal.status, "committed");
  });

  it("keeps the durable lock when a fallible release preflight faults before terminal unlink", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const lockPath = `${fixture.dbPath}.nutrition-recovery-restore.lock`;

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        testCheckpoint(stage: string) {
          if (stage === "before_restore_lock_terminal_unlink") {
            throw new Error("simulated lock release preflight failure");
          }
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    await fs.access(lockPath);
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    const journalDirectory = path.join(fixture.quarantineRoot, restoreDirectory, "recovery-journal");
    const journalNames = (await fs.readdir(journalDirectory)).sort();
    const finalJournal = JSON.parse(await fs.readFile(path.join(journalDirectory, journalNames.at(-1)!), "utf8"));
    assert.equal(finalJournal.status, "committed");
  });

  it("rolls back earlier quarantine effects when install fails before its move", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const before = databaseSnapshot(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        testCheckpoint(stage: string) {
          if (stage === "before_restore_operation:install_database") {
            throw new Error("simulated pre-move install failure");
          }
        },
      })),
      (error: unknown) => error instanceof Error && error.message === "simulated pre-move install failure",
    );
    assert.deepEqual(databaseSnapshot(fixture.dbPath), before);
    await assert.rejects(fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`));
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    const journalDirectory = path.join(fixture.quarantineRoot, restoreDirectory, "recovery-journal");
    const journalNames = (await fs.readdir(journalDirectory)).sort();
    const finalJournal = JSON.parse(await fs.readFile(path.join(journalDirectory, journalNames.at(-1)!), "utf8"));
    assert.equal(finalJournal.status, "rolled_back");
    await assert.rejects(fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite")));
    await fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "replacement-staging", "database.sqlite"));
  });

  it("does not overwrite a file recreated at the database install boundary", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const originalDatabaseBytes = await fs.readFile(fixture.dbPath);
    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        testCheckpoint: async (stage: string) => {
          if (stage === "before_restore_operation:install_database") {
            await fs.writeFile(fixture.dbPath, "uncooperative-runtime-bytes");
          }
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    assert.equal(await fs.readFile(fixture.dbPath, "utf8"), "uncooperative-runtime-bytes");
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    assert.deepEqual(
      await fs.readFile(path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite")),
      originalDatabaseBytes,
    );
    await assert.rejects(fs.access(path.join(fixture.quarantineRoot, restoreDirectory, "failed-install_database")));
    await fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`);
    const journalDirectory = path.join(fixture.quarantineRoot, restoreDirectory, "recovery-journal");
    const journalNames = (await fs.readdir(journalDirectory)).sort();
    const statuses = await Promise.all(
      journalNames.map(async (name) => JSON.parse(await fs.readFile(path.join(journalDirectory, name), "utf8")).status),
    );
    assert.equal(statuses.includes("rolled_back"), false);
  });

  it("refuses to move tampered quarantine bytes during rollback", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    const originalDatabaseBytes = await fs.readFile(fixture.dbPath);

    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        testCheckpoint: async (stage: string) => {
          if (stage !== "before_restore_operation:install_database") return;
          const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
          assert.ok(restoreDirectory);
          await fs.appendFile(
            path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite"),
            "tampered-quarantine-bytes",
          );
          throw new Error("force rollback after quarantine tamper");
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    await assert.rejects(fs.access(fixture.dbPath));
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    const quarantined = await fs.readFile(path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite"));
    assert.equal(quarantined.subarray(0, originalDatabaseBytes.length).equals(originalDatabaseBytes), true);
    assert.equal(quarantined.subarray(originalDatabaseBytes.length).toString("utf8"), "tampered-quarantine-bytes");
    await fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`);
    const journalDirectory = path.join(fixture.quarantineRoot, restoreDirectory, "recovery-journal");
    const statuses = await Promise.all(
      (await fs.readdir(journalDirectory)).map(
        async (name) => JSON.parse(await fs.readFile(path.join(journalDirectory, name), "utf8")).status,
      ),
    );
    assert.equal(statuses.includes("rolled_back"), false);
  });

  it("never records rolled_back or releases the fence when rollback prestate is missing", async () => {
    const fixture = await createFixture();
    const backup = await createRecoveryBackup({
      checkoutRoot: process.cwd(),
      dbPath: fixture.dbPath,
      assetsDir: fixture.assetsDir,
      uploadsDir: fixture.uploadsDir,
      backupRoot: fixture.backupRoot,
      backupId: BACKUP_ID,
      intendedSourceSha: SOURCE_SHA,
      preRefreshRuntimeSha: RUNTIME_SHA,
      scope: "non-production",
      ...recoveryAuthority(fixture),
      quiesced: true,
    });
    await assert.rejects(
      restoreRecoveryBackup(restoreOptions(fixture, backup, {
        testCheckpoint: async (stage: string) => {
          if (stage !== "before_restore_operation:install_database") return;
          const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
          assert.ok(restoreDirectory);
          await fs.rm(path.join(fixture.quarantineRoot, restoreDirectory, "database.sqlite"));
          throw new Error("simulated missing rollback prestate");
        },
      })),
      (error: unknown) => error instanceof RecoveryError && error.code === "restore_reconciliation_required",
    );
    await fs.access(`${fixture.dbPath}.nutrition-recovery-restore.lock`);
    const restoreDirectory = (await fs.readdir(fixture.quarantineRoot)).find((entry) => entry.startsWith("restore-"));
    assert.ok(restoreDirectory);
    const journalDirectory = path.join(fixture.quarantineRoot, restoreDirectory, "recovery-journal");
    const statuses = await Promise.all(
      (await fs.readdir(journalDirectory)).map(async (name) => JSON.parse(await fs.readFile(path.join(journalDirectory, name), "utf8")).status),
    );
    assert.equal(statuses.includes("rolled_back"), false);
  });
});
