import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const legacyMigrationRows = [
  {
    hash: "707b12f52b5734d33efe907c83894ed0aff6e3cbd024d0bcd27849234e382776",
    createdAt: 1776562979498,
  },
  {
    hash: "33424b94bdaa968533b527a475fc4fc9f98f0fb326c2d932dc16d98d3d01070c",
    createdAt: 1776563328911,
  },
] as const;

function trackDb(db: ReturnType<typeof createDb>) {
  openDbs.push(db as ManagedDb);
  return db;
}

async function makeTempDbPath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nutrition-db-"));
  tempDirs.add(dir);
  return path.join(dir, "nutrition.db");
}

async function readMigrationSql(fileName: string) {
  return readFile(new URL(`../../drizzle/${fileName}`, import.meta.url), "utf8");
}

async function seedLegacySchema(dbPath: string) {
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(await readMigrationSql("0000_brainy_rocket_racer.sql"));
    sqlite.exec(await readMigrationSql("0001_sleepy_vivisector.sql"));
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`);

    const insertMigration = sqlite.prepare(
      'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
    );

    for (const row of legacyMigrationRows) {
      insertMigration.run(row.hash, row.createdAt);
    }
  } finally {
    sqlite.close();
  }
}

function getCanonicalTableNames(sqlite: Database.Database) {
  return sqlite
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('meal_transactions', 'meal_revisions', 'meal_revision_items', 'asset_references')
       ORDER BY name`,
    )
    .all();
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

  it("creates the canonical meal transaction and asset reference tables", async () => {
    const dbPath = await makeTempDbPath();

    await runMigrations(dbPath);

    const sqlite = new Database(dbPath);
    try {
      assert.deepEqual(getCanonicalTableNames(sqlite), [
        { name: "asset_references" },
        { name: "meal_revision_items" },
        { name: "meal_revisions" },
        { name: "meal_transactions" },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("backfills legacy meals into canonical meal_transactions rows and explicit asset_references", async () => {
    const dbPath = await makeTempDbPath();
    await seedLegacySchema(dbPath);

    const sqlite = new Database(dbPath);
    try {
      sqlite.pragma("foreign_keys = ON");
      sqlite.prepare(
        `INSERT INTO devices (
          id,
          goal,
          daily_calories,
          daily_protein,
          daily_carbs,
          daily_fat,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run("device-1", "fat_loss", 1800, 120, 180, 60, "2026-04-19T00:00:00.000Z");
      sqlite.prepare(
        `INSERT INTO assets (
          id,
          device_id,
          storage_key,
          mime_type,
          byte_size,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "asset-1",
        "device-1",
        "assets/device-1/asset-1.jpg",
        "image/jpeg",
        1234,
        "2026-04-19T00:00:00.000Z",
      );
      sqlite.prepare(
        `INSERT INTO meals (
          id,
          device_id,
          food_name,
          calories,
          protein,
          carbs,
          fat,
          image_path,
          logged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "meal-1",
        "device-1",
        "chicken breast",
        320,
        40,
        0,
        12,
        "asset:asset-1",
        "2026-04-19T08:30:00.000Z",
      );
      sqlite.prepare(
        `INSERT INTO chat_messages (
          id,
          device_id,
          role,
          content,
          image_path,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "chat-1",
        "device-1",
        "user",
        "please log this meal",
        "asset:asset-1",
        "2026-04-19T08:29:00.000Z",
      );
    } finally {
      sqlite.close();
    }

    await runMigrations(dbPath);

    const migrated = new Database(dbPath);
    try {
      assert.deepEqual(getCanonicalTableNames(migrated), [
        { name: "asset_references" },
        { name: "meal_revision_items" },
        { name: "meal_revisions" },
        { name: "meal_transactions" },
      ]);

      const transaction = migrated
        .prepare(
          `SELECT id, device_id, logged_at, current_revision_id, current_revision_number
           FROM meal_transactions
           WHERE id = ?`,
        )
        .get("meal-1");
      const revision = migrated
        .prepare(
          `SELECT id, transaction_id, revision_number, supersedes_revision_id, image_asset_id, change_type
           FROM meal_revisions
           WHERE transaction_id = ?`,
        )
        .get("meal-1");
      const item = migrated
        .prepare(
          `SELECT revision_id, position, food_name, calories, protein, carbs, fat
           FROM meal_revision_items
           WHERE revision_id = ?`,
        )
        .get("meal-1:r1");
      const refs = migrated
        .prepare(
          `SELECT owner_type, owner_id, asset_id
           FROM asset_references
           WHERE asset_id = ?
           ORDER BY owner_type, owner_id`,
        )
        .all("asset-1");

      assert.deepEqual(transaction, {
        id: "meal-1",
        device_id: "device-1",
        logged_at: "2026-04-19T08:30:00.000Z",
        current_revision_id: "meal-1:r1",
        current_revision_number: 1,
      });
      assert.deepEqual(revision, {
        id: "meal-1:r1",
        transaction_id: "meal-1",
        revision_number: 1,
        supersedes_revision_id: null,
        image_asset_id: "asset-1",
        change_type: "backfill",
      });
      assert.deepEqual(item, {
        revision_id: "meal-1:r1",
        position: 0,
        food_name: "chicken breast",
        calories: 320,
        protein: 40,
        carbs: 0,
        fat: 12,
      });
      assert.deepEqual(refs, [
        { owner_type: "chat_message", owner_id: "chat-1", asset_id: "asset-1" },
        { owner_type: "meal_revision", owner_id: "meal-1:r1", asset_id: "asset-1" },
      ]);
    } finally {
      migrated.close();
    }
  });

  it("rejects legacy-only file-backed databases and no longer requires the meals table at runtime", async () => {
    const dbPath = await makeTempDbPath();
    await seedLegacySchema(dbPath);

    assert.throws(
      () => createDb(dbPath),
      /Database schema missing\. Run `yarn db:migrate` before starting the app\./,
    );

    await runMigrations(dbPath);

    const sqlite = new Database(dbPath);
    try {
      sqlite.exec("DROP TABLE meals;");
    } finally {
      sqlite.close();
    }

    const db = trackDb(createDb(dbPath));
    const deviceService = createDeviceService(db);
    const result = await deviceService.createDevice("fat_loss");

    assert.ok(result.deviceId);
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
