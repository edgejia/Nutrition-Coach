import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, "../../drizzle");

export function applyMigrations(sqlite: Database.Database) {
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
  const dbPath = process.env.DB_PATH ?? "./data/nutrition.db";
  await runMigrations(dbPath);
}
