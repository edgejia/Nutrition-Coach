import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, "../../drizzle");

export const RUNTIME_REQUIRED_COLUMNS = {
  devices: [
    "id",
    "goal",
    "sex",
    "age",
    "height_cm",
    "weight_kg",
    "activity_level",
    "training_frequency",
    "allergies",
    "goal_clarification",
    "body_fat_percent",
    "tdee",
    "advanced_notes",
    "coach_explanation",
    "daily_calories",
    "daily_protein",
    "daily_carbs",
    "daily_fat",
    "created_at",
    "session_version",
  ],
  chat_messages: [
    "id",
    "device_id",
    "role",
    "content",
    "tool_name",
    "image_path",
    "created_at",
    "status",
  ],
  chat_meal_receipts: [
    "id",
    "device_id",
    "assistant_message_id",
    "tool_message_id",
    "meal_transaction_id",
    "meal_revision_id",
    "created_at",
  ],
  chat_mutation_outcomes: [
    "id",
    "device_id",
    "assistant_message_id",
    "tool_message_id",
    "action",
    "affected_date",
    "food_name",
    "calories",
    "protein",
    "carbs",
    "fat",
    "goal_calories",
    "goal_protein",
    "goal_carbs",
    "goal_fat",
    "updated_goal_fields",
    "created_at",
  ],
  assets: ["id", "device_id", "storage_key", "mime_type", "byte_size", "created_at"],
  meal_transactions: [
    "id",
    "device_id",
    "logged_at",
    "meal_period",
    "current_revision_id",
    "current_revision_number",
    "deleted_at",
    "created_at",
  ],
  meal_revisions: [
    "id",
    "transaction_id",
    "revision_number",
    "supersedes_revision_id",
    "image_asset_id",
    "change_type",
    "created_at",
  ],
  meal_revision_items: [
    "revision_id",
    "position",
    "food_name",
    "calories",
    "protein",
    "carbs",
    "fat",
  ],
  asset_references: [
    "id",
    "asset_id",
    "device_id",
    "owner_type",
    "owner_id",
    "created_at",
  ],
  turn_states: [
    "id",
    "device_id",
    "session_id",
    "kind",
    "payload",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  chat_proposal_cards: [
    "id",
    "device_id",
    "assistant_message_id",
    "proposal_id",
    "proposal_kind",
    "proposal_lane",
    "status",
    "title",
    "details_json",
    "actions_json",
    "expires_at",
    "lapse_copy",
    "superseded_by_kind",
    "created_at",
    "updated_at",
  ],
  chat_proposal_action_events: [
    "id",
    "device_id",
    "action_message_id",
    "assistant_message_id",
    "proposal_id",
    "proposal_kind",
    "proposal_lane",
    "action",
    "transcript_copy",
    "created_at",
  ],
} as const;

export const EXPECTED_MIGRATIONS = [
  {
    idx: 0,
    tag: "0000_brainy_rocket_racer",
    createdAt: 1776562979498,
    hash: "707b12f52b5734d33efe907c83894ed0aff6e3cbd024d0bcd27849234e382776",
  },
  {
    idx: 1,
    tag: "0001_sleepy_vivisector",
    createdAt: 1776563328911,
    hash: "33424b94bdaa968533b527a475fc4fc9f98f0fb326c2d932dc16d98d3d01070c",
  },
  {
    idx: 2,
    tag: "0002_meal_transaction_v2_foundation",
    createdAt: 1776591621715,
    hash: "218699ba5b0286e7fb4f9b20cb92cdaca352c7554117fd2cd07513c7154f8ff5",
  },
  {
    idx: 3,
    tag: "0003_aspiring_masque",
    createdAt: 1776601380275,
    hash: "bce158fb092649a7fc89976b1f89b7f5c2d7e30f93f96406c2a6915c88d79e68",
  },
  {
    idx: 4,
    tag: "0004_history_query_hot_path_indexes",
    createdAt: 1777266938000,
    hash: "c68e18c4742c2aab0278489384b64b025b40d4b19f2dd5b35c0eddbb65928b18",
  },
  {
    idx: 5,
    tag: "0005_chat_message_status",
    createdAt: 1777923000000,
    hash: "830dc129ffb72b204f9d10e71a204803544e6ae1fe5759a4d9742a2b68a5a54b",
  },
  {
    idx: 6,
    tag: "0006_colossal_selene",
    createdAt: 1777996719981,
    hash: "bdc897140b57980ccf196cf9f81275b948f99b8eceab0d0202d543e8b91c59b6",
  },
  {
    idx: 7,
    tag: "0007_violet_living_lightning",
    createdAt: 1779885876635,
    hash: "4ddda5ce2246f9084c3f3978ceb9ab277edce2a8a80ab66b54084c1caa02f063",
  },
  {
    idx: 8,
    tag: "0008_shiny_stellaris",
    createdAt: 1780307250026,
    hash: "c759aab9626de5637420fea4716cd5a946ae8d7b5dc3813a2f2d522f876bab77",
  },
  {
    idx: 9,
    tag: "0009_blushing_william_stryker",
    createdAt: 1781175551995,
    hash: "ef9ee7c7bb37691ee7bfa6cceba8765b7609d8784e8ea4f6121039a216eb6656",
  },
  {
    idx: 10,
    tag: "0010_fuzzy_black_tom",
    createdAt: 1781447465739,
    hash: "87dabb5f994af8fffacd1ae2b1be21e520238961f4ff5c156f15a7855052749b",
  },
  {
    idx: 11,
    tag: "0011_square_jackal",
    createdAt: 1781900417940,
    hash: "9f61a0ba165ff2c821560ee0cf42f8e2007a55ec63c79829e2a635607572f7fb",
  },
] as const;

export const CHAT_MESSAGE_STATUS_MIGRATION_TAG = "0005_chat_message_status";

export type SchemaPreflightCode =
  | "DB_SCHEMA_MISSING_COLUMN"
  | "DB_MIGRATION_SOURCE_MANIFEST_MISMATCH"
  | "DB_MIGRATION_JOURNAL_MISSING"
  | "DB_MIGRATION_JOURNAL_MISMATCH"
  | "DB_MIGRATION_SQL_HASH_MISMATCH";

export class SchemaPreflightError extends Error {
  readonly code: SchemaPreflightCode;

  constructor(code: SchemaPreflightCode) {
    super(`Database startup preflight failed: ${code}.`);
    this.name = "SchemaPreflightError";
    this.code = code;
  }
}

function fail(code: SchemaPreflightCode): never {
  throw new SchemaPreflightError(code);
}

function hasTable(sqlite: Database.Database, tableName: string) {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName),
  );
}

function getColumns(sqlite: Database.Database, tableName: string) {
  return new Set(
    sqlite
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .flatMap((column) => {
        if (typeof column !== "object" || column === null || !("name" in column)) {
          return [];
        }
        return typeof column.name === "string" ? [column.name] : [];
      }),
  );
}

function readCheckedInJournal() {
  return JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
}

function validateCheckedInMigrationSource() {
  let journal: ReturnType<typeof readCheckedInJournal>;
  try {
    journal = readCheckedInJournal();
  } catch {
    fail("DB_MIGRATION_SOURCE_MANIFEST_MISMATCH");
  }

  if (
    journal.entries.length !== EXPECTED_MIGRATIONS.length ||
    journal.entries.some((entry, index) => {
      const expected = EXPECTED_MIGRATIONS[index];
      return entry.idx !== expected.idx || entry.tag !== expected.tag || entry.when !== expected.createdAt;
    })
  ) {
    fail("DB_MIGRATION_SOURCE_MANIFEST_MISMATCH");
  }

  for (const migration of EXPECTED_MIGRATIONS) {
    let sql: string;
    try {
      sql = readFileSync(path.join(migrationsFolder, `${migration.tag}.sql`), "utf8");
    } catch {
      fail("DB_MIGRATION_SQL_HASH_MISMATCH");
    }
    if (createHash("sha256").update(sql).digest("hex") !== migration.hash) {
      fail("DB_MIGRATION_SQL_HASH_MISMATCH");
    }
  }
}

function validateMigrationJournal(sqlite: Database.Database) {
  if (!hasTable(sqlite, "__drizzle_migrations")) {
    fail("DB_MIGRATION_JOURNAL_MISSING");
  }

  const rows = sqlite
    .prepare('SELECT "hash", "created_at" FROM "__drizzle_migrations" ORDER BY "created_at", rowid')
    .all() as Array<{ hash: unknown; created_at: unknown }>;

  if (
    rows.length !== EXPECTED_MIGRATIONS.length ||
    rows.some((row, index) => {
      const expected = EXPECTED_MIGRATIONS[index];
      return row.hash !== expected.hash || Number(row.created_at) !== expected.createdAt;
    })
  ) {
    fail("DB_MIGRATION_JOURNAL_MISMATCH");
  }
}

export function getExpectedMigration(tag: string) {
  const migration = EXPECTED_MIGRATIONS.find((candidate) => candidate.tag === tag);
  if (!migration) {
    throw new Error("Unknown migration tag.");
  }
  return migration;
}

export function hasExpectedChatMessageStatusDefinition(sqlite: Database.Database) {
  if (!hasTable(sqlite, "chat_messages")) {
    return false;
  }

  const statusColumn = sqlite
    .prepare("PRAGMA table_info(chat_messages)")
    .all()
    .find((column) => {
      return typeof column === "object" && column !== null && "name" in column && column.name === "status";
    }) as { type?: unknown; notnull?: unknown; dflt_value?: unknown } | undefined;

  if (
    statusColumn?.type !== "TEXT" ||
    statusColumn.notnull !== 1 ||
    statusColumn.dflt_value !== "'complete'"
  ) {
    return false;
  }

  const tableSql = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_messages'")
    .get() as { sql?: unknown } | undefined;
  return (
    typeof tableSql?.sql === "string" &&
    /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'complete'\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'complete'\s*,\s*'stopped'\s*,\s*'error'\s*\)\s*\)/i.test(
      tableSql.sql,
    )
  );
}

export function validateRuntimeSchema(sqlite: Database.Database) {
  validateCheckedInMigrationSource();

  for (const [tableName, requiredColumns] of Object.entries(RUNTIME_REQUIRED_COLUMNS)) {
    const actualColumns = getColumns(sqlite, tableName);
    if (requiredColumns.some((columnName) => !actualColumns.has(columnName))) {
      fail("DB_SCHEMA_MISSING_COLUMN");
    }
  }

  validateMigrationJournal(sqlite);
}
