import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../..", import.meta.url);

function readRepoFile(path: string) {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

function readGeneratedMigration() {
  const drizzleDir = new URL("drizzle", repoRoot);
  const migrationName = readdirSync(drizzleDir).find((name) => /^0006_.*\.sql$/.test(name));
  assert.ok(migrationName, "expected generated drizzle/0006_*.sql migration");
  return readFileSync(join(drizzleDir.pathname, migrationName), "utf8");
}

describe("chat meal receipt schema", () => {
  it("declares assistant receipt to meal transaction and revision identity", () => {
    const schema = readRepoFile("server/db/schema.ts");

    assert.match(schema, /export const chatMealReceipts = sqliteTable\(\s*"chat_meal_receipts"/);
    assert.match(schema, /assistantMessageId:\s*text\("assistant_message_id"\)/);
    assert.match(schema, /toolMessageId:\s*text\("tool_message_id"\)/);
    assert.match(schema, /mealTransactionId:\s*text\("meal_transaction_id"\)/);
    assert.match(schema, /mealRevisionId:\s*text\("meal_revision_id"\)/);
    assert.match(schema, /chat_meal_receipts_assistant_message_uq/);
    assert.match(schema, /chat_meal_receipts_device_assistant_idx/);
    assert.match(schema, /chat_meal_receipts_device_meal_idx/);
  });

  it("has a generated migration and journal entry for receipt identity persistence", () => {
    const migration = readGeneratedMigration();
    const journal = readRepoFile("drizzle/meta/_journal.json");
    const snapshotPath = new URL("drizzle/meta/0006_snapshot.json", repoRoot);

    assert.ok(existsSync(snapshotPath), "expected generated drizzle/meta/0006_snapshot.json");
    assert.match(migration, /CREATE TABLE `chat_meal_receipts`/);
    assert.match(migration, /`assistant_message_id` text NOT NULL/);
    assert.match(migration, /`tool_message_id` text/);
    assert.match(migration, /`meal_transaction_id` text NOT NULL/);
    assert.match(migration, /`meal_revision_id` text NOT NULL/);
    assert.match(migration, /chat_meal_receipts_assistant_message_uq/);
    assert.match(migration, /chat_meal_receipts_device_assistant_idx/);
    assert.match(migration, /chat_meal_receipts_device_meal_idx/);
    assert.match(journal, /"tag": "0006_/);
  });
});
