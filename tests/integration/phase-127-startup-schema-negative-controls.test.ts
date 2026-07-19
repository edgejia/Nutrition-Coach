process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { buildApp } from "../../server/app.js";
import { createDb } from "../../server/db/client.js";
import { EXPECTED_MIGRATIONS } from "../../server/db/schema-manifest.js";
import { runMigrations } from "../../server/db/migrate.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

const temporaryDirectories = new Set<string>();

async function makeDbPath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nutrition-phase-127-schema-"));
  temporaryDirectories.add(directory);
  return path.join(directory, "nutrition.db");
}

async function readMigrationSql(tag: string) {
  return readFile(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8");
}

async function seedThrough(tagCount: number) {
  const dbPath = await makeDbPath();
  const sqlite = new Database(dbPath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    for (const migration of EXPECTED_MIGRATIONS.slice(0, tagCount)) {
      sqlite.exec(await readMigrationSql(migration.tag));
    }
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`);
    const insertMigration = sqlite.prepare(
      'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
    );
    for (const migration of EXPECTED_MIGRATIONS.slice(0, tagCount)) {
      insertMigration.run(migration.hash, migration.createdAt);
    }
  } finally {
    sqlite.close();
  }

  return dbPath;
}

async function mutateDb(dbPath: string, mutate: (sqlite: Database.Database) => void) {
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("foreign_keys = ON");
    mutate(sqlite);
  } finally {
    sqlite.close();
  }
}

async function assertStartupRejects(dbPath: string, code: string) {
  let composed = false;
  await assert.rejects(
    buildApp({
      dbPath,
      llmProvider: new MockLLMProvider(),
      onServicesReady: () => {
        composed = true;
      },
    }),
    (error: unknown) => error instanceof Error && error.message.includes(code),
  );
  assert.equal(composed, false);
}

afterEach(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("Phase 127 NC-COR-06 startup schema provenance", () => {
  it("admits a fully migrated file-backed database before service composition", async () => {
    const dbPath = await makeDbPath();
    await runMigrations(dbPath);

    let composed = false;
    const app = await buildApp({
      dbPath,
      llmProvider: new MockLLMProvider(),
      onServicesReady: () => {
        composed = true;
      },
    });
    try {
      assert.equal(composed, true);
    } finally {
      await app.close();
    }
  });

  it("rejects a fully migrated database with a required column removed", async () => {
    const dbPath = await makeDbPath();
    await runMigrations(dbPath);
    await mutateDb(dbPath, (sqlite) => sqlite.exec("ALTER TABLE devices DROP COLUMN session_version"));

    await assertStartupRejects(dbPath, "DB_SCHEMA_MISSING_COLUMN");
  });

  it("rejects a fully migrated database with a removed journal entry", async () => {
    const dbPath = await makeDbPath();
    await runMigrations(dbPath);
    await mutateDb(dbPath, (sqlite) => {
      sqlite
        .prepare('DELETE FROM "__drizzle_migrations" WHERE "created_at" = ?')
        .run(EXPECTED_MIGRATIONS.at(-1)?.createdAt);
    });

    await assertStartupRejects(dbPath, "DB_MIGRATION_JOURNAL_MISMATCH");
  });

  it("rejects a fully migrated database with a mismatched journal hash", async () => {
    const dbPath = await makeDbPath();
    await runMigrations(dbPath);
    await mutateDb(dbPath, (sqlite) => {
      sqlite
        .prepare('UPDATE "__drizzle_migrations" SET "hash" = ? WHERE "created_at" = ?')
        .run("mismatched", EXPECTED_MIGRATIONS.at(-1)?.createdAt);
    });

    await assertStartupRejects(dbPath, "DB_MIGRATION_JOURNAL_MISMATCH");
  });

  it("rejects through-0010 schema before later service queries", async () => {
    const dbPath = await seedThrough(11);

    await assertStartupRejects(dbPath, "DB_SCHEMA_MISSING_COLUMN");
  });

  it("rejects a through-0010 schema that impersonates 0011 by adding only its column", async () => {
    const dbPath = await seedThrough(11);
    await mutateDb(dbPath, (sqlite) => {
      sqlite.exec("ALTER TABLE devices ADD COLUMN session_version INTEGER DEFAULT 0 NOT NULL");
    });

    await assertStartupRejects(dbPath, "DB_MIGRATION_JOURNAL_MISMATCH");
  });

  it("preserves the explicit partial chat_messages.status migration compatibility path", async () => {
    const dbPath = await seedThrough(5);
    await mutateDb(dbPath, (sqlite) => {
      sqlite.exec(
        "ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','stopped','error'))",
      );
    });
    await runMigrations(dbPath);

    const db = createDb(dbPath);
    db.$client.close();
  });
});
