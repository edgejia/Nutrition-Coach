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
      sex TEXT,
      age INTEGER,
      height_cm REAL,
      weight_kg REAL,
      activity_level TEXT,
      training_frequency TEXT,
      allergies TEXT,
      goal_clarification TEXT,
      body_fat_percent REAL,
      tdee REAL,
      advanced_notes TEXT,
      coach_explanation TEXT,
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

  const deviceColumns = [
    'ALTER TABLE devices ADD COLUMN sex TEXT',
    'ALTER TABLE devices ADD COLUMN age INTEGER',
    'ALTER TABLE devices ADD COLUMN height_cm REAL',
    'ALTER TABLE devices ADD COLUMN weight_kg REAL',
    'ALTER TABLE devices ADD COLUMN activity_level TEXT',
    'ALTER TABLE devices ADD COLUMN training_frequency TEXT',
    'ALTER TABLE devices ADD COLUMN allergies TEXT',
    'ALTER TABLE devices ADD COLUMN goal_clarification TEXT',
    'ALTER TABLE devices ADD COLUMN body_fat_percent REAL',
    'ALTER TABLE devices ADD COLUMN tdee REAL',
    'ALTER TABLE devices ADD COLUMN advanced_notes TEXT',
    'ALTER TABLE devices ADD COLUMN coach_explanation TEXT',
  ];

  for (const statement of deviceColumns) {
    try {
      sqlite.exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate column|already exists/i.test(message)) {
        continue;
      }
      throw error;
    }
  }

  return drizzle(sqlite, { schema });
}
