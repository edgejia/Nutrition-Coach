#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 2;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BACKUP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_VALIDITY_MILLISECONDS = 5 * 60 * 1000;
const SCOPES = new Set(["non-production", "production"]);
const PRIVATE_MANIFEST_FILE = "private-manifest.json";
const BACKUP_DATABASE_FILE = "database.sqlite";
const BACKUP_ASSETS_DIRECTORY = "assets";
const BACKUP_UPLOADS_DIRECTORY = "uploads-staging";
const PRIVATE_PRESTATE_FILE = "private-prestate.json";
const RECOVERY_TOOL_FILES = [
  "package.json",
  "scripts/run-node-with-tz.mjs",
  "scripts/workflow/production-recovery.mjs",
];
const EXECUTING_RECOVERY_TOOL_PATH = fileURLToPath(import.meta.url);
const DURABLE_TABLES = [
  "devices",
  "meals",
  "chat_messages",
  "assets",
  "meal_transactions",
  "meal_revisions",
  "chat_meal_receipts",
  "chat_mutation_outcomes",
  "chat_proposal_cards",
  "chat_proposal_action_events",
  "meal_revision_items",
  "asset_references",
  "turn_states",
];

export class RecoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = "RecoveryError";
    this.code = code;
  }
}

function fail(code) {
  throw new RecoveryError(code);
}

function requireCondition(condition, code) {
  if (!condition) {
    fail(code);
  }
}

function requireAbsolutePath(value, code) {
  requireCondition(typeof value === "string" && path.isAbsolute(value), code);
  return path.resolve(value);
}

function pathsOverlap(left, right) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative)) ||
    (!reverse.startsWith("..") && !path.isAbsolute(reverse))
  );
}

async function requireSafePath(candidate, options) {
  const resolved = requireAbsolutePath(candidate, options.absoluteCode);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let missing = false;
  let deepestExisting = parsed.root;
  const missingComponents = [];
  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    const stat = await fs.lstat(current).catch((error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return null;
      throw error;
    });
    if (stat === null) {
      requireCondition(options.allowMissing === true, options.unsafeCode);
      missing = true;
      missingComponents.push(components[index]);
      continue;
    }
    requireCondition(!missing, options.unsafeCode);
    requireCondition(!stat.isSymbolicLink(), options.unsafeCode);
    const isLeaf = index === components.length - 1;
    if (!isLeaf) requireCondition(stat.isDirectory(), options.unsafeCode);
    else if (options.leafType === "file") requireCondition(stat.isFile(), options.unsafeCode);
    else if (options.leafType === "directory") requireCondition(stat.isDirectory(), options.unsafeCode);
    deepestExisting = current;
  }
  const canonicalExisting = await fs.realpath(deepestExisting).catch(() => null);
  requireCondition(canonicalExisting !== null && path.isAbsolute(canonicalExisting), options.unsafeCode);
  return missing ? path.resolve(canonicalExisting, ...missingComponents) : canonicalExisting;
}

function sanitizedGitEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
  );
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_OPTIONAL_LOCKS = "0";
  return environment;
}

function gitOutput(checkoutRoot, args, unavailableCode, encoding = "utf8") {
  try {
    return execFileSync("git", [
      "--no-optional-locks",
      "--no-replace-objects",
      "-c", "core.fsmonitor=false",
      "-c", "core.untrackedCache=false",
      ...args,
    ], {
      cwd: checkoutRoot,
      encoding,
      env: sanitizedGitEnvironment(),
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    fail(unavailableCode);
  }
}

function nulTerminatedRecords(value, code) {
  requireCondition(typeof value === "string" && value.endsWith("\0"), code);
  return value.slice(0, -1).split("\0");
}

function parseCommittedTree(checkoutRoot, sourceSha) {
  return nulTerminatedRecords(
    String(gitOutput(
      checkoutRoot,
      ["ls-tree", "-r", "-z", "--full-tree", sourceSha],
      "checkout_committed_tree_unavailable",
    )),
    "checkout_committed_tree_invalid",
  ).map((record) => {
    const match = /^([0-7]{6}) (blob|commit) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    requireCondition(match !== null, "checkout_committed_tree_invalid");
    return { mode: match[1], type: match[2], objectId: match[3], relativePath: match[4] };
  });
}

function parseCheckoutIndex(checkoutRoot) {
  const tags = nulTerminatedRecords(
    String(gitOutput(checkoutRoot, ["ls-files", "-t", "-z"], "checkout_index_unavailable")),
    "checkout_index_invalid",
  );
  const assumeTags = nulTerminatedRecords(
    String(gitOutput(checkoutRoot, ["ls-files", "-v", "-z"], "checkout_index_unavailable")),
    "checkout_index_invalid",
  );
  requireCondition(
    tags.every((record) => record.startsWith("H ")) &&
      assumeTags.every((record) => record.startsWith("H ")),
    "checkout_index_flags_unsafe",
  );
  return nulTerminatedRecords(
    String(gitOutput(checkoutRoot, ["ls-files", "--stage", "-z"], "checkout_index_unavailable")),
    "checkout_index_invalid",
  ).map((record) => {
    const match = /^([0-7]{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(record);
    requireCondition(match !== null && match[3] === "0", "checkout_index_invalid");
    return { mode: match[1], objectId: match[2], relativePath: match[4] };
  });
}

async function requireCheckoutRoot(value) {
  const checkoutRoot = await requireSafePath(value, {
    absoluteCode: "checkout_root_must_be_absolute",
    unsafeCode: "checkout_root_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const reportedTopLevel = String(
    gitOutput(checkoutRoot, ["rev-parse", "--show-toplevel"], "checkout_root_git_top_level_unavailable"),
  ).trim();
  const canonicalTopLevel = await fs.realpath(reportedTopLevel).catch(() => null);
  requireCondition(canonicalTopLevel === checkoutRoot, "checkout_root_not_git_top_level");
  return checkoutRoot;
}

function requireOutsideCheckout(candidate, checkoutRoot, code) {
  const relative = path.relative(checkoutRoot, candidate);
  requireCondition(relative.startsWith("..") && !path.isAbsolute(relative), code);
}

function requireDisjointPaths(entries, code) {
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      requireCondition(!pathsOverlap(entries[left], entries[right]), code);
    }
  }
}

function requireSha(value, code) {
  requireCondition(typeof value === "string" && SHA_PATTERN.test(value), code);
  return value;
}

function requireBackupId(value) {
  requireCondition(typeof value === "string" && BACKUP_ID_PATTERN.test(value), "invalid_backup_id");
  return value;
}

function requireRequestId(value) {
  requireCondition(typeof value === "string" && REQUEST_ID_PATTERN.test(value), "invalid_request_id");
  return value.toLowerCase();
}

function requireScope(value) {
  requireCondition(SCOPES.has(value), "invalid_scope");
  return value;
}

function requireEvidenceDigest(value, code) {
  requireCondition(typeof value === "string" && SHA256_PATTERN.test(value), code);
  return value;
}

function restoreSelection(restoreAssets, restoreUploads) {
  if (restoreUploads === true) return "database+assets+uploads";
  if (restoreAssets === true) return "database+assets";
  return "database";
}

function requireExpectedBackupEvidence(options, verified) {
  const expectedManifestSha256 = requireEvidenceDigest(
    options.expectedPrivateManifestSha256,
    "expected_private_manifest_sha256_invalid",
  );
  const expectedBundleSha256 = requireEvidenceDigest(
    options.expectedBackupBundleSha256,
    "expected_backup_bundle_sha256_invalid",
  );
  requireCondition(
    verified.manifestSnapshot.sha256 === expectedManifestSha256 &&
      verified.bundleSha256 === expectedBundleSha256,
    "backup_evidence_correlation_mismatch",
  );
  return { expectedManifestSha256, expectedBundleSha256 };
}

function stableJson(value) {
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
  );
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, canonicalJsonValue(value[key])]),
    );
  }
  return value;
}

function canonicalPayload(value) {
  return Buffer.from(JSON.stringify(canonicalJsonValue(value)), "utf8");
}

function valuesMatch(left, right) {
  return stableJson(left) === stableJson(right);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function canonicalSqlValue(value) {
  if (value === null) {
    return { type: "null" };
  }
  if (Buffer.isBuffer(value)) {
    return { type: "blob", value: value.toString("base64") };
  }
  if (typeof value === "number") {
    return { type: "number", value: Object.is(value, -0) ? "-0" : String(value) };
  }
  if (typeof value === "bigint") {
    return { type: "bigint", value: value.toString() };
  }
  return { type: "text", value: String(value) };
}

function digestTable(sqlite, tableName) {
  const columns = sqlite.prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`).all();
  requireCondition(columns.length > 0, "database_schema_incomplete");
  const columnNames = columns.map((column) => String(column.name));
  const primaryKeyColumns = columns
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => String(column.name));
  const orderColumns = primaryKeyColumns.length > 0 ? primaryKeyColumns : columnNames;
  const selectColumns = columnNames.map(quoteIdentifier).join(", ");
  const orderBy = orderColumns.map(quoteIdentifier).join(", ");
  const rows = sqlite
    .prepare(`SELECT ${selectColumns} FROM ${quoteIdentifier(tableName)} ORDER BY ${orderBy}`)
    .iterate();
  const hash = createHash("sha256");
  hash.update(`${tableName}\n${columnNames.join("\u0000")}\n`);
  for (const row of rows) {
    hash.update(`${JSON.stringify(columnNames.map((column) => canonicalSqlValue(row[column])))}\n`);
  }
  return hash.digest("hex");
}

export function asiaTaipeiTimestamp(now = new Date()) {
  requireCondition(now instanceof Date && !Number.isNaN(now.valueOf()), "invalid_observation_time");
  return new Date(now.valueOf() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function receiptValidity(now = new Date()) {
  requireCondition(now instanceof Date && !Number.isNaN(now.valueOf()), "invalid_observation_time");
  return {
    issuedAt: asiaTaipeiTimestamp(now),
    notAfter: asiaTaipeiTimestamp(new Date(now.valueOf() + RECEIPT_VALIDITY_MILLISECONDS)),
  };
}

async function pathExists(candidate) {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function requireFile(candidate, code) {
  const stat = await fs.lstat(candidate).catch(() => null);
  requireCondition(stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, code);
}

async function requirePrivateDatabaseFile(candidate, code) {
  const handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => null);
  requireCondition(handle !== null, code);
  try {
    const before = await handle.stat();
    const current = await fs.lstat(candidate).catch(() => null);
    requireCondition(
      before.isFile() &&
        before.nlink === 1 &&
        current?.isFile() &&
        !current.isSymbolicLink() &&
        current.nlink === 1 &&
        before.dev === current.dev &&
        before.ino === current.ino &&
        (before.mode & 0o777) === 0o600 &&
        (typeof process.getuid !== "function" || before.uid === process.getuid()),
      code,
    );
  } finally {
    await handle.close();
  }
}

async function requireDirectory(candidate, code) {
  const stat = await fs.lstat(candidate).catch(() => null);
  requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), code);
}

function requirePrivateSnapshot(snapshot, expectedMode, code) {
  requireCondition(
    (snapshot.identity.mode & 0o777) === expectedMode &&
      (typeof process.getuid !== "function" || snapshot.identity.uid === process.getuid()),
    code,
  );
}

async function requireOwnedDirectoryMode(candidate, expectedMode, code) {
  const stat = await fs.lstat(candidate).catch(() => null);
  requireCondition(
    stat?.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o777) === expectedMode &&
      (typeof process.getuid !== "function" || stat.uid === process.getuid()),
    code,
  );
  return stat;
}

async function readStableFile(candidate, maximumBytes, missingCode, unsafeCode) {
  const handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") fail(missingCode);
    if (error && typeof error === "object" && error.code === "ELOOP") fail(unsafeCode);
    throw error;
  });
  try {
    const before = await handle.stat();
    requireCondition(before.isFile() && before.nlink === 1 && before.size <= maximumBytes, unsafeCode);
    const raw = await handle.readFile();
    const after = await handle.stat();
    requireCondition(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.nlink === 1 &&
        after.nlink === 1 &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs,
      unsafeCode,
    );
    const current = await fs.lstat(candidate).catch(() => null);
    requireCondition(
      current?.isFile() &&
        !current.isSymbolicLink() &&
        current.nlink === 1 &&
        current.dev === after.dev &&
        current.ino === after.ino &&
        current.size === after.size &&
        current.mtimeMs === after.mtimeMs,
      unsafeCode,
    );
    return {
      raw,
      sha256: digest(raw),
      identity: {
        dev: String(after.dev),
        ino: String(after.ino),
        size: after.size,
        mtimeMs: after.mtimeMs,
        mode: after.mode,
        uid: after.uid,
      },
    };
  } finally {
    await handle.close();
  }
}

function resolveCheckoutSourceSha(checkoutRoot) {
  const sourceSha = String(
    gitOutput(checkoutRoot, ["rev-parse", "--verify", "HEAD^{commit}"], "checkout_source_sha_unavailable"),
  ).trim();
  return requireSha(sourceSha, "checkout_source_sha_invalid");
}

async function requireCleanTrackedCheckout(checkoutRoot, sourceSha, scope) {
  if (scope !== "production") return;
  const committedTree = parseCommittedTree(checkoutRoot, sourceSha);
  const index = parseCheckoutIndex(checkoutRoot);
  requireCondition(
    valuesMatch(
      index,
      committedTree.map(({ mode, objectId, relativePath }) => ({ mode, objectId, relativePath })),
    ),
    "checkout_index_differs_from_source",
  );

  for (const entry of committedTree) {
    requireCondition(entry.type === "blob", "checkout_tracked_entry_unsupported");
    const relative = path.normalize(entry.relativePath);
    requireCondition(
      relative !== "" &&
        !path.isAbsolute(relative) &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== "..",
      "checkout_committed_tree_invalid",
    );
    const diskPath = path.join(checkoutRoot, relative);
    const committed = gitOutput(
      checkoutRoot,
      ["cat-file", "blob", entry.objectId],
      "checkout_committed_blob_unavailable",
      null,
    );
    if (entry.mode === "120000") {
      const stat = await fs.lstat(diskPath).catch(() => null);
      requireCondition(stat?.isSymbolicLink() && stat.nlink === 1, "checkout_tracked_state_dirty");
      const linkTarget = await fs.readlink(diskPath, { encoding: "buffer" });
      requireCondition(linkTarget.equals(committed), "checkout_tracked_state_dirty");
      continue;
    }
    requireCondition(entry.mode === "100644" || entry.mode === "100755", "checkout_tracked_entry_unsupported");
    const disk = await readStableFile(
      diskPath,
      64 * 1024 * 1024,
      "checkout_tracked_state_dirty",
      "checkout_tracked_state_dirty",
    );
    const executable = (disk.identity.mode & 0o111) !== 0;
    requireCondition(
      disk.raw.equals(committed) && executable === (entry.mode === "100755"),
      "checkout_tracked_state_dirty",
    );
  }
}

async function requireExecutingToolProvenance(checkoutRoot, sourceSha, scope) {
  if (scope !== "production") return;
  const executingPath = await fs.realpath(EXECUTING_RECOVERY_TOOL_PATH).catch(() => null);
  requireCondition(
    executingPath === path.join(checkoutRoot, "scripts", "workflow", "production-recovery.mjs"),
    "recovery_tool_outside_checkout",
  );
  for (const relativePath of RECOVERY_TOOL_FILES) {
    const diskPath = path.join(checkoutRoot, ...relativePath.split("/"));
    const disk = await readStableFile(
      diskPath,
      16 * 1024 * 1024,
      "recovery_tool_file_missing",
      "recovery_tool_file_unsafe",
    );
    const committed = gitOutput(
      checkoutRoot,
      ["show", `${sourceSha}:${relativePath}`],
      "recovery_tool_commit_blob_unavailable",
      null,
    );
    requireCondition(disk.sha256 === digest(committed), "recovery_tool_commit_blob_mismatch");
  }
}

async function requireCheckoutAuthority(
  checkoutRoot,
  sourceSha,
  scope,
  mismatchCode = "checkout_source_sha_mismatch",
) {
  requireCondition(resolveCheckoutSourceSha(checkoutRoot) === sourceSha, mismatchCode);
  await requireCleanTrackedCheckout(checkoutRoot, sourceSha, scope);
  await requireExecutingToolProvenance(checkoutRoot, sourceSha, scope);
}

function requireRuntimeOrigin(value) {
  requireCondition(typeof value === "string", "runtime_provenance_origin_invalid");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("runtime_provenance_origin_invalid");
  }
  requireCondition(
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.origin === value.replace(/\/$/, ""),
    "runtime_provenance_origin_invalid",
  );
  return parsed.origin;
}

async function observeRuntimeSourceSha(origin) {
  let response;
  try {
    response = await fetch(new URL("/api/runtime-provenance", origin), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    fail("runtime_provenance_unavailable");
  }
  requireCondition(response.ok, "runtime_provenance_unavailable");
  let body;
  try {
    const declaredLength = response.headers.get("content-length");
    requireCondition(declaredLength === null || Number(declaredLength) <= 1024, "runtime_provenance_invalid");
    const raw = await response.text();
    requireCondition(Buffer.byteLength(raw, "utf8") <= 1024, "runtime_provenance_invalid");
    body = JSON.parse(raw);
  } catch {
    fail("runtime_provenance_invalid");
  }
  requireCondition(exactKeys(body, ["sourceSha"]), "runtime_provenance_invalid");
  return requireSha(body.sourceSha, "runtime_provenance_invalid");
}

async function loadAttestationVerifier(options, checkoutRoot, disallowedRoots = []) {
  const publicKeyPath = await requireSafePath(options.attestationPublicKeyPath, {
    absoluteCode: "attestation_public_key_path_must_be_absolute",
    unsafeCode: "attestation_public_key_path_unsafe",
    leafType: "file",
    allowMissing: false,
  });
  requireOutsideCheckout(publicKeyPath, checkoutRoot, "attestation_key_inside_checkout");
  for (const root of disallowedRoots) {
    requireCondition(!pathsOverlap(publicKeyPath, root), "attestation_key_overlaps_recovery_storage");
  }
  requireCondition(
    typeof options.expectedAttestationPublicKeySha256 === "string" &&
      SHA256_PATTERN.test(options.expectedAttestationPublicKeySha256),
    "attestation_public_key_digest_invalid",
  );
  const snapshot = await readStableFile(publicKeyPath, 64 * 1024, "attestation_public_key_missing", "attestation_public_key_unsafe");
  requireCondition((snapshot.identity.mode & 0o022) === 0, "attestation_public_key_permissions_unsafe");
  if (typeof process.getuid === "function") {
    requireCondition(snapshot.identity.uid === process.getuid(), "attestation_public_key_owner_mismatch");
  }
  let publicKey;
  let spki;
  try {
    publicKey = createPublicKey(snapshot.raw);
    requireCondition(publicKey.asymmetricKeyType === "ed25519", "attestation_public_key_invalid");
    spki = publicKey.export({ type: "spki", format: "der" });
  } catch {
    fail("attestation_public_key_invalid");
  }
  const publicKeySha256 = digest(spki);
  requireCondition(publicKeySha256 === options.expectedAttestationPublicKeySha256, "attestation_public_key_digest_mismatch");
  return {
    publicKeyPath,
    publicKey,
    publicKeySha256,
    verify(payload, signature) {
      requireCondition(typeof signature === "string" && BASE64URL_PATTERN.test(signature), "recovery_signature_invalid");
      requireCondition(
        verifyBytes(null, canonicalPayload(payload), publicKey, Buffer.from(signature, "base64url")),
        "recovery_signature_invalid",
      );
    },
    async assertCurrent() {
      const current = await readStableFile(publicKeyPath, 64 * 1024, "attestation_public_key_missing", "attestation_public_key_unsafe");
      requireCondition(current.sha256 === snapshot.sha256 && valuesMatch(current.identity, snapshot.identity), "attestation_public_key_changed");
    },
  };
}

async function loadAttestationSigner(options, checkoutRoot, disallowedRoots = []) {
  const verifier = await loadAttestationVerifier(options, checkoutRoot, disallowedRoots);
  const privateKeyPath = await requireSafePath(options.attestationPrivateKeyPath, {
    absoluteCode: "attestation_private_key_path_must_be_absolute",
    unsafeCode: "attestation_private_key_path_unsafe",
    leafType: "file",
    allowMissing: false,
  });
  requireCondition(privateKeyPath !== verifier.publicKeyPath, "attestation_key_paths_must_be_distinct");
  requireOutsideCheckout(privateKeyPath, checkoutRoot, "attestation_key_inside_checkout");
  for (const root of disallowedRoots) {
    requireCondition(!pathsOverlap(privateKeyPath, root), "attestation_key_overlaps_recovery_storage");
  }
  const snapshot = await readStableFile(privateKeyPath, 64 * 1024, "attestation_private_key_missing", "attestation_private_key_unsafe");
  requireCondition((snapshot.identity.mode & 0o077) === 0, "attestation_private_key_permissions_unsafe");
  if (typeof process.getuid === "function") {
    requireCondition(snapshot.identity.uid === process.getuid(), "attestation_private_key_owner_mismatch");
  }
  let privateKey;
  let derivedPublic;
  try {
    privateKey = createPrivateKey(snapshot.raw);
    requireCondition(privateKey.asymmetricKeyType === "ed25519", "attestation_private_key_invalid");
    derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  } catch {
    fail("attestation_private_key_invalid");
  }
  requireCondition(digest(derivedPublic) === verifier.publicKeySha256, "attestation_key_pair_mismatch");
  return {
    ...verifier,
    privateKeyPath,
    sign(payload) {
      return signBytes(null, canonicalPayload(payload), privateKey).toString("base64url");
    },
    async assertCurrent() {
      await verifier.assertCurrent();
      const current = await readStableFile(privateKeyPath, 64 * 1024, "attestation_private_key_missing", "attestation_private_key_unsafe");
      requireCondition(current.sha256 === snapshot.sha256 && valuesMatch(current.identity, snapshot.identity), "attestation_private_key_changed");
    },
  };
}

async function syncFile(candidate) {
  const handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireCondition(stat.isFile() && stat.nlink === 1, "storage_sync_target_unsafe");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(candidate) {
  const handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireCondition(stat.isDirectory(), "storage_sync_target_unsafe");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncTree(candidate) {
  const stat = await fs.lstat(candidate);
  requireCondition(!stat.isSymbolicLink(), "storage_sync_target_unsafe");
  if (stat.isFile()) {
    await syncFile(candidate);
    return;
  }
  requireCondition(stat.isDirectory(), "storage_sync_target_unsafe");
  const children = (await fs.readdir(candidate)).sort((left, right) => left.localeCompare(right, "en"));
  for (const child of children) await syncTree(path.join(candidate, child));
  await syncDirectory(candidate);
}

async function hashFile(filePath) {
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch((error) => {
    if (error && typeof error === "object" && error.code === "ELOOP") fail("storage_tree_symlink_rejected");
    throw error;
  });
  try {
    const before = await handle.stat();
    requireCondition(before.isFile(), "storage_tree_special_file_rejected");
    requireCondition(before.nlink === 1, "storage_tree_hardlink_rejected");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    const current = await fs.lstat(filePath).catch(() => null);
    requireCondition(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.nlink === 1 &&
        after.nlink === 1 &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        current?.isFile() &&
        !current.isSymbolicLink() &&
        current.nlink === 1 &&
        current.dev === after.dev &&
        current.ino === after.ino &&
        current.size === after.size &&
        current.mtimeMs === after.mtimeMs,
      "storage_tree_changed_during_read",
    );
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function collectTreeManifest(root) {
  await requireDirectory(root, "storage_tree_missing");
  const entries = [];

  async function visit(current, relativeBase) {
    const children = await fs.readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const child of children) {
      const absolute = path.join(current, child.name);
      const relative = relativeBase ? path.posix.join(relativeBase, child.name) : child.name;
      const stat = await fs.lstat(absolute);

      if (stat.isSymbolicLink()) {
        fail("storage_tree_symlink_rejected");
      }
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: "directory", mode: stat.mode & 0o777 });
        await visit(absolute, relative);
        continue;
      }
      if (stat.isFile()) {
        requireCondition(stat.nlink === 1, "storage_tree_hardlink_rejected");
        entries.push({
          path: relative,
          type: "file",
          mode: stat.mode & 0o777,
          size: stat.size,
          sha256: await hashFile(absolute),
        });
        continue;
      }
      fail("storage_tree_special_file_rejected");
    }
  }

  await visit(root, "");
  return entries;
}

async function normalizePrivateTreePermissions(root) {
  const stat = await fs.lstat(root).catch(() => null);
  requireCondition(stat && !stat.isSymbolicLink(), "storage_tree_permissions_unsafe");
  if (stat.isFile()) {
    requireCondition(stat.nlink === 1, "storage_tree_hardlink_rejected");
    await fs.chmod(root, 0o600);
    return;
  }
  requireCondition(stat.isDirectory(), "storage_tree_permissions_unsafe");
  await fs.chmod(root, 0o700);
  const children = (await fs.readdir(root)).sort((left, right) => left.localeCompare(right, "en"));
  for (const child of children) await normalizePrivateTreePermissions(path.join(root, child));
}

function normalizedPrivateTreeEntries(entries) {
  return entries.map((entry) => ({
    ...entry,
    mode: entry.type === "directory" ? 0o700 : 0o600,
  }));
}

async function requireExactDirectoryEntries(root, expected, code) {
  const entries = (await fs.readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"));
  requireCondition(
    JSON.stringify(entries.map((entry) => entry.name)) === JSON.stringify([...expected].sort((left, right) => left.localeCompare(right, "en"))) &&
      entries.every((entry) => !entry.isSymbolicLink()),
    code,
  );
}

function readDatabaseState(dbPath) {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    sqlite.defaultSafeIntegers(true);
    const integrityRows = sqlite.pragma("integrity_check");
    const integrityOk =
      integrityRows.length === 1 &&
      typeof integrityRows[0] === "object" &&
      integrityRows[0] !== null &&
      Object.values(integrityRows[0]).length === 1 &&
      Object.values(integrityRows[0])[0] === "ok";
    requireCondition(integrityOk, "database_integrity_failed");

    const foreignKeyRows = sqlite.pragma("foreign_key_check");
    requireCondition(foreignKeyRows.length === 0, "database_foreign_key_failed");

    const schemaObjects = sqlite
      .prepare(
        "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema " +
          "WHERE type IN ('table', 'index', 'view', 'trigger') ORDER BY type, name, tbl_name, COALESCE(sql, '')",
      )
      .all()
      .map((row) => ({
        type: String(row.type),
        name: String(row.name),
        tableName: String(row.tableName),
        sql: row.sql === null ? null : String(row.sql),
      }));
    const tableNameList = schemaObjects
      .filter((entry) => entry.type === "table")
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));
    const tableNames = new Set(tableNameList);
    for (const tableName of [...DURABLE_TABLES, "__drizzle_migrations"]) {
      requireCondition(tableNames.has(tableName), "database_schema_incomplete");
    }

    const durableTableCounts = Object.fromEntries(
      DURABLE_TABLES.map((tableName) => {
        const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get();
        return [tableName, String(row.count)];
      }),
    );
    const durableTableDigests = Object.fromEntries(
      DURABLE_TABLES.map((tableName) => [tableName, digestTable(sqlite, tableName)]),
    );
    const migrationJournal = sqlite
      .prepare('SELECT "created_at" AS createdAt, "hash" AS hash FROM "__drizzle_migrations" ORDER BY "created_at", "hash"')
      .all()
      .map((row) => ({ createdAt: String(row.createdAt), hash: String(row.hash) }));
    const allTableCounts = Object.fromEntries(
      tableNameList.map((tableName) => {
        const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get();
        return [tableName, String(row.count)];
      }),
    );
    const allTableDigests = Object.fromEntries(
      tableNameList.map((tableName) => [tableName, digestTable(sqlite, tableName)]),
    );
    const databaseMetadata = {
      userVersion: String(sqlite.pragma("user_version", { simple: true })),
      applicationId: String(sqlite.pragma("application_id", { simple: true })),
      encoding: String(sqlite.pragma("encoding", { simple: true })),
    };
    const fullLogicalStateSha256 = digest(
      canonicalPayload({ databaseMetadata, schemaObjects, allTableCounts, allTableDigests }),
    );

    return {
      integrityOk: true,
      foreignKeysOk: true,
      durableTableCounts,
      durableTableDigests,
      migrationJournal,
      databaseMetadata,
      schemaObjects,
      allTableCounts,
      allTableDigests,
      fullLogicalStateSha256,
    };
  } finally {
    sqlite.close();
  }
}

function normalizeRecoverySnapshot(dbPath) {
  const sqlite = new Database(dbPath, { fileMustExist: true });
  try {
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    const journalMode = sqlite.pragma("journal_mode = DELETE", { simple: true });
    requireCondition(String(journalMode).toLowerCase() === "delete", "database_snapshot_normalization_failed");
  } finally {
    sqlite.close();
  }
}

async function copyTree(source, destination) {
  await fs.cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    dereference: false,
    preserveTimestamps: true,
  });
}

async function captureOwnedBackupStaging(stagingDir) {
  const stat = await requireOwnedDirectoryMode(stagingDir, 0o700, "backup_staging_directory_unsafe");
  return {
    path: stagingDir,
    identity: {
      dev: String(stat.dev),
      ino: String(stat.ino),
      mode: stat.mode & 0o777,
    },
  };
}

async function removeOwnedBackupStaging(staging) {
  const stat = await fs.lstat(staging.path).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  });
  if (stat === null) return;
  requireCondition(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      String(stat.dev) === staging.identity.dev &&
      String(stat.ino) === staging.identity.ino &&
      (stat.mode & 0o777) === staging.identity.mode,
    "backup_staging_identity_changed",
  );
  await fs.rm(staging.path, { recursive: true, force: false });
  await syncDirectory(path.dirname(staging.path));
}

function backupDirectoryIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: stat.mode & 0o777,
  };
}

async function assertBackupDirectoryIdentity(candidate, expected, code) {
  const stat = await fs.lstat(candidate).catch(() => null);
  requireCondition(
    stat?.isDirectory() &&
      !stat.isSymbolicLink() &&
      valuesMatch(backupDirectoryIdentity(stat), expected),
    code,
  );
}

async function installBackupEntryExclusive(source, destination) {
  const sourceStat = await fs.lstat(source).catch(() => null);
  requireCondition(sourceStat && !sourceStat.isSymbolicLink(), "backup_publish_source_unsafe");
  if (sourceStat.isFile()) {
    requireCondition(sourceStat.nlink === 1, "backup_publish_source_unsafe");
    try {
      await fs.link(source, destination);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") fail("backup_publish_collision");
      throw error;
    }
    const sourceCurrent = await fs.lstat(source).catch(() => null);
    const destinationStat = await fs.lstat(destination).catch(() => null);
    requireCondition(
      sourceCurrent?.isFile() &&
        !sourceCurrent.isSymbolicLink() &&
        destinationStat?.isFile() &&
        !destinationStat.isSymbolicLink() &&
        sourceCurrent.dev === sourceStat.dev &&
        sourceCurrent.ino === sourceStat.ino &&
        destinationStat.dev === sourceStat.dev &&
        destinationStat.ino === sourceStat.ino &&
        sourceCurrent.nlink === 2 &&
        destinationStat.nlink === 2,
      "backup_publish_identity_changed",
    );
    await fs.unlink(source);
    return;
  }
  requireCondition(sourceStat.isDirectory(), "backup_publish_source_unsafe");
  const sourceIdentity = backupDirectoryIdentity(sourceStat);
  try {
    await fs.mkdir(destination, { mode: sourceIdentity.mode });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") fail("backup_publish_collision");
    throw error;
  }
  const destinationStat = await fs.lstat(destination);
  const destinationIdentity = backupDirectoryIdentity(destinationStat);
  requireCondition(
    destinationStat.isDirectory() &&
      !destinationStat.isSymbolicLink() &&
      destinationIdentity.mode === sourceIdentity.mode,
    "backup_publish_identity_changed",
  );
  const children = (await fs.readdir(source)).sort((left, right) => left.localeCompare(right, "en"));
  for (const child of children) {
    await installBackupEntryExclusive(path.join(source, child), path.join(destination, child));
  }
  await assertBackupDirectoryIdentity(source, sourceIdentity, "backup_publish_identity_changed");
  await assertBackupDirectoryIdentity(destination, destinationIdentity, "backup_publish_identity_changed");
  await fs.rmdir(source);
}

async function publishBackupStagingExclusive(staging, backupDir, onClaim) {
  await assertBackupDirectoryIdentity(staging.path, staging.identity, "backup_staging_identity_changed");
  try {
    await fs.mkdir(backupDir, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") fail("backup_destination_exists");
    throw error;
  }
  onClaim();
  const backupStat = await fs.lstat(backupDir);
  const backupIdentity = backupDirectoryIdentity(backupStat);
  requireCondition(
    backupStat.isDirectory() && !backupStat.isSymbolicLink() && backupIdentity.mode === 0o700,
    "backup_publish_identity_changed",
  );
  await syncDirectory(path.dirname(backupDir));
  const children = (await fs.readdir(staging.path)).sort((left, right) => left.localeCompare(right, "en"));
  for (const child of children) {
    await installBackupEntryExclusive(path.join(staging.path, child), path.join(backupDir, child));
  }
  await assertBackupDirectoryIdentity(staging.path, staging.identity, "backup_staging_identity_changed");
  await assertBackupDirectoryIdentity(backupDir, backupIdentity, "backup_publish_identity_changed");
  await fs.rmdir(staging.path);
  await syncTree(backupDir);
  await syncDirectory(path.dirname(backupDir));
}

async function writePrivateManifest(filePath, manifest) {
  const handle = await fs.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function signedRecoveryRecord(payload, signer) {
  return {
    ...payload,
    attestationPublicKeySha256: signer.publicKeySha256,
    signature: signer.sign(payload),
  };
}

function signedRecoveryReceipt(payload, signer) {
  requireCondition(
    payload.attestationPublicKeySha256 === signer.publicKeySha256,
    "recovery_receipt_key_mismatch",
  );
  return { ...payload, receiptSignature: signer.sign(payload) };
}

function verifySignedRecoveryRecord(value, verifier, expectedKind) {
  requireCondition(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.schemaVersion === SCHEMA_VERSION &&
      value.kind === expectedKind &&
      value.attestationPublicKeySha256 === verifier.publicKeySha256,
    "recovery_signed_record_invalid",
  );
  const { attestationPublicKeySha256: _key, signature, ...payload } = value;
  verifier.verify(payload, signature);
  return payload;
}

function backupReceipt({ backupId, intendedSourceSha, preRefreshRuntimeSha, observedAt, scope, manifestEvidence, bundleSha256, signer }) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "production_storage_backup",
    scope,
    backupId,
    observedAt,
    intendedSourceSha,
    preRefreshRuntimeSha,
    quiesced: true,
    sourceStable: true,
    databaseIntegrityOk: true,
    foreignKeysOk: true,
    durableCountsMatch: true,
    migrationJournalMatch: true,
    assetsMatch: true,
    uploadsCaptured: true,
    restoreReady: true,
    publishedDurably: true,
    checkoutSourceVerified: true,
    runtimeProvenanceVerified: true,
    attestationPublicKeySha256: signer.publicKeySha256,
    privateManifestSha256: manifestEvidence.sha256,
    privateManifestSignature: manifestEvidence.signature,
    backupBundleSha256: bundleSha256,
  };
  return signedRecoveryReceipt(payload, signer);
}

export async function createRecoveryBackup(options) {
  const checkoutRoot = await requireCheckoutRoot(options.checkoutRoot);
  const dbPath = await requireSafePath(options.dbPath, {
    absoluteCode: "db_path_must_be_absolute",
    unsafeCode: "database_path_unsafe",
    leafType: "file",
    allowMissing: false,
  });
  const assetsDir = await requireSafePath(options.assetsDir, {
    absoluteCode: "assets_path_must_be_absolute",
    unsafeCode: "assets_path_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const uploadsDir = await requireSafePath(options.uploadsDir, {
    absoluteCode: "uploads_path_must_be_absolute",
    unsafeCode: "uploads_path_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const backupRoot = await requireSafePath(options.backupRoot, {
    absoluteCode: "backup_root_must_be_absolute",
    unsafeCode: "backup_root_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const backupId = requireBackupId(options.backupId);
  const intendedSourceSha = requireSha(options.intendedSourceSha, "invalid_intended_source_sha");
  const preRefreshRuntimeSha = requireSha(options.preRefreshRuntimeSha, "invalid_runtime_source_sha");
  const scope = requireScope(options.scope);
  requireCondition(options.quiesced === true, "runtime_quiescence_required");
  requireOutsideCheckout(backupRoot, checkoutRoot, "backup_root_inside_checkout");
  requireDisjointPaths([dbPath, assetsDir, uploadsDir], "storage_source_paths_overlap");
  requireDisjointPaths([dbPath, assetsDir, uploadsDir, backupRoot], "backup_root_overlaps_storage");
  const runtimeProvenanceOrigin = requireRuntimeOrigin(options.runtimeProvenanceOrigin);

  await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope);
  const runtimeShaBefore = await observeRuntimeSourceSha(runtimeProvenanceOrigin);
  requireCondition(runtimeShaBefore === preRefreshRuntimeSha, "runtime_provenance_sha_mismatch");
  const signer = await loadAttestationSigner(options, checkoutRoot, [dbPath, assetsDir, uploadsDir, backupRoot]);

  await requireFile(dbPath, "database_missing");
  await requireDirectory(assetsDir, "assets_directory_missing");
  await requireDirectory(uploadsDir, "uploads_directory_missing");
  await requireOwnedDirectoryMode(backupRoot, 0o700, "backup_root_invalid");

  const backupDir = path.join(backupRoot, backupId);
  requireCondition(!(await pathExists(backupDir)), "backup_destination_exists");
  const stagingDir = path.join(backupRoot, `.${backupId}.tmp-${randomUUID()}`);
  await fs.mkdir(stagingDir, { mode: 0o700 });
  const ownedStaging = await captureOwnedBackupStaging(stagingDir);
  let backupPublished = false;

  try {
    const sourceBefore = {
      database: readDatabaseState(dbPath),
      assets: await collectTreeManifest(assetsDir),
      uploads: await collectTreeManifest(uploadsDir),
    };

    const snapshotPath = path.join(stagingDir, BACKUP_DATABASE_FILE);
    const source = new Database(dbPath, { fileMustExist: true });
    try {
      await source.backup(snapshotPath);
    } finally {
      source.close();
    }
    normalizeRecoverySnapshot(snapshotPath);
    await fs.chmod(snapshotPath, 0o600);
    await requirePrivateDatabaseFile(snapshotPath, "backup_database_permissions_unsafe");

    const backupAssetsDir = path.join(stagingDir, BACKUP_ASSETS_DIRECTORY);
    const backupUploadsDir = path.join(stagingDir, BACKUP_UPLOADS_DIRECTORY);
    await copyTree(assetsDir, backupAssetsDir);
    await copyTree(uploadsDir, backupUploadsDir);
    await normalizePrivateTreePermissions(backupAssetsDir);
    await normalizePrivateTreePermissions(backupUploadsDir);

    const sourceAfter = {
      database: readDatabaseState(dbPath),
      assets: await collectTreeManifest(assetsDir),
      uploads: await collectTreeManifest(uploadsDir),
    };
    requireCondition(valuesMatch(sourceBefore, sourceAfter), "source_changed_during_backup");

    const snapshotState = readDatabaseState(snapshotPath);
    const backupAssets = await collectTreeManifest(backupAssetsDir);
    const backupUploads = await collectTreeManifest(backupUploadsDir);
    requireCondition(valuesMatch(sourceBefore.database, snapshotState), "database_snapshot_mismatch");
    requireCondition(
      valuesMatch(normalizedPrivateTreeEntries(sourceBefore.assets), backupAssets),
      "assets_snapshot_mismatch",
    );
    requireCondition(
      valuesMatch(normalizedPrivateTreeEntries(sourceBefore.uploads), backupUploads),
      "uploads_snapshot_mismatch",
    );

    const observedAt = asiaTaipeiTimestamp(options.now);
    const manifestPayload = {
      schemaVersion: SCHEMA_VERSION,
      kind: "production_storage_backup_private_manifest",
      scope,
      backupId,
      observedAt,
      intendedSourceSha,
      preRefreshRuntimeSha,
      database: {
        file: BACKUP_DATABASE_FILE,
        mode: 0o600,
        sha256: await hashFile(snapshotPath),
        state: snapshotState,
      },
      assets: { directory: BACKUP_ASSETS_DIRECTORY, mode: 0o700, entries: backupAssets },
      uploads: { directory: BACKUP_UPLOADS_DIRECTORY, mode: 0o700, entries: backupUploads },
    };
    const manifest = signedRecoveryRecord(manifestPayload, signer);
    const stagedManifestPath = path.join(stagingDir, PRIVATE_MANIFEST_FILE);
    await writePrivateManifest(stagedManifestPath, manifest);
    const stagedManifestSnapshot = await readStableFile(
      stagedManifestPath,
      16 * 1024 * 1024,
      "backup_manifest_missing",
      "backup_manifest_file_unsafe",
    );
    await syncTree(stagingDir);
    await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope, "checkout_source_sha_changed");
    requireCondition((await observeRuntimeSourceSha(runtimeProvenanceOrigin)) === runtimeShaBefore, "runtime_provenance_changed");
    await signer.assertCurrent();
    if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_backup_publish");
    requireCondition(!(await pathExists(backupDir)), "backup_destination_exists");
    const stagingCurrent = await fs.lstat(stagingDir).catch(() => null);
    requireCondition(
      stagingCurrent?.isDirectory() &&
        !stagingCurrent.isSymbolicLink() &&
        String(stagingCurrent.dev) === ownedStaging.identity.dev &&
        String(stagingCurrent.ino) === ownedStaging.identity.ino &&
        (stagingCurrent.mode & 0o777) === ownedStaging.identity.mode,
      "backup_staging_identity_changed",
    );
    await publishBackupStagingExclusive(ownedStaging, backupDir, () => {
      backupPublished = true;
    });
    if (typeof options.testCheckpoint === "function") await options.testCheckpoint("after_backup_publish");
    const verified = await verifyBackupPrivate({
      backupDir,
      checkoutRoot,
      backupId,
      intendedSourceSha,
      preRefreshRuntimeSha,
      scope,
      attestationPublicKeyPath: options.attestationPublicKeyPath,
      expectedAttestationPublicKeySha256: options.expectedAttestationPublicKeySha256,
    });
    requireCondition(verified.manifestSnapshot.sha256 === stagedManifestSnapshot.sha256, "backup_manifest_publish_mismatch");
    await signer.assertCurrent();
    await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope, "checkout_source_sha_changed");

    return {
      backupDir,
      receipt: backupReceipt({
        backupId,
        intendedSourceSha,
        preRefreshRuntimeSha,
        observedAt,
        scope,
        manifestEvidence: {
          sha256: verified.manifestSnapshot.sha256,
          signature: manifest.signature,
        },
        bundleSha256: verified.bundleSha256,
        signer,
      }),
    };
  } catch (error) {
    try {
      await removeOwnedBackupStaging(ownedStaging);
    } catch {
      fail("backup_reconciliation_required");
    }
    if (backupPublished) fail("backup_reconciliation_required");
    throw error;
  }
}

async function loadPrivateManifest(backupDir, verifier) {
  const manifestPath = path.join(backupDir, PRIVATE_MANIFEST_FILE);
  const snapshot = await readStableFile(
    manifestPath,
    16 * 1024 * 1024,
    "backup_manifest_missing",
    "backup_manifest_file_unsafe",
  );
  requirePrivateSnapshot(snapshot, 0o600, "backup_manifest_permissions_unsafe");
  let manifest;
  try {
    manifest = JSON.parse(snapshot.raw.toString("utf8"));
  } catch {
    fail("backup_manifest_invalid");
  }
  requireCondition(
    exactKeys(manifest, [
      "schemaVersion",
      "kind",
      "scope",
      "backupId",
      "observedAt",
      "intendedSourceSha",
      "preRefreshRuntimeSha",
      "database",
      "assets",
      "uploads",
      "attestationPublicKeySha256",
      "signature",
    ]),
    "backup_manifest_invalid",
  );
  verifySignedRecoveryRecord(manifest, verifier, "production_storage_backup_private_manifest");
  requireCondition(
    exactKeys(manifest.database, ["file", "mode", "sha256", "state"]) &&
      exactKeys(manifest.assets, ["directory", "mode", "entries"]) &&
      exactKeys(manifest.uploads, ["directory", "mode", "entries"]) &&
      manifest.database?.file === BACKUP_DATABASE_FILE &&
      manifest.database?.mode === 0o600 &&
      manifest.assets?.directory === BACKUP_ASSETS_DIRECTORY &&
      manifest.assets?.mode === 0o700 &&
      manifest.uploads?.directory === BACKUP_UPLOADS_DIRECTORY &&
      manifest.uploads?.mode === 0o700,
    "backup_manifest_layout_invalid",
  );
  return { manifest, snapshot };
}

async function verifyBackupPrivate(options) {
  const checkoutRoot = await requireCheckoutRoot(options.checkoutRoot);
  const backupDir = await requireSafePath(options.backupDir, {
    absoluteCode: "backup_path_must_be_absolute",
    unsafeCode: "backup_directory_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  requireOutsideCheckout(backupDir, checkoutRoot, "backup_path_inside_checkout");
  const backupRoot = path.dirname(backupDir);
  const backupId = requireBackupId(options.backupId);
  const intendedSourceSha = requireSha(options.intendedSourceSha, "invalid_intended_source_sha");
  const preRefreshRuntimeSha = requireSha(options.preRefreshRuntimeSha, "invalid_runtime_source_sha");
  const scope = requireScope(options.scope);
  await requireDirectory(backupDir, "backup_directory_missing");
  await requireOwnedDirectoryMode(backupDir, 0o700, "backup_directory_permissions_unsafe");
  await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope);
  const verifier = await loadAttestationVerifier(options, checkoutRoot, [backupRoot]);

  const loadedManifest = await loadPrivateManifest(backupDir, verifier);
  const manifest = loadedManifest.manifest;
  requireCondition(path.basename(backupDir) === backupId, "backup_id_path_mismatch");
  requireCondition(manifest.backupId === backupId, "backup_id_manifest_mismatch");
  requireCondition(manifest.scope === scope, "backup_scope_mismatch");
  requireCondition(manifest.intendedSourceSha === intendedSourceSha, "backup_source_sha_mismatch");
  requireCondition(manifest.preRefreshRuntimeSha === preRefreshRuntimeSha, "backup_runtime_sha_mismatch");
  await requireExactDirectoryEntries(
    backupDir,
    [PRIVATE_MANIFEST_FILE, BACKUP_DATABASE_FILE, BACKUP_ASSETS_DIRECTORY, BACKUP_UPLOADS_DIRECTORY],
    "backup_bundle_layout_invalid",
  );
  const bundleBefore = await collectTreeManifest(backupDir);

  const snapshotPath = path.join(backupDir, BACKUP_DATABASE_FILE);
  const assetsDir = path.join(backupDir, BACKUP_ASSETS_DIRECTORY);
  const uploadsDir = path.join(backupDir, BACKUP_UPLOADS_DIRECTORY);
  await requireFile(snapshotPath, "backup_database_missing");
  await requirePrivateDatabaseFile(snapshotPath, "backup_database_permissions_unsafe");
  await requireOwnedDirectoryMode(assetsDir, manifest.assets.mode, "backup_assets_permissions_unsafe");
  await requireOwnedDirectoryMode(uploadsDir, manifest.uploads.mode, "backup_uploads_permissions_unsafe");

  requireCondition((await hashFile(snapshotPath)) === manifest.database.sha256, "backup_database_digest_mismatch");
  const databaseState = readDatabaseState(snapshotPath);
  const assets = await collectTreeManifest(assetsDir);
  const uploads = await collectTreeManifest(uploadsDir);
  requireCondition(valuesMatch(databaseState, manifest.database.state), "backup_database_state_mismatch");
  requireCondition(valuesMatch(assets, manifest.assets.entries), "backup_assets_digest_mismatch");
  requireCondition(valuesMatch(uploads, manifest.uploads.entries), "backup_uploads_digest_mismatch");

  const finalManifest = await loadPrivateManifest(backupDir, verifier);
  const bundleAfter = await collectTreeManifest(backupDir);
  requireCondition(
    finalManifest.snapshot.sha256 === loadedManifest.snapshot.sha256 &&
      valuesMatch(finalManifest.snapshot.identity, loadedManifest.snapshot.identity),
    "backup_manifest_changed",
  );
  requireCondition(valuesMatch(bundleAfter, bundleBefore), "backup_bundle_changed");
  await verifier.assertCurrent();
  await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope, "checkout_source_sha_changed");

  return {
    backupDir,
    backupRoot,
    snapshotPath,
    assetsDir,
    uploadsDir,
    manifest,
    manifestSnapshot: loadedManifest.snapshot,
    bundleSha256: digest(Buffer.from(JSON.stringify(bundleBefore), "utf8")),
    verifier,
  };
}

export async function verifyRecoveryBackup(options) {
  const requestId = requireRequestId(options.requestId);
  const validity = receiptValidity(options.now);
  const verified = await verifyBackupPrivate(options);
  const signer = await loadAttestationSigner(options, await requireCheckoutRoot(options.checkoutRoot), [verified.backupRoot]);
  await signer.assertCurrent();
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "production_storage_backup_verification",
    scope: verified.manifest.scope,
    backupId: verified.manifest.backupId,
    observedAt: validity.issuedAt,
    requestId,
    ...validity,
    intendedSourceSha: verified.manifest.intendedSourceSha,
    preRefreshRuntimeSha: verified.manifest.preRefreshRuntimeSha,
    databaseIntegrityOk: true,
    foreignKeysOk: true,
    privateManifestMatch: true,
    assetsMatch: true,
    uploadsMatch: true,
    restoreReady: true,
    bundleReadbackVerified: true,
    checkoutSourceVerified: true,
    attestationPublicKeySha256: verified.verifier.publicKeySha256,
    privateManifestSha256: verified.manifestSnapshot.sha256,
    privateManifestSignature: verified.manifest.signature,
    backupBundleSha256: verified.bundleSha256,
  };
  return signedRecoveryReceipt(payload, signer);
}

export async function assessRecoveryState(options) {
  const requestId = requireRequestId(options.requestId);
  const validity = receiptValidity(options.now);
  requireCondition(options.runtimeStopped === true, "runtime_stop_required");
  const dbPath = await requireSafePath(options.dbPath, {
    absoluteCode: "db_path_must_be_absolute",
    unsafeCode: "database_path_unsafe",
    leafType: "file",
    allowMissing: false,
  });
  const assetsDir = await requireSafePath(options.assetsDir, {
    absoluteCode: "assets_path_must_be_absolute",
    unsafeCode: "assets_path_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const uploadsDir = await requireSafePath(options.uploadsDir, {
    absoluteCode: "uploads_path_must_be_absolute",
    unsafeCode: "uploads_path_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  requireDisjointPaths([dbPath, assetsDir, uploadsDir], "storage_source_paths_overlap");
  await requireFile(dbPath, "live_database_missing");
  await requireDirectory(assetsDir, "live_assets_missing");
  await requireDirectory(uploadsDir, "live_uploads_missing");
  const verified = await verifyBackupPrivate(options);
  const expectedEvidence = requireExpectedBackupEvidence(options, verified);
  const liveBefore = {
    database: readDatabaseState(dbPath),
    assets: await collectTreeManifest(assetsDir),
    uploads: await collectTreeManifest(uploadsDir),
  };
  if (typeof options.testCheckpoint === "function") await options.testCheckpoint("after_assessment_snapshot");
  const verifiedFinal = await verifyBackupPrivate(options);
  requireCondition(
    verifiedFinal.manifestSnapshot.sha256 === verified.manifestSnapshot.sha256 &&
      valuesMatch(verifiedFinal.manifestSnapshot.identity, verified.manifestSnapshot.identity) &&
      verifiedFinal.bundleSha256 === verified.bundleSha256,
    "assessment_backup_changed",
  );
  const liveAfter = {
    database: readDatabaseState(dbPath),
    assets: await collectTreeManifest(assetsDir),
    uploads: await collectTreeManifest(uploadsDir),
  };
  requireCondition(valuesMatch(liveAfter, liveBefore), "assessment_live_state_changed");
  const liveDatabase = liveAfter.database;
  const liveAssets = liveAfter.assets;
  const liveUploads = liveAfter.uploads;
  const durableCountsMatch = valuesMatch(
    liveDatabase.durableTableCounts,
    verified.manifest.database.state.durableTableCounts,
  );
  const durableContentMatch = valuesMatch(
    liveDatabase.durableTableDigests,
    verified.manifest.database.state.durableTableDigests,
  );
  const migrationJournalMatch = valuesMatch(
    liveDatabase.migrationJournal,
    verified.manifest.database.state.migrationJournal,
  );
  const databaseMetadataMatch = valuesMatch(
    liveDatabase.databaseMetadata,
    verified.manifest.database.state.databaseMetadata,
  );
  const databaseSchemaMatch = valuesMatch(
    liveDatabase.schemaObjects,
    verified.manifest.database.state.schemaObjects,
  );
  const allTableCountsMatch = valuesMatch(
    liveDatabase.allTableCounts,
    verified.manifest.database.state.allTableCounts,
  );
  const allTableContentMatch = valuesMatch(
    liveDatabase.allTableDigests,
    verified.manifest.database.state.allTableDigests,
  );
  const fullLogicalStateMatch =
    liveDatabase.fullLogicalStateSha256 === verified.manifest.database.state.fullLogicalStateSha256;
  const assetsMatch = valuesMatch(
    normalizedPrivateTreeEntries(liveAssets),
    verified.manifest.assets.entries,
  );
  const uploadsMatch = valuesMatch(
    normalizedPrivateTreeEntries(liveUploads),
    verified.manifest.uploads.entries,
  );

  const signer = await loadAttestationSigner(options, await requireCheckoutRoot(options.checkoutRoot), [
    verified.backupRoot,
    dbPath,
    assetsDir,
    uploadsDir,
  ]);
  await signer.assertCurrent();
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "production_storage_state_assessment",
    scope: verified.manifest.scope,
    backupId: verified.manifest.backupId,
    observedAt: validity.issuedAt,
    requestId,
    ...validity,
    intendedSourceSha: verified.manifest.intendedSourceSha,
    preRefreshRuntimeSha: verified.manifest.preRefreshRuntimeSha,
    privateManifestSha256: expectedEvidence.expectedManifestSha256,
    backupBundleSha256: expectedEvidence.expectedBundleSha256,
    privateManifestSignature: verified.manifest.signature,
    attestationPublicKeySha256: signer.publicKeySha256,
    runtimeStopped: true,
    backupReverified: true,
    backupStable: true,
    liveStateStable: true,
    databaseIntegrityOk: true,
    foreignKeysOk: true,
    durableCountsMatch,
    durableContentMatch,
    migrationJournalMatch,
    databaseMetadataMatch,
    databaseSchemaMatch,
    allTableCountsMatch,
    allTableContentMatch,
    fullLogicalStateMatch,
    assetsMatch,
    uploadsMatch,
    exactPreBackupState:
      durableCountsMatch &&
      durableContentMatch &&
      migrationJournalMatch &&
      databaseMetadataMatch &&
      databaseSchemaMatch &&
      allTableCountsMatch &&
      allTableContentMatch &&
      fullLogicalStateMatch &&
      assetsMatch &&
      uploadsMatch,
  };
  return signedRecoveryReceipt(payload, signer);
}

async function ensureSameFilesystem(paths, quarantineRoot) {
  const quarantineStat = await fs.stat(quarantineRoot);
  for (const candidate of paths) {
    const parentStat = await fs.stat(path.dirname(candidate));
    requireCondition(parentStat.dev === quarantineStat.dev, "quarantine_cross_device_rejected");
    const sourceStat = await fs.lstat(candidate).catch((error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return null;
      throw error;
    });
    if (sourceStat === null) continue;
    requireCondition(
      !sourceStat.isSymbolicLink() && (sourceStat.isFile() || sourceStat.isDirectory()),
      "restore_preflight_source_unsafe",
    );
    requireCondition(sourceStat.dev === quarantineStat.dev, "quarantine_cross_device_rejected");
  }
}

async function createOwnedStageRoot(quarantineDir) {
  const stageRoot = path.join(quarantineDir, "replacement-staging");
  await fs.mkdir(stageRoot, { mode: 0o700 });
  await syncDirectory(quarantineDir);
  const stat = await requireOwnedDirectoryMode(stageRoot, 0o700, "restore_stage_root_unsafe");
  return {
    path: stageRoot,
    identity: { dev: String(stat.dev), ino: String(stat.ino), mode: stat.mode & 0o777 },
  };
}

async function removeOwnedStageRoot(stageRoot) {
  if (stageRoot === null) return;
  const stat = await fs.lstat(stageRoot.path).catch(() => null);
  requireCondition(
    stat?.isDirectory() &&
      !stat.isSymbolicLink() &&
      String(stat.dev) === stageRoot.identity.dev &&
      String(stat.ino) === stageRoot.identity.ino &&
      (stat.mode & 0o777) === stageRoot.identity.mode,
    "restore_stage_root_identity_changed",
  );
  await fs.rmdir(stageRoot.path);
  await syncDirectory(path.dirname(stageRoot.path));
}

async function captureOptionalStorageFile(candidate) {
  const before = await fs.lstat(candidate).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  });
  if (before === null) return { present: false };
  requireCondition(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, "restore_prestate_unsafe");
  const sha256 = await hashFile(candidate);
  const after = await fs.lstat(candidate).catch(() => null);
  requireCondition(
    after?.isFile() &&
      !after.isSymbolicLink() &&
      after.nlink === 1 &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.size === after.size,
    "restore_prestate_changed",
  );
  return {
    present: true,
    dev: String(after.dev),
    ino: String(after.ino),
    mode: after.mode & 0o7777,
    size: after.size,
    sha256,
  };
}

async function captureStorageDirectory(candidate) {
  const before = await fs.lstat(candidate).catch(() => null);
  requireCondition(before?.isDirectory() && !before.isSymbolicLink(), "restore_prestate_unsafe");
  const entries = await collectTreeManifest(candidate);
  const after = await fs.lstat(candidate).catch(() => null);
  requireCondition(
    after?.isDirectory() &&
      !after.isSymbolicLink() &&
      before.dev === after.dev &&
      before.ino === after.ino,
    "restore_prestate_changed",
  );
  return {
    dev: String(after.dev),
    ino: String(after.ino),
    mode: after.mode & 0o7777,
    entries,
  };
}

async function captureRestorePrestate(dbPath, assetsDir, uploadsDir, restoreAssets, restoreUploads) {
  return {
    database: await captureOptionalStorageFile(dbPath),
    databaseWal: await captureOptionalStorageFile(`${dbPath}-wal`),
    databaseShm: await captureOptionalStorageFile(`${dbPath}-shm`),
    assets: restoreAssets ? await captureStorageDirectory(assetsDir) : null,
    uploads: restoreUploads ? await captureStorageDirectory(uploadsDir) : null,
  };
}

async function captureMoveSource(candidate) {
  const stat = await fs.lstat(candidate).catch(() => null);
  requireCondition(stat && !stat.isSymbolicLink(), "restore_operation_source_missing_or_unsafe");
  if (stat.isFile()) return captureOptionalStorageFile(candidate);
  if (stat.isDirectory()) return captureStorageDirectory(candidate);
  fail("restore_operation_source_missing_or_unsafe");
}

async function captureQuarantinedPrestate(quarantineDir, restoreAssets, restoreUploads) {
  const databasePath = path.join(quarantineDir, "database.sqlite");
  return {
    database: await captureOptionalStorageFile(databasePath),
    databaseWal: await captureOptionalStorageFile(`${databasePath}-wal`),
    databaseShm: await captureOptionalStorageFile(`${databasePath}-shm`),
    assets: restoreAssets ? await captureStorageDirectory(path.join(quarantineDir, "assets")) : null,
    uploads: restoreUploads ? await captureStorageDirectory(path.join(quarantineDir, "uploads-staging")) : null,
  };
}

async function moveRestorePathNoReplace(source, destination) {
  const sourceBefore = await fs.lstat(source).catch(() => null);
  requireCondition(
    sourceBefore &&
      !sourceBefore.isSymbolicLink() &&
      (sourceBefore.isDirectory() || (sourceBefore.isFile() && sourceBefore.nlink === 1)),
    "restore_operation_source_missing_or_unsafe",
  );
  requireCondition((await fs.lstat(destination).catch(() => null)) === null, "restore_operation_destination_exists");
  try {
    if (sourceBefore.isFile()) {
      await fs.link(source, destination);
      const linked = await fs.lstat(destination);
      requireCondition(
        linked.isFile() && !linked.isSymbolicLink() && linked.dev === sourceBefore.dev && linked.ino === sourceBefore.ino,
        "restore_operation_publish_mismatch",
      );
      await fs.unlink(source);
    } else {
      await fs.rename(source, destination);
    }
  } catch (error) {
    if (error && typeof error === "object" && ["EEXIST", "ENOTEMPTY"].includes(error.code)) {
      fail("restore_operation_destination_exists");
    }
    throw error;
  }
  const published = await fs.lstat(destination).catch(() => null);
  requireCondition(
    published &&
      !published.isSymbolicLink() &&
      published.dev === sourceBefore.dev &&
      published.ino === sourceBefore.ino &&
      (sourceBefore.isFile() ? published.isFile() : published.isDirectory()) &&
      (sourceBefore.isDirectory() || published.nlink === 1) &&
      (await fs.lstat(source).catch(() => null)) === null,
    "restore_operation_publish_mismatch",
  );
}

async function classifyRestoreMoveEffect(operation, expectedSource) {
  const sourceExists = await pathExists(operation.source);
  const destinationExists = await pathExists(operation.destination);
  if (sourceExists && destinationExists) {
    const sourceStat = await fs.lstat(operation.source);
    const destinationStat = await fs.lstat(operation.destination);
    if (
      sourceStat.isFile() &&
      destinationStat.isFile() &&
      sourceStat.dev === destinationStat.dev &&
      sourceStat.ino === destinationStat.ino
    ) {
      return "ambiguous";
    }
    return valuesMatch(await captureMoveSource(operation.source), expectedSource) ? "not_effected" : "ambiguous";
  }
  if (sourceExists) {
    return valuesMatch(await captureMoveSource(operation.source), expectedSource) ? "not_effected" : "ambiguous";
  }
  if (destinationExists) {
    return valuesMatch(await captureMoveSource(operation.destination), expectedSource) ? "effected" : "ambiguous";
  }
  return "ambiguous";
}

async function acquireRestoreLock(lockPath, signer, payload) {
  const record = signedRecoveryRecord({
    schemaVersion: SCHEMA_VERSION,
    kind: "production_storage_restore_lock",
    ...payload,
  }, signer);
  await signer.assertCurrent();
  try {
    await writeExclusiveSignedJson(lockPath, record);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") fail("restore_reconciliation_required");
    throw error;
  }
  const snapshot = await readStableFile(
    lockPath,
    64 * 1024,
    "restore_lock_missing",
    "restore_lock_changed",
  );
  requireCondition(snapshot.raw.toString("utf8") === `${JSON.stringify(record, null, 2)}\n`, "restore_lock_changed");
  await signer.assertCurrent();
  return { path: lockPath, snapshot };
}

async function releaseRestoreLock(lock, signer, testCheckpoint) {
  await signer.assertCurrent();
  let current = await readStableFile(lock.path, 64 * 1024, "restore_lock_missing", "restore_lock_changed");
  requireCondition(
    current.sha256 === lock.snapshot.sha256 && valuesMatch(current.identity, lock.snapshot.identity),
    "restore_lock_changed",
  );
  await syncFile(lock.path);
  await syncDirectory(path.dirname(lock.path));
  if (typeof testCheckpoint === "function") {
    await testCheckpoint("before_restore_lock_terminal_unlink");
  }
  await signer.assertCurrent();
  current = await readStableFile(lock.path, 64 * 1024, "restore_lock_missing", "restore_lock_changed");
  requireCondition(
    current.sha256 === lock.snapshot.sha256 && valuesMatch(current.identity, lock.snapshot.identity),
    "restore_lock_changed",
  );
  await fs.unlink(lock.path);
}

async function writeExclusiveSignedJson(filePath, value) {
  const handle = await fs.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filePath));
}

function validatePrivatePrestateFile(value) {
  if (value?.present === false) {
    return exactKeys(value, ["present"]);
  }
  return Boolean(
    exactKeys(value, ["present", "dev", "ino", "mode", "size", "sha256"]) &&
      value.present === true &&
      typeof value.dev === "string" &&
      typeof value.ino === "string" &&
      Number.isInteger(value.mode) &&
      Number.isInteger(value.size) &&
      value.size >= 0 &&
      SHA256_PATTERN.test(value.sha256 ?? ""),
  );
}

function validatePrivatePrestateDirectory(value) {
  return Boolean(
    exactKeys(value, ["dev", "ino", "mode", "entries"]) &&
      typeof value.dev === "string" &&
      typeof value.ino === "string" &&
      Number.isInteger(value.mode) &&
      Array.isArray(value.entries),
  );
}

function validatePrivatePrestate(value, restoreSelectionValue) {
  if (!exactKeys(value, ["database", "databaseWal", "databaseShm", "assets", "uploads"])) return false;
  if (
    !validatePrivatePrestateFile(value.database) ||
    !validatePrivatePrestateFile(value.databaseWal) ||
    !validatePrivatePrestateFile(value.databaseShm)
  ) {
    return false;
  }
  const assetsSelected = restoreSelectionValue !== "database";
  const uploadsSelected = restoreSelectionValue === "database+assets+uploads";
  return (
    (assetsSelected ? validatePrivatePrestateDirectory(value.assets) : value.assets === null) &&
    (uploadsSelected ? validatePrivatePrestateDirectory(value.uploads) : value.uploads === null)
  );
}

function createPrivatePrestateEnvelope(base, preRestoreState, signer) {
  const record = signedRecoveryRecord({
    schemaVersion: SCHEMA_VERSION,
    kind: "production_storage_restore_private_prestate",
    ...base,
    preRestoreState,
  }, signer);
  const raw = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { record, raw, sha256: digest(raw) };
}

async function loadPrivatePrestateRecord(quarantineDir, verifier, expected) {
  await requireOwnedDirectoryMode(quarantineDir, 0o700, "restore_private_prestate_invalid");
  const snapshot = await readStableFile(
    path.join(quarantineDir, PRIVATE_PRESTATE_FILE),
    64 * 1024 * 1024,
    "restore_private_prestate_missing",
    "restore_private_prestate_invalid",
  );
  requireCondition(
    (snapshot.identity.mode & 0o777) === 0o600 &&
      (typeof process.getuid !== "function" || snapshot.identity.uid === process.getuid()),
    "restore_private_prestate_invalid",
  );
  let record;
  try {
    record = JSON.parse(snapshot.raw.toString("utf8"));
  } catch {
    fail("restore_private_prestate_invalid");
  }
  requireCondition(
    exactKeys(record, [
      "schemaVersion", "kind", "operationId", "backupId", "scope", "intendedSourceSha", "targetSourceSha",
      "preRefreshRuntimeSha", "restoreSelection", "createdAt", "manifestSha256", "backupBundleSha256",
      "preRestoreState", "attestationPublicKeySha256", "signature",
    ]),
    "restore_private_prestate_invalid",
  );
  const payload = verifySignedRecoveryRecord(record, verifier, "production_storage_restore_private_prestate");
  requireCondition(
    payload.operationId === expected.operationId &&
      payload.backupId === expected.backupId &&
      payload.scope === expected.scope &&
      payload.intendedSourceSha === expected.intendedSourceSha &&
      payload.targetSourceSha === expected.targetSourceSha &&
      payload.preRefreshRuntimeSha === expected.preRefreshRuntimeSha &&
      payload.restoreSelection === expected.restoreSelection &&
      payload.createdAt === expected.createdAt &&
      payload.manifestSha256 === expected.manifestSha256 &&
      payload.backupBundleSha256 === expected.backupBundleSha256 &&
      snapshot.sha256 === expected.privatePrestateRecordSha256 &&
      validatePrivatePrestate(payload.preRestoreState, payload.restoreSelection),
    "restore_private_prestate_invalid",
  );
  return { payload, record, snapshot };
}

async function loadRestoreJournalChain(journalDirectory, verifier) {
  const directory = await fs.lstat(journalDirectory).catch(() => null);
  requireCondition(
    directory?.isDirectory() &&
      !directory.isSymbolicLink() &&
      (directory.mode & 0o777) === 0o700 &&
      (typeof process.getuid !== "function" || directory.uid === process.getuid()),
    "restore_journal_invalid",
  );
  const names = (await fs.readdir(journalDirectory)).sort((left, right) => left.localeCompare(right, "en"));
  requireCondition(names.length > 0, "restore_journal_invalid");
  requireCondition(names.every((name, index) => name === `${String(index).padStart(6, "0")}.json`), "restore_journal_invalid");
  let priorSha256 = null;
  let operationId = null;
  let immutableBase = null;
  let latest = null;
  for (let index = 0; index < names.length; index += 1) {
    const snapshot = await readStableFile(
      path.join(journalDirectory, names[index]),
      4 * 1024 * 1024,
      "restore_journal_invalid",
      "restore_journal_invalid",
    );
    requirePrivateSnapshot(snapshot, 0o600, "restore_journal_invalid");
    let record;
    try {
      record = JSON.parse(snapshot.raw.toString("utf8"));
    } catch {
      fail("restore_journal_invalid");
    }
    requireCondition(
      exactKeys(record, [
        "schemaVersion", "kind", "operationId", "backupId", "scope", "intendedSourceSha", "targetSourceSha",
        "preRefreshRuntimeSha", "restoreSelection", "createdAt", "manifestSha256", "backupBundleSha256",
        "privatePrestateRecordSha256",
        "operations", "status", "pendingStep", "reconciliationCode",
        "completedSteps", "sequence", "previousRecordSha256", "attestationPublicKeySha256", "signature",
      ]),
      "restore_journal_invalid",
    );
    const payload = verifySignedRecoveryRecord(record, verifier, "production_storage_restore_journal");
    requireCondition(
      payload.sequence === index &&
        payload.previousRecordSha256 === priorSha256 &&
        (operationId === null || payload.operationId === operationId),
      "restore_journal_invalid",
    );
    requireCondition(SCOPES.has(payload.scope), "restore_journal_invalid");
    requireBackupId(payload.backupId);
    requireSha(payload.intendedSourceSha, "restore_journal_invalid");
    requireSha(payload.targetSourceSha, "restore_journal_invalid");
    requireSha(payload.preRefreshRuntimeSha, "restore_journal_invalid");
    requireCondition(SHA256_PATTERN.test(payload.manifestSha256 ?? ""), "restore_journal_invalid");
    requireCondition(SHA256_PATTERN.test(payload.backupBundleSha256 ?? ""), "restore_journal_invalid");
    requireCondition(SHA256_PATTERN.test(payload.privatePrestateRecordSha256 ?? ""), "restore_journal_invalid");
    requireCondition(
      ["database", "database+assets", "database+assets+uploads"].includes(payload.restoreSelection),
      "restore_journal_invalid",
    );
    requireCondition(
      ["prepared", "applying", "rolling_back", "rolled_back", "committed", "reconciliation_required"].includes(payload.status),
      "restore_journal_invalid",
    );
    requireCondition(
      payload.status === "reconciliation_required"
        ? payload.reconciliationCode === "restore_operation_destination_exists"
        : payload.reconciliationCode === null,
      "restore_journal_invalid",
    );
    requireCondition(Array.isArray(payload.operations) && Array.isArray(payload.completedSteps), "restore_journal_invalid");
    const steps = new Set();
    for (const operation of payload.operations) {
      requireCondition(
        exactKeys(operation, ["step", "source", "destination", "phase"]) &&
          typeof operation.step === "string" &&
          /^[a-z][a-z0-9_]*$/.test(operation.step) &&
          !steps.has(operation.step) &&
          path.isAbsolute(operation.source) &&
          path.isAbsolute(operation.destination) &&
          (operation.phase === "quarantine" || operation.phase === "install"),
        "restore_journal_invalid",
      );
      steps.add(operation.step);
    }
    requireCondition(
      new Set(payload.completedSteps).size === payload.completedSteps.length &&
        payload.completedSteps.every((step) => steps.has(step)) &&
        (payload.pendingStep === null ||
          steps.has(payload.pendingStep) ||
          (typeof payload.pendingStep === "string" && payload.pendingStep.startsWith("rollback:") && steps.has(payload.pendingStep.slice(9)))),
      "restore_journal_invalid",
    );
    if (payload.status === "committed") {
      requireCondition(payload.pendingStep === null && payload.completedSteps.length === payload.operations.length, "restore_journal_invalid");
    }
    if (payload.status === "prepared" || payload.status === "rolled_back" || payload.status === "reconciliation_required") {
      requireCondition(payload.pendingStep === null, "restore_journal_invalid");
    }
    if (index === 0) {
      await loadPrivatePrestateRecord(path.dirname(journalDirectory), verifier, payload);
    }
    const currentBase = {
      operationId: payload.operationId,
      backupId: payload.backupId,
      scope: payload.scope,
      intendedSourceSha: payload.intendedSourceSha,
      targetSourceSha: payload.targetSourceSha,
      preRefreshRuntimeSha: payload.preRefreshRuntimeSha,
      restoreSelection: payload.restoreSelection,
      createdAt: payload.createdAt,
      manifestSha256: payload.manifestSha256,
      backupBundleSha256: payload.backupBundleSha256,
      privatePrestateRecordSha256: payload.privatePrestateRecordSha256,
      operations: payload.operations,
    };
    if (immutableBase === null) immutableBase = currentBase;
    else requireCondition(valuesMatch(currentBase, immutableBase), "restore_journal_invalid");
    operationId = payload.operationId;
    priorSha256 = snapshot.sha256;
    latest = { payload, record, snapshot };
  }
  return latest;
}

async function appendRestoreJournal(journalDirectory, signer, base, previous, update) {
  const sequence = previous === null ? 0 : previous.payload.sequence + 1;
  const payload = {
    ...base,
    ...update,
    sequence,
    previousRecordSha256: previous === null ? null : previous.snapshot.sha256,
  };
  const record = signedRecoveryRecord(payload, signer);
  const target = path.join(journalDirectory, `${String(sequence).padStart(6, "0")}.json`);
  await signer.assertCurrent();
  await writeExclusiveSignedJson(target, record);
  const loaded = await loadRestoreJournalChain(journalDirectory, signer);
  requireCondition(loaded.payload.sequence === sequence, "restore_journal_publish_failed");
  await signer.assertCurrent();
  return loaded;
}

async function requireNoIncompleteRestoreJournal(quarantineRoot, verifier) {
  const entries = await fs.readdir(quarantineRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.startsWith("restore-")) continue;
    requireCondition(entry.isDirectory() && !entry.isSymbolicLink(), "restore_journal_invalid");
    const journalDirectory = path.join(quarantineRoot, entry.name, "recovery-journal");
    requireCondition(await pathExists(journalDirectory), "restore_reconciliation_required");
    const latest = await loadRestoreJournalChain(journalDirectory, verifier);
    requireCondition(
      latest.payload.status === "committed" || latest.payload.status === "rolled_back",
      "restore_reconciliation_required",
    );
  }
}

export async function restoreRecoveryBackup(options) {
  const checkoutRoot = await requireCheckoutRoot(options.checkoutRoot);
  const dbPath = await requireSafePath(options.dbPath, {
    absoluteCode: "db_path_must_be_absolute",
    unsafeCode: "database_path_unsafe",
    leafType: "file",
    allowMissing: false,
  });
  const assetsDir = await requireSafePath(options.assetsDir, {
    absoluteCode: "assets_path_must_be_absolute",
    unsafeCode: "assets_path_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const uploadsDir = await requireSafePath(options.uploadsDir, {
    absoluteCode: "uploads_path_must_be_absolute",
    unsafeCode: "uploads_path_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const quarantineRoot = await requireSafePath(options.quarantineRoot, {
    absoluteCode: "quarantine_root_must_be_absolute",
    unsafeCode: "quarantine_root_unsafe",
    leafType: "directory",
    allowMissing: false,
  });
  const backupId = requireBackupId(options.backupId);
  const intendedSourceSha = requireSha(options.intendedSourceSha, "invalid_intended_source_sha");
  const targetSourceSha = requireSha(options.targetSourceSha, "invalid_target_source_sha");
  const preRefreshRuntimeSha = requireSha(options.preRefreshRuntimeSha, "invalid_runtime_source_sha");
  const scope = requireScope(options.scope);
  requireCondition(options.runtimeStopped === true, "runtime_stop_required");
  requireCondition(
    typeof options.restoreAssets === "boolean" && typeof options.restoreUploads === "boolean",
    "restore_selection_invalid",
  );
  const selectedRestore = restoreSelection(options.restoreAssets, options.restoreUploads);
  const expectedPrivateManifestSha256 = requireEvidenceDigest(
    options.expectedPrivateManifestSha256,
    "expected_private_manifest_sha256_invalid",
  );
  const expectedBackupBundleSha256 = requireEvidenceDigest(
    options.expectedBackupBundleSha256,
    "expected_backup_bundle_sha256_invalid",
  );
  requireCondition(
    options.confirm ===
      `RESTORE:${backupId}:${targetSourceSha}:${selectedRestore}:${expectedPrivateManifestSha256}:${expectedBackupBundleSha256}`,
    "restore_confirmation_mismatch",
  );
  requireCondition(options.restoreUploads !== true || options.restoreAssets === true, "uploads_restore_requires_assets_restore");
  requireDisjointPaths([dbPath, assetsDir, uploadsDir], "storage_source_paths_overlap");

  const verified = await verifyBackupPrivate({
    backupDir: options.backupDir,
    checkoutRoot,
    backupId,
    intendedSourceSha,
    preRefreshRuntimeSha,
    scope,
    attestationPublicKeyPath: options.attestationPublicKeyPath,
    expectedAttestationPublicKeySha256: options.expectedAttestationPublicKeySha256,
  });
  requireExpectedBackupEvidence(options, verified);
  requireCondition(targetSourceSha === verified.manifest.preRefreshRuntimeSha, "restore_target_not_pre_refresh_runtime");
  const restoreLockPath = `${dbPath}.nutrition-recovery-restore.lock`;
  requireDisjointPaths(
    [dbPath, assetsDir, uploadsDir, verified.backupDir, quarantineRoot, restoreLockPath],
    "restore_paths_overlap",
  );

  await requireFile(dbPath, "live_database_missing");
  await requireDirectory(assetsDir, "live_assets_missing");
  await requireDirectory(uploadsDir, "live_uploads_missing");
  await requireOwnedDirectoryMode(quarantineRoot, 0o700, "quarantine_root_permissions_unsafe");
  const signer = await loadAttestationSigner(options, checkoutRoot, [
    dbPath,
    assetsDir,
    uploadsDir,
    verified.backupRoot,
    quarantineRoot,
    restoreLockPath,
  ]);
  await ensureSameFilesystem(
    [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      ...(options.restoreAssets ? [assetsDir] : []),
      ...(options.restoreUploads ? [uploadsDir] : []),
    ],
    quarantineRoot,
  );

  const token = randomUUID();
  const restoreCreatedAt = asiaTaipeiTimestamp(options.now);
  const preRestoreState = await captureRestorePrestate(
    dbPath,
    assetsDir,
    uploadsDir,
    options.restoreAssets === true,
    options.restoreUploads === true,
  );
  const privatePrestate = createPrivatePrestateEnvelope({
    operationId: token,
    backupId,
    scope,
    intendedSourceSha,
    targetSourceSha,
    preRefreshRuntimeSha,
    restoreSelection: selectedRestore,
    createdAt: restoreCreatedAt,
    manifestSha256: expectedPrivateManifestSha256,
    backupBundleSha256: expectedBackupBundleSha256,
  }, preRestoreState, signer);
  let restoreLock;
  try {
    restoreLock = await acquireRestoreLock(restoreLockPath, signer, {
      operationId: token,
      backupId,
      scope,
      intendedSourceSha,
      targetSourceSha,
      preRefreshRuntimeSha,
      restoreSelection: selectedRestore,
      privateManifestSha256: expectedPrivateManifestSha256,
      backupBundleSha256: expectedBackupBundleSha256,
      privatePrestateRecordSha256: privatePrestate.sha256,
      createdAt: restoreCreatedAt,
    });
  } catch {
    fail("restore_reconciliation_required");
  }
  let lockMayRelease = false;
  try {
    if (typeof options.testCheckpoint === "function") await options.testCheckpoint("after_restore_lock_acquired");
    await requireNoIncompleteRestoreJournal(quarantineRoot, signer);
    requireCondition(
      valuesMatch(
        await captureRestorePrestate(
          dbPath,
          assetsDir,
          uploadsDir,
          options.restoreAssets === true,
          options.restoreUploads === true,
        ),
        preRestoreState,
      ),
      "restore_prestate_changed",
    );
    const quarantineDir = path.join(quarantineRoot, `restore-${backupId}-${token}`);
    await fs.mkdir(quarantineDir, { mode: 0o700 });
    await syncDirectory(quarantineRoot);
    await writeExclusiveSignedJson(path.join(quarantineDir, PRIVATE_PRESTATE_FILE), privatePrestate.record);
    const loadedPrivatePrestate = await loadPrivatePrestateRecord(quarantineDir, signer, {
      operationId: token,
      backupId,
      scope,
      intendedSourceSha,
      targetSourceSha,
      preRefreshRuntimeSha,
      restoreSelection: selectedRestore,
      createdAt: restoreCreatedAt,
      manifestSha256: expectedPrivateManifestSha256,
      backupBundleSha256: expectedBackupBundleSha256,
      privatePrestateRecordSha256: privatePrestate.sha256,
    });
    requireCondition(
      loadedPrivatePrestate.snapshot.raw.equals(privatePrestate.raw),
      "restore_private_prestate_invalid",
    );
    if (typeof options.testCheckpoint === "function") {
      await options.testCheckpoint("after_private_prestate_published");
    }
  let ownedStageRoot = null;
  let cleanupStageRoot = false;

  try {
    ownedStageRoot = await createOwnedStageRoot(quarantineDir);
    const dbStage = path.join(ownedStageRoot.path, BACKUP_DATABASE_FILE);
    const assetsStage = path.join(ownedStageRoot.path, BACKUP_ASSETS_DIRECTORY);
    const uploadsStage = path.join(ownedStageRoot.path, BACKUP_UPLOADS_DIRECTORY);
    await fs.copyFile(verified.snapshotPath, dbStage, fsConstants.COPYFILE_EXCL);
    await fs.chmod(dbStage, 0o600);
    await requirePrivateDatabaseFile(dbStage, "restore_stage_database_permissions_unsafe");
    requireCondition((await hashFile(dbStage)) === verified.manifest.database.sha256, "restore_stage_database_mismatch");
    requireCondition(
      valuesMatch(readDatabaseState(dbStage), verified.manifest.database.state),
      "restore_stage_database_state_mismatch",
    );

    if (options.restoreAssets) {
      await copyTree(verified.assetsDir, assetsStage);
      await normalizePrivateTreePermissions(assetsStage);
      await requireOwnedDirectoryMode(assetsStage, verified.manifest.assets.mode, "restore_stage_assets_permissions_unsafe");
      requireCondition(
        valuesMatch(await collectTreeManifest(assetsStage), verified.manifest.assets.entries),
        "restore_stage_assets_mismatch",
      );
    }
    if (options.restoreUploads) {
      await copyTree(verified.uploadsDir, uploadsStage);
      await normalizePrivateTreePermissions(uploadsStage);
      await requireOwnedDirectoryMode(uploadsStage, verified.manifest.uploads.mode, "restore_stage_uploads_permissions_unsafe");
      requireCondition(
        valuesMatch(await collectTreeManifest(uploadsStage), verified.manifest.uploads.entries),
        "restore_stage_uploads_mismatch",
      );
    }

    await syncTree(ownedStageRoot.path);

    const journalDirectory = path.join(quarantineDir, "recovery-journal");
    await fs.mkdir(journalDirectory, { mode: 0o700 });
    await syncDirectory(quarantineDir);

    const operations = [];
    const expectedOperationSources = new Map();
    async function addExistingOperation(step, source, destination, phase, expectedSource) {
      if (await pathExists(source)) {
        operations.push({ step, source, destination, phase });
        expectedOperationSources.set(step, expectedSource);
      }
    }
    await addExistingOperation(
      "quarantine_database", dbPath, path.join(quarantineDir, "database.sqlite"), "quarantine", preRestoreState.database,
    );
    await addExistingOperation(
      "quarantine_database_wal", `${dbPath}-wal`, path.join(quarantineDir, "database.sqlite-wal"), "quarantine",
      preRestoreState.databaseWal,
    );
    await addExistingOperation(
      "quarantine_database_shm", `${dbPath}-shm`, path.join(quarantineDir, "database.sqlite-shm"), "quarantine",
      preRestoreState.databaseShm,
    );
    if (options.restoreAssets) {
      await addExistingOperation(
        "quarantine_assets", assetsDir, path.join(quarantineDir, "assets"), "quarantine", preRestoreState.assets,
      );
    }
    if (options.restoreUploads) {
      await addExistingOperation(
        "quarantine_uploads",
        uploadsDir,
        path.join(quarantineDir, "uploads-staging"),
        "quarantine",
        preRestoreState.uploads,
      );
    }
    operations.push({ step: "install_database", source: dbStage, destination: dbPath, phase: "install" });
    expectedOperationSources.set("install_database", await captureMoveSource(dbStage));
    if (options.restoreAssets) {
      operations.push({ step: "install_assets", source: assetsStage, destination: assetsDir, phase: "install" });
      expectedOperationSources.set("install_assets", await captureMoveSource(assetsStage));
    }
    if (options.restoreUploads) {
      operations.push({ step: "install_uploads", source: uploadsStage, destination: uploadsDir, phase: "install" });
      expectedOperationSources.set("install_uploads", await captureMoveSource(uploadsStage));
    }

    const journalBase = {
      schemaVersion: SCHEMA_VERSION,
      kind: "production_storage_restore_journal",
      operationId: token,
      backupId,
      scope,
      intendedSourceSha,
      targetSourceSha,
      preRefreshRuntimeSha,
      restoreSelection: selectedRestore,
      createdAt: restoreCreatedAt,
      manifestSha256: verified.manifestSnapshot.sha256,
      backupBundleSha256: verified.bundleSha256,
      privatePrestateRecordSha256: privatePrestate.sha256,
      operations,
      reconciliationCode: null,
    };
    const completedSteps = [];
    const effectedOperations = [];
    requireCondition(
      valuesMatch(
        await captureRestorePrestate(
          dbPath,
          assetsDir,
          uploadsDir,
          options.restoreAssets === true,
          options.restoreUploads === true,
        ),
        preRestoreState,
      ),
      "restore_prestate_changed",
    );
    if (typeof options.testCheckpoint === "function") {
      await options.testCheckpoint("before_destructive_restore_recheck");
    }
    const verifiedBeforeMove = await verifyBackupPrivate({
      backupDir: options.backupDir,
      checkoutRoot,
      backupId,
      intendedSourceSha,
      preRefreshRuntimeSha,
      scope,
      attestationPublicKeyPath: options.attestationPublicKeyPath,
      expectedAttestationPublicKeySha256: options.expectedAttestationPublicKeySha256,
    });
    requireExpectedBackupEvidence(options, verifiedBeforeMove);
    requireCondition(
      verifiedBeforeMove.manifestSnapshot.sha256 === verified.manifestSnapshot.sha256 &&
        verifiedBeforeMove.bundleSha256 === verified.bundleSha256,
      "restore_backup_changed_before_move",
    );
    await signer.assertCurrent();
    await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope, "checkout_source_sha_changed");
    let journal = await appendRestoreJournal(journalDirectory, signer, journalBase, null, {
      status: "prepared",
      pendingStep: null,
      completedSteps: [],
    });
    async function applyOperation(operation) {
      journal = await appendRestoreJournal(journalDirectory, signer, journalBase, journal, {
        status: "applying",
        pendingStep: operation.step,
        completedSteps: [...completedSteps],
      });
      if (typeof options.testCheckpoint === "function") {
        await options.testCheckpoint(`before_restore_operation:${operation.step}`);
      }
      requireCondition(
        valuesMatch(await captureMoveSource(operation.source), expectedOperationSources.get(operation.step)),
        "restore_operation_source_changed",
      );
      try {
        await moveRestorePathNoReplace(operation.source, operation.destination);
      } catch (error) {
        const effect = await classifyRestoreMoveEffect(operation, expectedOperationSources.get(operation.step));
        if (effect === "effected") effectedOperations.push(operation);
        else if (effect === "ambiguous") fail("restore_operation_effect_ambiguous");
        throw error;
      }
      effectedOperations.push(operation);
      completedSteps.push(operation.step);
      await syncTree(operation.destination);
      await syncDirectory(path.dirname(operation.source));
      if (path.dirname(operation.destination) !== path.dirname(operation.source)) {
        await syncDirectory(path.dirname(operation.destination));
      }
      journal = await appendRestoreJournal(journalDirectory, signer, journalBase, journal, {
        status: "applying",
        pendingStep: null,
        completedSteps: [...completedSteps],
      });
    }

    try {
      for (const operation of operations) await applyOperation(operation);

      requireCondition(
        valuesMatch(readDatabaseState(dbPath), verified.manifest.database.state),
        "restored_database_state_mismatch",
      );
      await requirePrivateDatabaseFile(dbPath, "restored_database_permissions_unsafe");
      if (options.restoreAssets) {
        await requireOwnedDirectoryMode(assetsDir, verified.manifest.assets.mode, "restored_assets_permissions_unsafe");
        requireCondition(
          valuesMatch(await collectTreeManifest(assetsDir), verified.manifest.assets.entries),
          "restored_assets_mismatch",
        );
      }
      if (options.restoreUploads) {
        await requireOwnedDirectoryMode(uploadsDir, verified.manifest.uploads.mode, "restored_uploads_permissions_unsafe");
        requireCondition(
          valuesMatch(await collectTreeManifest(uploadsDir), verified.manifest.uploads.entries),
          "restored_uploads_mismatch",
        );
      }
      requireCondition(
        valuesMatch(
          await captureQuarantinedPrestate(
            quarantineDir,
            options.restoreAssets === true,
            options.restoreUploads === true,
          ),
          preRestoreState,
        ),
        "restore_quarantine_prestate_mismatch",
      );

      await signer.assertCurrent();
      await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope, "checkout_source_sha_changed");
      journal = await appendRestoreJournal(journalDirectory, signer, journalBase, journal, {
        status: "committed",
        pendingStep: null,
        completedSteps: [...completedSteps],
      });
      await syncDirectory(quarantineRoot);
      const committedJournal = await loadRestoreJournalChain(journalDirectory, signer);
      requireCondition(
        committedJournal.payload.status === "committed" && committedJournal.snapshot.sha256 === journal.snapshot.sha256,
        "restore_journal_publish_failed",
      );
      await signer.assertCurrent();
      await requireCheckoutAuthority(checkoutRoot, intendedSourceSha, scope, "checkout_source_sha_changed");
      cleanupStageRoot = true;
      lockMayRelease = true;

      const receiptPayload = {
        schemaVersion: SCHEMA_VERSION,
        kind: "production_storage_restore",
        scope,
        backupId,
        observedAt: asiaTaipeiTimestamp(options.now),
        intendedSourceSha,
        targetSourceSha,
        restoreSelection: selectedRestore,
        runtimeStopped: true,
        backupReverified: true,
        databaseRestored: true,
        assetsRestored: options.restoreAssets === true,
        uploadsRestored: options.restoreUploads === true,
        quarantinePreserved: true,
        quarantineDurable: true,
        replacementDurable: true,
        journalCommitted: true,
        journalSequence: journal.payload.sequence,
        journalRecordSha256: journal.snapshot.sha256,
        restoreLockSha256: restoreLock.snapshot.sha256,
        privatePrestateRecordSha256: privatePrestate.sha256,
        privateManifestSha256: verified.manifestSnapshot.sha256,
        backupBundleSha256: verified.bundleSha256,
        attestationPublicKeySha256: signer.publicKeySha256,
        databaseIntegrityOk: true,
        foreignKeysOk: true,
      };
      return signedRecoveryReceipt(receiptPayload, signer);
    } catch (error) {
      const collisionRequiresReconciliation = error?.code === "restore_operation_destination_exists";
      try {
        journal = await appendRestoreJournal(journalDirectory, signer, journalBase, journal, {
          status: "rolling_back",
          pendingStep: null,
          completedSteps: [...completedSteps],
        });
        for (const operation of [...effectedOperations].reverse()) {
          const rollbackStep = `rollback:${operation.step}`;
          journal = await appendRestoreJournal(journalDirectory, signer, journalBase, journal, {
            status: "rolling_back",
            pendingStep: rollbackStep,
            completedSteps: [...completedSteps],
          });
          requireCondition(
            valuesMatch(
              await captureMoveSource(operation.destination),
              expectedOperationSources.get(operation.step),
            ),
            "restore_rollback_source_changed",
          );
          if (operation.phase === "install") {
            const preserved = path.join(quarantineDir, `failed-${operation.step}`);
            requireCondition(!(await pathExists(preserved)), "restore_rollback_destination_exists");
            requireCondition(await pathExists(operation.destination), "restore_rollback_source_missing");
            await moveRestorePathNoReplace(operation.destination, preserved);
            await syncTree(preserved);
          } else {
            requireCondition(await pathExists(operation.destination), "restore_rollback_source_missing");
            requireCondition(!(await pathExists(operation.source)), "restore_rollback_destination_exists");
            await moveRestorePathNoReplace(operation.destination, operation.source);
            await syncTree(operation.source);
          }
          await syncDirectory(path.dirname(operation.source));
          await syncDirectory(path.dirname(operation.destination));
          journal = await appendRestoreJournal(journalDirectory, signer, journalBase, journal, {
            status: "rolling_back",
            pendingStep: null,
            completedSteps: [...completedSteps],
          });
        }
        requireCondition(
          valuesMatch(
            await captureRestorePrestate(
              dbPath,
              assetsDir,
              uploadsDir,
              options.restoreAssets === true,
              options.restoreUploads === true,
            ),
            preRestoreState,
          ),
          "restore_rollback_prestate_mismatch",
        );
        journal = await appendRestoreJournal(journalDirectory, signer, journalBase, journal, {
          status: collisionRequiresReconciliation ? "reconciliation_required" : "rolled_back",
          pendingStep: null,
          completedSteps: [...completedSteps],
          reconciliationCode: collisionRequiresReconciliation ? "restore_operation_destination_exists" : null,
        });
        await syncDirectory(quarantineRoot);
        if (!collisionRequiresReconciliation) {
          lockMayRelease = true;
        }
      } catch {
        fail("restore_reconciliation_required");
      }
      if (collisionRequiresReconciliation) fail("restore_reconciliation_required");
      throw error;
    }
  } catch (error) {
    if (!lockMayRelease) fail("restore_reconciliation_required");
    throw error;
  } finally {
    if (cleanupStageRoot && ownedStageRoot !== null) {
      try {
        await removeOwnedStageRoot(ownedStageRoot);
      } catch {
        lockMayRelease = false;
        fail("restore_reconciliation_required");
      }
    }
  }
  } catch (error) {
    if (!lockMayRelease) fail("restore_reconciliation_required");
    throw error;
  } finally {
    if (lockMayRelease) {
      try {
        if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_restore_lock_release");
        await releaseRestoreLock(restoreLock, signer, options.testCheckpoint);
      } catch {
        fail("restore_reconciliation_required");
      }
    }
  }
}

const CLI_SCHEMAS = {
  backup: {
    values: new Set([
      "checkout-root", "db", "assets", "uploads", "backup-root", "backup-id", "intended-source-sha",
      "pre-refresh-runtime-sha", "runtime-provenance-origin", "scope", "attestation-private-key",
      "attestation-public-key", "expected-attestation-key-sha256",
    ]),
    flags: new Set(["quiesced"]),
  },
  verify: {
    values: new Set([
      "checkout-root", "backup-dir", "backup-id", "intended-source-sha", "pre-refresh-runtime-sha", "scope",
      "attestation-private-key", "attestation-public-key", "expected-attestation-key-sha256", "request-id",
    ]),
    flags: new Set(),
  },
  assess: {
    values: new Set([
      "checkout-root", "backup-dir", "backup-id", "intended-source-sha", "pre-refresh-runtime-sha", "scope",
      "db", "assets", "uploads", "attestation-private-key", "attestation-public-key", "expected-attestation-key-sha256",
      "expected-private-manifest-sha256", "expected-backup-bundle-sha256", "request-id",
    ]),
    flags: new Set(["runtime-stopped"]),
  },
  restore: {
    values: new Set([
      "checkout-root", "backup-dir", "db", "assets", "uploads", "quarantine-root", "backup-id",
      "intended-source-sha", "target-source-sha", "pre-refresh-runtime-sha", "scope", "confirm",
      "attestation-private-key", "attestation-public-key", "expected-attestation-key-sha256",
      "expected-private-manifest-sha256", "expected-backup-bundle-sha256",
    ]),
    flags: new Set(["runtime-stopped", "restore-assets", "restore-uploads"]),
  },
};

function parseCli(argv) {
  const [command, ...args] = argv;
  const schema = CLI_SCHEMAS[command];
  requireCondition(schema !== undefined, "unknown_command");
  const values = {};
  const flags = new Set();

  for (const arg of args) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/s);
    requireCondition(match !== null, "invalid_argument");
    const [, key, value] = match;
    if (value === undefined) {
      requireCondition(schema.flags.has(key) && !flags.has(key), "invalid_argument");
      flags.add(key);
    } else {
      requireCondition(schema.values.has(key) && value.length > 0 && !Object.hasOwn(values, key), "invalid_argument");
      values[key] = value;
    }
  }
  requireCondition([...schema.values].every((key) => Object.hasOwn(values, key)), "missing_required_argument");
  return { command, values, flags };
}

function requireCliValue(values, name) {
  const value = values[name];
  requireCondition(typeof value === "string" && value.length > 0, "missing_required_argument");
  return value;
}

async function runCli(argv) {
  const { command, values, flags } = parseCli(argv);
  if (command === "backup") {
    const result = await createRecoveryBackup({
      checkoutRoot: requireCliValue(values, "checkout-root"),
      dbPath: requireCliValue(values, "db"),
      assetsDir: requireCliValue(values, "assets"),
      uploadsDir: requireCliValue(values, "uploads"),
      backupRoot: requireCliValue(values, "backup-root"),
      backupId: requireCliValue(values, "backup-id"),
      intendedSourceSha: requireCliValue(values, "intended-source-sha"),
      preRefreshRuntimeSha: requireCliValue(values, "pre-refresh-runtime-sha"),
      runtimeProvenanceOrigin: requireCliValue(values, "runtime-provenance-origin"),
      scope: requireCliValue(values, "scope"),
      quiesced: flags.has("quiesced"),
      attestationPrivateKeyPath: requireCliValue(values, "attestation-private-key"),
      attestationPublicKeyPath: requireCliValue(values, "attestation-public-key"),
      expectedAttestationPublicKeySha256: requireCliValue(values, "expected-attestation-key-sha256"),
    });
    return result.receipt;
  }
  if (command === "verify") {
    return verifyRecoveryBackup({
      checkoutRoot: requireCliValue(values, "checkout-root"),
      backupDir: requireCliValue(values, "backup-dir"),
      backupId: requireCliValue(values, "backup-id"),
      intendedSourceSha: requireCliValue(values, "intended-source-sha"),
      preRefreshRuntimeSha: requireCliValue(values, "pre-refresh-runtime-sha"),
      scope: requireCliValue(values, "scope"),
      requestId: requireCliValue(values, "request-id"),
      attestationPrivateKeyPath: requireCliValue(values, "attestation-private-key"),
      attestationPublicKeyPath: requireCliValue(values, "attestation-public-key"),
      expectedAttestationPublicKeySha256: requireCliValue(values, "expected-attestation-key-sha256"),
    });
  }
  if (command === "assess") {
    return assessRecoveryState({
      checkoutRoot: requireCliValue(values, "checkout-root"),
      backupDir: requireCliValue(values, "backup-dir"),
      backupId: requireCliValue(values, "backup-id"),
      intendedSourceSha: requireCliValue(values, "intended-source-sha"),
      preRefreshRuntimeSha: requireCliValue(values, "pre-refresh-runtime-sha"),
      scope: requireCliValue(values, "scope"),
      requestId: requireCliValue(values, "request-id"),
      dbPath: requireCliValue(values, "db"),
      assetsDir: requireCliValue(values, "assets"),
      uploadsDir: requireCliValue(values, "uploads"),
      runtimeStopped: flags.has("runtime-stopped"),
      attestationPrivateKeyPath: requireCliValue(values, "attestation-private-key"),
      attestationPublicKeyPath: requireCliValue(values, "attestation-public-key"),
      expectedAttestationPublicKeySha256: requireCliValue(values, "expected-attestation-key-sha256"),
      expectedPrivateManifestSha256: requireCliValue(values, "expected-private-manifest-sha256"),
      expectedBackupBundleSha256: requireCliValue(values, "expected-backup-bundle-sha256"),
    });
  }
  if (command === "restore") {
    return restoreRecoveryBackup({
      checkoutRoot: requireCliValue(values, "checkout-root"),
      backupDir: requireCliValue(values, "backup-dir"),
      dbPath: requireCliValue(values, "db"),
      assetsDir: requireCliValue(values, "assets"),
      uploadsDir: requireCliValue(values, "uploads"),
      quarantineRoot: requireCliValue(values, "quarantine-root"),
      backupId: requireCliValue(values, "backup-id"),
      intendedSourceSha: requireCliValue(values, "intended-source-sha"),
      targetSourceSha: requireCliValue(values, "target-source-sha"),
      preRefreshRuntimeSha: requireCliValue(values, "pre-refresh-runtime-sha"),
      scope: requireCliValue(values, "scope"),
      runtimeStopped: flags.has("runtime-stopped"),
      restoreAssets: flags.has("restore-assets"),
      restoreUploads: flags.has("restore-uploads"),
      confirm: requireCliValue(values, "confirm"),
      attestationPrivateKeyPath: requireCliValue(values, "attestation-private-key"),
      attestationPublicKeyPath: requireCliValue(values, "attestation-public-key"),
      expectedAttestationPublicKeySha256: requireCliValue(values, "expected-attestation-key-sha256"),
      expectedPrivateManifestSha256: requireCliValue(values, "expected-private-manifest-sha256"),
      expectedBackupBundleSha256: requireCliValue(values, "expected-backup-bundle-sha256"),
    });
  }
  fail("unknown_command");
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const receipt = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    const code = error instanceof RecoveryError ? error.code : "unexpected_recovery_error";
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        kind: "production_storage_recovery_error",
        code,
        ...(code === "restore_reconciliation_required" ||
        code === "restore_journal_invalid" ||
        code === "backup_reconciliation_required"
          ? { status: "needs_reconciliation" }
          : {}),
      })}\n`,
    );
    process.exitCode = 1;
  }
}
