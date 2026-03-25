import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type AppDatabase = ReturnType<typeof createDb>;

export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      daily_calories INTEGER NOT NULL,
      daily_protein INTEGER NOT NULL,
      daily_carbs INTEGER NOT NULL,
      daily_fat INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id),
      food_name TEXT NOT NULL,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      image_path TEXT,
      logged_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      image_path TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}
