import { deepEqual, equal, match, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const INVENTORY_PATH = path.resolve("docs/workflow/gsd-workflow-inventory.md");

const SKILLS = [
  "nutrition-db-query",
  "nutrition-milestone-closeout",
  "nutrition-new-harness-scenario",
  "nutrition-planning-proof",
  "nutrition-security-review",
  "nutrition-tunnel-smoke",
  "nutrition-verify-change",
];

const WORKFLOWS = [
  "production-recovery",
  "safe-db-query",
  "state-check",
  "sync-worktree-agents",
  "artifact-provenance",
  "command-receipt",
  "gsd-wiring",
  "normalize-gsd-host",
  "plan-proof-lint",
  "planning-closeout",
  "project-scope",
  "tree-fingerprint",
  "verification-seal",
  "workflow-lease",
];

const PPL = Array.from({ length: 8 }, (_, index) => `PPL${String(index + 1).padStart(3, "0")}`);

const REQUIRED_ROW_FIELDS = [
  "surface",
  "surfaceFiles",
  "callers",
  "bindings",
  "scopeGuards",
  "negativeControls",
  "overlap",
  "decision",
  "uniqueInvariant",
  "canonicalOwner",
  "lifecycle",
  "worktreeStatus",
  "committedStatus",
  "observedLocalStatus",
  "phase129CommitScope",
  "replacementProof",
  "remainingRisk",
];

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function table(markdown: string, heading: string): Record<string, string>[] {
  const sectionStart = markdown.indexOf(`## ${heading}`);
  ok(sectionStart >= 0, `missing inventory section: ${heading}`);
  const section = markdown.slice(sectionStart + `## ${heading}`.length).split(/^## /m)[0];
  const lines = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  ok(lines.length >= 3, `missing table rows for ${heading}`);
  const headers = cells(lines[0]);
  ok(headers.every((header) => header.length > 0), `empty header in ${heading}`);
  return lines.slice(2).map((line) => {
    const values = cells(line);
    equal(values.length, headers.length, `column count mismatch in ${heading}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function inventory(): Promise<string> {
  return readFile(INVENTORY_PATH, "utf8");
}

test("inventory has exactly seven canonical skill rows", async () => {
  const rows = table(await inventory(), "Canonical nutrition skills");
  equal(rows.length, SKILLS.length);
  deepEqual(rows.map((row) => row.surface), SKILLS);
});

test("inventory has exactly fourteen logical workflow rows", async () => {
  const rows = table(await inventory(), "Logical workflow surfaces");
  equal(rows.length, WORKFLOWS.length);
  deepEqual(rows.map((row) => row.surface), WORKFLOWS);
});

test("workflow declarations are paired in one logical row", async () => {
  const rows = table(await inventory(), "Logical workflow surfaces");
  for (const row of rows) {
    const files = row.surfaceFiles.split(",").map((file) => file.trim().replaceAll("`", ""));
    const declarations = files.filter((file) => file.endsWith(".d.mts"));
    if (row.declarationPairing === "no-declaration") {
      equal(declarations.length, 0, `${row.surface} unexpectedly lists a declaration`);
      continue;
    }
    equal(row.declarationPairing, "same-logical-row");
    equal(declarations.length, 1, `${row.surface} must list one declaration`);
    equal(files.filter((file) => file.endsWith(".mjs")).length, 1, `${row.surface} must list one implementation`);
  }
});

test("inventory records all historical PPL findings and statuses", async () => {
  const rows = table(await inventory(), "Historical PPL findings");
  equal(rows.length, PPL.length);
  deepEqual(rows.map((row) => row.finding), PPL);
  for (const row of rows) {
    ok(["retained", "removed"].includes(row.lifecycle));
    ok(["clean", "dirty-modified", "dirty-deleted", "untracked"].includes(row.worktreeStatus));
    for (const field of ["canonicalOwner", "replacementStatus"]) ok(row[field], `${row.finding} missing ${field}`);
  }
});

test("every skill and workflow row has proof fields and removal evidence", async () => {
  const markdown = await inventory();
  const rows = [...table(markdown, "Canonical nutrition skills"), ...table(markdown, "Logical workflow surfaces")];
  const owners = rows.map((row) => row.canonicalOwner);
  equal(new Set(owners).size, owners.length, "canonical owners must be unique");
  for (const row of rows) {
    for (const field of REQUIRED_ROW_FIELDS) ok(row[field], `${row.surface} missing ${field}`);
    ok(["retained", "removed"].includes(row.lifecycle));
    ok(["clean", "dirty-modified", "dirty-deleted", "untracked"].includes(row.worktreeStatus));
    if (row.lifecycle === "removed") {
      match(row.replacementProof, /owner=|proof=|test=/i);
    }
  }
});

test("Remove rows separate committed HEAD state from pre-existing dirty deletions", async () => {
  const rows = table(await inventory(), "Logical workflow surfaces");
  for (const row of rows.filter((candidate) => candidate.decision === "Remove")) {
    equal(row.committedStatus, "retained/live in HEAD");
    equal(row.observedLocalStatus, "dirty-deleted pre-existing");
    equal(row.phase129CommitScope, "excluded/future source submission boundary");
    match(row.replacementProof, /HEAD path|future/i);
    ok(!/submitted|deleted from HEAD|source removed/i.test(row.replacementProof), `${row.surface} must not claim a dirty deletion was submitted`);

    const files = row.surfaceFiles.split(",").map((file) => file.trim().replaceAll("`", ""));
    for (const file of files) {
      execFileSync("git", ["cat-file", "-e", `HEAD:${file}`]);
    }
  }
});

test("inventory remains metadata-only and contains no unsupported sensitive evidence", async () => {
  const markdown = await inventory();
  const forbidden = [
    /(?:^|[\s`])\/(?:Users|home|private|tmp)\//i,
    /\b(?:sk|ghp|xoxb|ya29)-[A-Za-z0-9_-]{8,}/,
    /\bBearer\s+[A-Za-z0-9._-]{10,}/i,
    /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i,
    /data:image\//i,
    /sqlite(?:3)?\s+dump/i,
    /(?:raw|full)\s+(?:prompt|transcript|provider|tool)\s+payload/i,
    /\b(?:cookie|session[_ -]?id|access[_ -]?token)\s*[:=]\s*[A-Za-z0-9+/=_-]{12,}/i,
    /\bsigned\s+(?:receipt|attestation)\b/i,
    /\b(?:receipt|attestation)\s+(?:claim|proof|artifact)\b/i,
  ];
  for (const pattern of forbidden) ok(!pattern.test(markdown), `forbidden evidence matched: ${pattern}`);
  match(markdown, /metadata-only/i);
});

test("canonical policy pointer keeps no-changelog provenance on PR labels", async () => {
  const rows = table(await inventory(), "Canonical policy pointers");
  const policy = rows.find((row) => row.surface === "pr-label-provenance");
  ok(policy);
  match(policy.canonicalOwner, /scripts\/pr-policy-check\.mjs/);
  match(policy.provenance, /no-changelog.*PR.*label/i);
  match(policy.provenance, /never.*issue.*label/i);
});
