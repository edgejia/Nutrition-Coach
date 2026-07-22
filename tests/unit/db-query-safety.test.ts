process.env.TZ = "Asia/Taipei";

import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const wrapperPath = path.resolve(".codex/skills/nutrition-db-query/db-query.sh");

function digest(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nutrition-db-query-"));
  const databasePath = path.join(root, "fixture.sqlite");
  const initialized = spawnSync(
    "sqlite3",
    [databasePath, "CREATE TABLE meals(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO meals(name) VALUES ('oats');"],
    { encoding: "utf8" },
  );
  assert.equal(initialized.status, 0, `${initialized.stdout}${initialized.stderr}`);
  return { root, databasePath };
}

function runQuery(databasePath: string, query: string, ...extraArgs: string[]) {
  return spawnSync("bash", [wrapperPath, query, ...extraArgs], {
    env: { ...process.env, DB_QUERY_PATH: databasePath, TZ: "Asia/Taipei" },
    encoding: "utf8",
  });
}

describe("nutrition DB query safety wrapper", () => {
  it("allows only the documented read-only query forms", (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    for (const query of [
      ".tables",
      ".schema",
      ".schema meals",
      "SELECT id, name FROM meals;",
      "WITH recent AS (SELECT id FROM meals) SELECT * FROM recent",
      "PRAGMA table_info(meals);",
      "PRAGMA database_list",
      "EXPLAIN SELECT id FROM meals",
    ]) {
      const result = runQuery(fixture.databasePath, query);
      assert.equal(result.status, 0, `${query}\n${result.stdout}${result.stderr}`);
    }
  });

  it("rejects unsafe input and leaves the database bytes unchanged", (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    for (const query of [
      ".shell touch /tmp/db-query-should-not-run",
      ".output /tmp/db-query-should-not-write",
      ".mode csv",
      "SELECT 1; SELECT 2",
      "INSERT INTO meals(name) VALUES ('write')",
      "WITH changed AS (DELETE FROM meals RETURNING id) SELECT * FROM changed",
      "PRAGMA journal_mode = WAL",
      "PRAGMA wal_checkpoint",
      ".schema meals; .shell echo unsafe",
    ]) {
      const before = digest(fixture.databasePath);
      const result = runQuery(fixture.databasePath, query);
      const after = digest(fixture.databasePath);
      assert.notEqual(result.status, 0, query);
      assert.equal(after, before, `database changed for rejected query: ${query}`);
    }

    const before = digest(fixture.databasePath);
    const extraArg = runQuery(fixture.databasePath, "SELECT 1", "SELECT 2");
    assert.notEqual(extraArg.status, 0);
    assert.equal(digest(fixture.databasePath), before);
  });

  it("rejects a database symlink instead of following it", (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const linkedPath = path.join(fixture.root, "linked.sqlite");
    fs.symlinkSync(fixture.databasePath, linkedPath);
    const result = runQuery(linkedPath, "SELECT 1");
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /regular non-symlink|symbolic|nofollow/i);
  });
});
