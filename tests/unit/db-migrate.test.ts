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

async function seedSchemaThrough0004(dbPath: string) {
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    for (const fileName of [
      "0000_brainy_rocket_racer.sql",
      "0001_sleepy_vivisector.sql",
      "0002_meal_transaction_v2_foundation.sql",
      "0003_aspiring_masque.sql",
      "0004_history_query_hot_path_indexes.sql",
    ]) {
      sqlite.exec(await readMigrationSql(fileName));
    }
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`);
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
      .run("0004-test-hash", 1777266938000);
  } finally {
    sqlite.close();
  }
}

async function seedSchemaThrough0008(dbPath: string) {
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    for (const fileName of [
      "0000_brainy_rocket_racer.sql",
      "0001_sleepy_vivisector.sql",
      "0002_meal_transaction_v2_foundation.sql",
      "0003_aspiring_masque.sql",
      "0004_history_query_hot_path_indexes.sql",
      "0005_chat_message_status.sql",
      "0006_colossal_selene.sql",
      "0007_violet_living_lightning.sql",
      "0008_shiny_stellaris.sql",
    ]) {
      sqlite.exec(await readMigrationSql(fileName));
    }
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`);
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
      .run("0008-test-hash", 1780307250026);
  } finally {
    sqlite.close();
  }
}

async function seedSchemaThrough0010(dbPath: string) {
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    for (const fileName of [
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
    ]) {
      sqlite.exec(await readMigrationSql(fileName));
    }
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`);
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
      .run("0010-test-hash", 1781447465739);
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

function getChatMessageStatusColumns(sqlite: Database.Database) {
  return sqlite.prepare("PRAGMA table_info(chat_messages)").all().filter((column) => {
    return typeof column === "object" && column !== null && "name" in column && column.name === "status";
  });
}

function getDeviceSessionVersionColumns(sqlite: Database.Database) {
  return sqlite
    .prepare("PRAGMA table_info(devices)")
    .all()
    .filter((column) => {
      return typeof column === "object" && column !== null && "name" in column && column.name === "session_version";
    }) as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
}

function seedDevice(sqlite: Database.Database, deviceId = "device-1") {
  sqlite
    .prepare(
      `INSERT INTO devices (
        id,
        goal,
        daily_calories,
        daily_protein,
        daily_carbs,
        daily_fat,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(deviceId, "fat_loss", 1800, 120, 180, 60, "2026-04-19T00:00:00.000Z");
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

  it("adds chat_messages.status with the complete default and allowed-value CHECK", async () => {
    const dbPath = await makeTempDbPath();

    await runMigrations(dbPath);

    const sqlite = new Database(dbPath);
    try {
      sqlite.pragma("foreign_keys = ON");

      const [statusColumn] = getChatMessageStatusColumns(sqlite);
      assert.deepEqual(statusColumn, {
        cid: 7,
        name: "status",
        type: "TEXT",
        notnull: 1,
        dflt_value: "'complete'",
        pk: 0,
      });

      seedDevice(sqlite);
      sqlite
        .prepare(
          `INSERT INTO chat_messages (
            id,
            device_id,
            role,
            content,
            created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run("chat-1", "device-1", "assistant", "Logged.", "2026-04-19T08:29:00.000Z");

      assert.deepEqual(
        sqlite.prepare("SELECT status FROM chat_messages WHERE id = ?").get("chat-1"),
        { status: "complete" },
      );

      assert.throws(() => {
        sqlite
          .prepare(
            `INSERT INTO chat_messages (
              id,
              device_id,
              role,
              content,
              created_at,
              status
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "chat-2",
            "device-1",
            "assistant",
            "Bad status.",
            "2026-04-19T08:30:00.000Z",
            "cancelled",
          );
      }, /CHECK constraint failed/);
    } finally {
      sqlite.close();
    }
  });

  it("adds devices.session_version as a non-null integer defaulting to 0", async () => {
    const dbPath = await makeTempDbPath();

    await runMigrations(dbPath);

    const sqlite = new Database(dbPath);
    try {
      const [column] = getDeviceSessionVersionColumns(sqlite);
      assert.deepEqual(column, {
        cid: 19,
        name: "session_version",
        type: "INTEGER",
        notnull: 1,
        dflt_value: "0",
        pk: 0,
      });

      seedDevice(sqlite);
      assert.deepEqual(
        sqlite.prepare("SELECT session_version FROM devices WHERE id = ?").get("device-1"),
        { session_version: 0 },
      );
    } finally {
      sqlite.close();
    }
  });

  it("backfills existing devices with session_version 0", async () => {
    const dbPath = await makeTempDbPath();
    await seedSchemaThrough0010(dbPath);

    const sqlite = new Database(dbPath);
    try {
      sqlite.pragma("foreign_keys = ON");
      seedDevice(sqlite);
      assert.deepEqual(getDeviceSessionVersionColumns(sqlite), []);
    } finally {
      sqlite.close();
    }

    await runMigrations(dbPath);

    const migrated = new Database(dbPath);
    try {
      const [column] = getDeviceSessionVersionColumns(migrated);
      assert.equal(column?.dflt_value, "0");
      assert.deepEqual(
        migrated.prepare("SELECT session_version FROM devices WHERE id = ?").get("device-1"),
        { session_version: 0 },
      );
    } finally {
      migrated.close();
    }
  });

  it("treats a partial local chat_messages.status migration as already applied", async () => {
    const dbPath = await makeTempDbPath();

    await seedSchemaThrough0004(dbPath);

    const sqlite = new Database(dbPath);
    try {
      sqlite.exec(
        "ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','stopped','error'));",
      );
      seedDevice(sqlite);
      sqlite
        .prepare(
          `INSERT INTO chat_messages (
            id,
            device_id,
            role,
            content,
            created_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "chat-stopped",
          "device-1",
          "assistant",
          "Partial answer",
          "2026-04-19T08:31:00.000Z",
          "stopped",
        );
    } finally {
      sqlite.close();
    }

    await runMigrations(dbPath);

    const migrated = new Database(dbPath);
    try {
      assert.equal(getChatMessageStatusColumns(migrated).length, 1);
      assert.deepEqual(
        migrated.prepare("SELECT status FROM chat_messages WHERE id = ?").get("chat-stopped"),
        { status: "stopped" },
      );
    } finally {
      migrated.close();
    }
  });

  it("drops pre-migration pending rows and enforces the session-scoped unique key", async () => {
    const dbPath = await makeTempDbPath();
    await seedSchemaThrough0008(dbPath);

    const sqlite = new Database(dbPath);
    try {
      sqlite.pragma("foreign_keys = ON");
      seedDevice(sqlite);
      sqlite
        .prepare(
          `INSERT INTO turn_states (
            id,
            device_id,
            kind,
            payload,
            expires_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "device-1:goal_proposal",
          "device-1",
          "goal_proposal",
          JSON.stringify({ pending: true }),
          "2026-04-19T08:40:00.000Z",
          "2026-04-19T08:30:00.000Z",
          "2026-04-19T08:30:00.000Z",
        );

      assert.deepEqual(sqlite.prepare("SELECT COUNT(*) AS count FROM turn_states").get(), {
        count: 1,
      });
    } finally {
      sqlite.close();
    }

    await runMigrations(dbPath);

    const migrated = new Database(dbPath);
    try {
      migrated.pragma("foreign_keys = ON");

      assert.deepEqual(migrated.prepare("SELECT COUNT(*) AS count FROM turn_states").get(), {
        count: 0,
      });

      const indexRows = migrated.prepare("PRAGMA index_list(turn_states)").all() as Array<{
        name: string;
        unique: number;
      }>;
      assert.ok(
        indexRows.some((row) => row.name === "turn_states_device_session_kind_uq" && row.unique === 1),
      );
      assert.equal(
        indexRows.some((row) => row.name === "turn_states_device_kind_uq"),
        false,
      );

      assert.throws(() => {
        migrated
          .prepare(
            `INSERT INTO turn_states (
              id,
              device_id,
              kind,
              payload,
              expires_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "device-1:missing-session",
            "device-1",
            "goal_proposal",
            "{}",
            "2026-04-19T08:40:00.000Z",
            "2026-04-19T08:30:00.000Z",
            "2026-04-19T08:30:00.000Z",
          );
      }, /NOT NULL constraint failed: turn_states\.session_id|SQLITE_CONSTRAINT_NOTNULL/);

      const insertScopedState = migrated.prepare(
        `INSERT INTO turn_states (
          id,
          device_id,
          session_id,
          kind,
          payload,
          expires_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertScopedState.run(
        "device-1:session-a:goal_proposal",
        "device-1",
        "session-a",
        "goal_proposal",
        JSON.stringify({ session: "a" }),
        "2026-04-19T08:40:00.000Z",
        "2026-04-19T08:30:00.000Z",
        "2026-04-19T08:30:00.000Z",
      );
      insertScopedState.run(
        "device-1:session-b:goal_proposal",
        "device-1",
        "session-b",
        "goal_proposal",
        JSON.stringify({ session: "b" }),
        "2026-04-19T08:40:00.000Z",
        "2026-04-19T08:30:00.000Z",
        "2026-04-19T08:30:00.000Z",
      );

      assert.deepEqual(
        migrated
          .prepare(
            `SELECT session_id
             FROM turn_states
             WHERE device_id = ? AND kind = ?
             ORDER BY session_id`,
          )
          .all("device-1", "goal_proposal"),
        [{ session_id: "session-a" }, { session_id: "session-b" }],
      );

      assert.throws(() => {
        insertScopedState.run(
          "device-1:session-a:goal_proposal:duplicate",
          "device-1",
          "session-a",
          "goal_proposal",
          JSON.stringify({ session: "a-replacement" }),
          "2026-04-19T08:45:00.000Z",
          "2026-04-19T08:35:00.000Z",
          "2026-04-19T08:35:00.000Z",
        );
      }, /UNIQUE constraint failed/);
    } finally {
      migrated.close();
    }
  });
});
