import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { applyMigrations } from "./migrate.js";

export type AppDatabase = ReturnType<typeof createDb>;

const requiredTables = [
  "devices",
  "chat_messages",
  "assets",
  "meal_transactions",
  "meal_revisions",
  "meal_revision_items",
  "asset_references",
  "turn_states",
] as const;

function hasTable(sqlite: Database.Database, name: string) {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(name),
  );
}

function validateRequiredSchema(sqlite: Database.Database) {
  const missingTables = requiredTables.filter((name) => !hasTable(sqlite, name));
  if (missingTables.length > 0) {
    throw new Error("Database schema missing. Run `yarn db:migrate` before starting the app.");
  }
}

export function createDb(dbPath: string, opts?: { allowInMemoryBootstrap?: boolean }) {
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    if (dbPath === ":memory:" && opts?.allowInMemoryBootstrap !== false) {
      applyMigrations(sqlite);
    } else {
      validateRequiredSchema(sqlite);
    }

    return drizzle(sqlite, { schema });
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
