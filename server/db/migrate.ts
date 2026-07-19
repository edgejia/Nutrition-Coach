import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  CHAT_MESSAGE_STATUS_MIGRATION_TAG,
  getExpectedMigration,
  hasExpectedChatMessageStatusDefinition,
} from "./schema-manifest.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, "../../drizzle");

function hasTable(sqlite: Database.Database, tableName: string) {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName),
  );
}

function hasColumn(sqlite: Database.Database, tableName: string, columnName: string) {
  return sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => {
      return (
        typeof column === "object" &&
        column !== null &&
        "name" in column &&
        column.name === columnName
      );
    });
}

function getChatMessageStatusMigrationMeta() {
  const migration = getExpectedMigration(CHAT_MESSAGE_STATUS_MIGRATION_TAG);

  return {
    hash: migration.hash,
    createdAt: migration.createdAt,
  };
}

function markChatMessageStatusMigrationApplied(sqlite: Database.Database) {
  if (!hasTable(sqlite, "__drizzle_migrations")) {
    return;
  }

  const { hash, createdAt } = getChatMessageStatusMigrationMeta();
  const existing = sqlite
    .prepare('SELECT 1 FROM "__drizzle_migrations" WHERE "created_at" = ? LIMIT 1')
    .get(createdAt);

  if (existing) {
    return;
  }

  sqlite
    .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
    .run(hash, createdAt);
}

function reconcilePartialChatMessageStatusMigration(sqlite: Database.Database) {
  if (hasTable(sqlite, "chat_messages") && hasColumn(sqlite, "chat_messages", "status")) {
    if (!hasExpectedChatMessageStatusDefinition(sqlite)) {
      throw new Error("Database migration compatibility failed: DB_MIGRATION_PARTIAL_STATUS_INVALID.");
    }
    markChatMessageStatusMigrationApplied(sqlite);
  }
}

export function applyMigrations(sqlite: Database.Database) {
  reconcilePartialChatMessageStatusMigration(sqlite);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
}

export async function runMigrations(dbPath: string) {
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    applyMigrations(sqlite);
  } finally {
    sqlite.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (existsSync(".env")) {
    loadEnvFile(".env");
  }
  const dbPath = process.env.DB_PATH ?? "./data/nutrition.db";
  await runMigrations(dbPath);
}
