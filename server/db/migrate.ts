import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, "../../drizzle");
const chatMessageStatusMigrationTag = "0005_chat_message_status";

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
  const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const entry = journal.entries.find((candidate) => candidate.tag === chatMessageStatusMigrationTag);

  if (!entry) {
    throw new Error(`Missing ${chatMessageStatusMigrationTag} journal entry.`);
  }

  const query = readFileSync(path.join(migrationsFolder, `${chatMessageStatusMigrationTag}.sql`), "utf8");

  return {
    hash: createHash("sha256").update(query).digest("hex"),
    createdAt: entry.when,
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
  const dbPath = process.env.DB_PATH ?? "./data/nutrition.db";
  await runMigrations(dbPath);
}
