#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const READ_ONLY_PRAGMAS = new Set([
  "application_id",
  "compile_options",
  "database_list",
  "data_version",
  "freelist_count",
  "foreign_key_check",
  "foreign_key_list",
  "index_info",
  "index_list",
  "index_xinfo",
  "integrity_check",
  "journal_mode",
  "page_count",
  "page_size",
  "quick_check",
  "schema_version",
  "table_info",
  "table_xinfo",
  "user_version",
]);

const MUTATING_KEYWORDS =
  /\b(?:ATTACH|ALTER|ANALYZE|BEGIN|COMMIT|CREATE|DELETE|DETACH|DROP|END|INSERT|REINDEX|RELEASE|REPLACE|ROLLBACK|SAVEPOINT|TRANSACTION|TRUNCATE|UPDATE|UPSERT|VACUUM)\b/i;

function reject(message) {
  process.stderr.write(`safe-db-query: ${message}\n`);
  process.exitCode = 2;
}

function normalizeQuery(value) {
  let query = value.trimEnd();
  if (query.endsWith(";")) query = query.slice(0, -1);
  if (query.includes(";")) throw new Error("queries must contain one statement and at most one trailing semicolon");
  if (query.length === 0) throw new Error("query must not be empty");
  return query;
}

function isReadOnlyPragma(query) {
  const match = query.match(
    /^\s*PRAGMA\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*|'[^']*'|"[^"]*")\s*\))?\s*$/i,
  );
  if (!match || !READ_ONLY_PRAGMAS.has(match[1].toLowerCase())) return false;
  if (/^\s*PRAGMA\s+[^\s=()]+\s*=/.test(query)) return false;
  if (/^\s*PRAGMA\s+(?:wal_checkpoint|checkpoint|optimize|shrink_memory|incremental_vacuum|locking_mode|journal_mode)\s*\(/i.test(query)) return false;
  return true;
}

function isAllowedQuery(query) {
  if (/^\s*\.tables\s*$/.test(query)) return true;
  if (/^\s*\.schema(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/.test(query)) return true;
  if (/^\s*(?:SELECT|WITH|EXPLAIN)(?:\s|$)/i.test(query)) return true;
  return isReadOnlyPragma(query);
}

function validateQuery(rawQuery) {
  const query = normalizeQuery(rawQuery);
  if (!isAllowedQuery(query)) {
    throw new Error("only .tables, .schema, SELECT/WITH/EXPLAIN, or an allowlisted read-only PRAGMA is permitted");
  }
  if (MUTATING_KEYWORDS.test(query)) throw new Error("mutating SQL is not permitted");
  return query;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !args[0].startsWith("--db=")) {
    reject("usage: safe-db-query.mjs --db=<sqlite-path> \"<one read-only query>\"");
    return;
  }

  const databasePath = args[0].slice("--db=".length);
  if (!databasePath) {
    reject("database path must not be empty");
    return;
  }

  let query;
  try {
    query = validateQuery(args[1]);
  } catch (error) {
    reject(error instanceof Error ? error.message : String(error));
    return;
  }

  const result = spawnSync(
    "sqlite3",
    ["-readonly", "-safe", "-header", "-column", databasePath, query],
    { env: { ...process.env, TZ: "Asia/Taipei" }, encoding: "utf8" },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    reject(result.error.message);
    return;
  }
  process.exitCode = result.status ?? 1;
}

main();
