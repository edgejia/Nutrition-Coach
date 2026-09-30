#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function allowedRoots() {
  const configured = (process.env.DB_QUERY_ALLOWED_ROOTS || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([process.cwd(), os.tmpdir(), ...configured].map((value) => path.resolve(value)))];
}

function validateDatabasePath(databasePath) {
  const resolved = path.resolve(databasePath);
  const roots = allowedRoots();
  for (const root of roots) {
    let rootStat;
    try {
      rootStat = fs.lstatSync(root);
    } catch (error) {
      throw new Error(error?.code === "ENOENT" ? `approved database root is missing: ${root}` : `approved database root is unreadable: ${root}`);
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`approved database root must be a physical directory: ${root}`);
  }
  if (!roots.some((root) => isWithin(root, resolved))) {
    throw new Error(`database path is outside approved local roots: ${resolved}`);
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new Error(error?.code === "ENOENT" ? `database path is missing: ${resolved}` : `database path is unreadable: ${resolved}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`database path must be a regular non-symlink file: ${resolved}`);

  const root = roots.find((candidate) => isWithin(candidate, resolved));
  let current = root;
  const parentRelative = path.relative(root, path.dirname(resolved));
  for (const part of parentRelative ? parentRelative.split(path.sep) : []) {
    current = path.join(current, part);
    const parentStat = fs.lstatSync(current);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error(`database path has a symlinked or unsafe ancestor: ${current}`);
  }
  // sqlite3's -nofollow checks every path component. macOS exposes /var as a
  // compatibility symlink, so pass the canonical regular-file path after the
  // lstat/ancestor checks above rather than making safe temporary fixtures
  // fail on a harmless system alias.
  return fs.realpathSync.native(resolved);
}

function sqliteSupportsNoFollow() {
  const probe = spawnSync("sqlite3", ["-help"], { encoding: "utf8" });
  return /(?:^|\s)-nofollow(?:\s|$)/m.test(`${probe.stdout || ""}\n${probe.stderr || ""}`);
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
  let canonicalDatabasePath;
  try {
    canonicalDatabasePath = validateDatabasePath(databasePath);
  } catch (error) {
    reject(error instanceof Error ? error.message : String(error));
    return;
  }

  let query;
  try {
    query = validateQuery(args[1]);
  } catch (error) {
    reject(error instanceof Error ? error.message : String(error));
    return;
  }

  const sqliteArgs = ["-readonly", "-safe"];
  if (sqliteSupportsNoFollow()) sqliteArgs.push("-nofollow");
  sqliteArgs.push("-header", "-column", canonicalDatabasePath, query);
  const result = spawnSync(
    "sqlite3",
    sqliteArgs,
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
