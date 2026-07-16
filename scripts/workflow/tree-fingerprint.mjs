#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const READ_CHUNK_BYTES = 1024 * 1024;

export class TreeFingerprintError extends Error {
  constructor(code) {
    super(code);
    this.name = "TreeFingerprintError";
    this.code = code;
  }
}

function fail(code) {
  throw new TreeFingerprintError(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mode(stat) {
  return (stat.mode & 0o777).toString(8).padStart(3, "0");
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function fileDigest(absolute, expectedStat) {
  let handle;
  try {
    handle = await fs.open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("tree_entry_changed_or_unsafe");
  }
  try {
    const before = await handle.stat();
    requireCondition(
      before.isFile() && sameFileSnapshot(before, expectedStat),
      "tree_entry_changed_or_unsafe",
    );
    requireCondition(before.size <= MAX_FILE_BYTES, "tree_file_limit_exceeded");

    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, Math.max(before.size, 1)));
    let offset = 0;
    while (offset < before.size) {
      const length = Math.min(buffer.length, before.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      requireCondition(bytesRead === length, "tree_entry_changed_or_unsafe");
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }

    const after = await handle.stat();
    requireCondition(sameFileSnapshot(after, before), "tree_entry_changed_or_unsafe");
    return digest.digest("hex");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function fingerprintTreeOnce(options) {
  requireCondition(typeof options.root === "string" && path.isAbsolute(options.root), "tree_root_must_be_absolute");
  const root = path.resolve(options.root);
  const rootStat = await fs.lstat(root).catch(() => null);
  requireCondition(rootStat?.isDirectory() && !rootStat.isSymbolicLink(), "tree_root_missing_or_unsafe");
  const entries = [{ path: ".", type: "directory", mode: mode(rootStat), size: 0 }];
  let totalFileBytes = 0;

  async function visit(directory, relativeDirectory) {
    const children = await fs.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      requireCondition(!child.name.includes("\n") && !child.name.includes("\r"), "tree_entry_name_unsafe");
      const absolute = path.join(directory, child.name);
      const relative = path.posix.join(relativeDirectory, child.name);
      const stat = await fs.lstat(absolute);
      requireCondition(entries.length < MAX_ENTRIES, "tree_entry_limit_exceeded");
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(absolute);
        const after = await fs.lstat(absolute).catch(() => null);
        requireCondition(after !== null && sameFileSnapshot(after, stat), "tree_entry_changed_or_unsafe");
        entries.push({ path: relative, type: "symlink", mode: mode(stat), size: Buffer.byteLength(target), target });
      } else if (stat.isDirectory()) {
        entries.push({ path: relative, type: "directory", mode: mode(stat), size: 0 });
        await visit(absolute, relative);
        const after = await fs.lstat(absolute).catch(() => null);
        requireCondition(after !== null && sameFileSnapshot(after, stat), "tree_entry_changed_or_unsafe");
      } else if (stat.isFile()) {
        totalFileBytes += stat.size;
        requireCondition(totalFileBytes <= MAX_TOTAL_FILE_BYTES, "tree_total_file_limit_exceeded");
        entries.push({ path: relative, type: "file", mode: mode(stat), size: stat.size, sha256: await fileDigest(absolute, stat) });
      } else {
        fail("tree_entry_type_unsupported");
      }
    }
  }

  await visit(root, "");
  const rootAfter = await fs.lstat(root).catch(() => null);
  requireCondition(rootAfter !== null && sameFileSnapshot(rootAfter, rootStat), "tree_entry_changed_or_unsafe");
  const treeSha256 = sha256(`${JSON.stringify(entries)}\n`);
  return {
    schemaVersion: 1,
    kind: "workflow_tree_fingerprint",
    status: "pass",
    entryCount: entries.length,
    totalFileBytes,
    treeSha256,
    entries,
  };
}

export async function fingerprintTree(options) {
  const first = await fingerprintTreeOnce(options);
  const second = await fingerprintTreeOnce(options);
  requireCondition(
    first.entryCount === second.entryCount &&
      first.totalFileBytes === second.totalFileBytes &&
      first.treeSha256 === second.treeSha256,
    "tree_changed_during_fingerprint",
  );
  return second;
}

function parseCli(argv) {
  const values = {};
  const allowed = new Set(["root", "summary-only"]);
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    requireCondition(match && allowed.has(match[1]) && !Object.hasOwn(values, match[1]), "tree_fingerprint_usage_error");
    values[match[1]] = match[2];
  }
  requireCondition(typeof values.root === "string" && values.root.length > 0, "tree_fingerprint_usage_error");
  requireCondition(values["summary-only"] === undefined || values["summary-only"] === "true", "tree_fingerprint_usage_error");
  return values;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const values = parseCli(process.argv.slice(2));
    const result = await fingerprintTree({ root: values.root });
    const output =
      values["summary-only"] === "true"
        ? {
            schemaVersion: result.schemaVersion,
            kind: result.kind,
            status: result.status,
            entryCount: result.entryCount,
            totalFileBytes: result.totalFileBytes,
            treeSha256: result.treeSha256,
          }
        : result;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_tree_fingerprint_error",
        code: error instanceof TreeFingerprintError ? error.code : error?.code ?? "tree_fingerprint_unexpected_error",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
