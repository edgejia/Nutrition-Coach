import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "../../server/db/client.js";
import { runMigrations } from "../../server/db/migrate.js";
import { createDeviceService } from "../../server/services/device.js";

type ManagedDb = ReturnType<typeof createDb> & {
  $client: {
    close(): void;
  };
};

const openDbs: ManagedDb[] = [];
const tempDirs = new Set<string>();

function trackDb(db: ReturnType<typeof createDb>) {
  openDbs.push(db as ManagedDb);
  return db;
}

async function makeTempDbPath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nutrition-db-"));
  tempDirs.add(dir);
  return path.join(dir, "nutrition.db");
}

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.$client.close();
  }

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("database migration contract", () => {
  it("fails fast for unmigrated file-backed databases", async () => {
    const dbPath = await makeTempDbPath();

    assert.throws(
      () => createDb(dbPath),
      /Database schema missing\. Run `yarn db:migrate` before starting the app\./,
    );
  });

  it("opens file-backed databases after runMigrations", async () => {
    const dbPath = await makeTempDbPath();

    await runMigrations(dbPath);

    const db = trackDb(createDb(dbPath));
    const deviceService = createDeviceService(db);
    const result = await deviceService.createDevice("fat_loss");

    assert.ok(result.deviceId);
  });

  it("fails fast for partially migrated file-backed databases missing the assets table", async () => {
    const dbPath = await makeTempDbPath();

    await runMigrations(dbPath);

    const sqlite = new Database(dbPath);
    try {
      sqlite.exec("DROP TABLE assets;");
    } finally {
      sqlite.close();
    }

    assert.throws(
      () => createDb(dbPath),
      /Database schema missing\. Run `yarn db:migrate` before starting the app\./,
    );
  });

  it("bootstraps :memory: databases by default for tests", async () => {
    const db = trackDb(createDb(":memory:"));
    const deviceService = createDeviceService(db);
    const result = await deviceService.createDevice("fat_loss");

    assert.ok(result.deviceId);
  });

  it("can disable :memory: bootstrap for schema validation checks", () => {
    assert.throws(
      () => createDb(":memory:", { allowInMemoryBootstrap: false }),
      /Database schema missing/,
    );
  });
});
