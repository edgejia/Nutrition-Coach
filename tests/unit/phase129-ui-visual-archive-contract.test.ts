import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const ARCHIVE_DIR = "tests/fixtures/historical/ui-visual";
const MANIFEST_PATH = path.join(ARCHIVE_DIR, "manifest.json");
const EVIDENCE_PATH = path.join(ARCHIVE_DIR, "caller-evidence.txt");
const AGGREGATE_PATH = path.join(ARCHIVE_DIR, "visual-scripts-aggregate.mjs.md");
const README_PATH = path.join(ARCHIVE_DIR, "README.md");
const RETAINED_110 = "tests/harness/scenarios/110-home-nutrition-animation-visual.mjs";
const EXPECTED_BASENAMES = [
  "42.5-ui-fidelity-visual.mjs",
  "43-sport-ui-built-smoke.mjs",
  "49-history-dashboard-polish-visual.mjs",
  "77-history-loading-visual.mjs",
  "81-mobile-action-safety-visual.mjs",
  "82-history-meal-navigation-visual.mjs",
  "87-onboarding-age-wheel-320px-fix-visual.mjs",
];

function expectedPaths() {
  return EXPECTED_BASENAMES.map((basename) => "tests/harness/scenarios/" + basename);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^()|[\]\\]/g, "\\$&");
}

function scanSpec(paths: string[]) {
  const excluded = paths.map((candidate) => "!" + candidate);
  const alternation = paths.map((candidate) => escapeRegex(path.basename(candidate, ".mjs"))).join("|");
  const expression = "tests/harness/scenarios/(" + alternation + ")\\.mjs";
  const args = [
    "-n",
    "--hidden",
    "--glob",
    "!tests/fixtures/historical/**",
    "--glob",
    "!.planning/**",
    "--glob",
    "!.git/**",
  ];
  for (const candidate of excluded) {
    args.push("--glob", candidate);
  }
  args.push("-e", expression, ".");
  const globCommand = [
    "--glob '!" + "tests/fixtures/historical/**'",
    "--glob '!.planning/**'",
    "--glob '!.git/**'",
    ...paths.map((candidate) => "--glob '!" + candidate + "'"),
  ].join(" ");
  const command =
    "rg -n --hidden " + globCommand + " -e '" + expression + "' .";
  return { args, command, paths, expression };
}

function runCallerScan(paths: string[]) {
  const spec = scanSpec(paths);
  try {
    const stdout = execFileSync("rg", spec.args, { encoding: "utf8" });
    return { ...spec, stdout, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string | Buffer; status?: number };
    return {
      ...spec,
      stdout: failure.stdout?.toString() ?? "",
      exitCode: failure.status ?? 1,
    };
  }
}

function filteredRows(stdout: string): string[] {
  return [...new Set(stdout.split("\n").filter(Boolean).map((line) => {
    const first = line.indexOf(":");
    const second = line.indexOf(":", first + 1);
    return second < 0
      ? line
      : line.slice(0, first).replace(/^\.\//, "") + ":" + line.slice(first + 1, second);
  }))].sort();
}

function sha256Utf8(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function parseCallerEvidence(evidence: string) {
  const lines = evidence.split("\n");
  const commandIndex = lines.indexOf("command:");
  const command = lines[commandIndex + 1];
  const excludedStart = lines.indexOf("excludedCandidatePaths:") + 1;
  const excluded: string[] = [];
  for (let index = excludedStart; index < lines.length && lines[index] !== ""; index += 1) {
    excluded.push(lines[index].replace(/^- /, ""));
  }
  const rowsStart = lines.indexOf("filteredExternalCallerRows:") + 1;
  const rows: string[] = [];
  for (let index = rowsStart; index < lines.length && lines[index] !== ""; index += 1) {
    rows.push(lines[index].replace(/^- /, ""));
  }
  const value = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
  return {
    command,
    excluded,
    rows,
    sourcePresentBeforeDelete: value("sourcePresentBeforeDelete: "),
    result: value("result: "),
    exitCode: value("exitCode: "),
    filteredResultSha256: value("filteredResultSha256: "),
    filteredResultByteLength: value("filteredResultByteLength: "),
  };
}

function manifestShape(manifest: any) {
  assert.equal(manifest.rows.length, 7, "manifest must contain exactly seven rows");
  assert.deepEqual(
    manifest.rows.map((row: any) => row.originalPath),
    expectedPaths(),
    "manifest original paths must match the exact seven candidates in archive order",
  );
  assert.equal(new Set(manifest.rows.map((row: any) => row.originalPath)).size, 7);
  assert.equal(new Set(manifest.rows.map((row: any) => row.aggregateSection)).size, 7, "aggregate sections must be unique");
  assert.deepEqual(manifest.archiveOrder, manifest.rows.map((row: any) => row.aggregateSection));
  for (const row of manifest.rows) {
    assert.equal(row.activeCallers, 0, row.originalPath + " must have zero active callers");
    assert.equal(row.exactTextProof, "sourceBytesEqualAggregateSection");
    assert.match(row.sourceSha256, /^[0-9a-f]{64}$/);
    assert.equal(row.sourceByteLength, row.snapshotByteLength);
    assert.equal(row.sourceSha256, row.snapshotSha256);
    assert.ok(row.replacementProof);
    assert.ok(row.remainingRisk);
  }
  assert.deepEqual(manifest.retainedActiveScenarios, [RETAINED_110]);
}

function extractSourceSection(aggregate: string, originalPath: string): Buffer {
  const begin = "<!-- BEGIN EXACT SOURCE: " + originalPath + " -->\n";
  const end = "<!-- END EXACT SOURCE: " + originalPath + " -->";
  const start = aggregate.indexOf(begin);
  const finish = aggregate.indexOf(end, start + begin.length);
  assert.notEqual(start, -1, "missing exact-source begin marker for " + originalPath);
  assert.notEqual(finish, -1, "missing exact-source end marker for " + originalPath);
  return Buffer.from(aggregate.slice(start + begin.length, finish), "utf8");
}

function archiveRowsMatch(manifest: any, aggregate: string) {
  const beginCount = (aggregate.match(/BEGIN EXACT SOURCE:/g) ?? []).length;
  const endCount = (aggregate.match(/END EXACT SOURCE:/g) ?? []).length;
  assert.equal(beginCount, 7, "aggregate must contain exactly seven begin markers");
  assert.equal(endCount, 7, "aggregate must contain exactly seven end markers");
  assert.ok(AGGREGATE_PATH.endsWith(".mjs.md"), "archive must have a non-runnable .mjs.md suffix");
  for (const row of manifest.rows) {
    const bytes = extractSourceSection(aggregate, row.originalPath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(bytes.byteLength, row.sourceByteLength, "source byte length mismatch for " + row.originalPath);
    assert.equal(hash, row.sourceSha256, "source hash mismatch for " + row.originalPath);
  }
}

function callerEvidenceMatches(evidence: string, manifest: any) {
  const paths = manifest.rows.map((row: any) => row.originalPath);
  const recorded = parseCallerEvidence(evidence);
  const rerun = runCallerScan(paths);
  assert.equal(recorded.command, rerun.command, "caller evidence command must be deterministic and exact");
  assert.deepEqual(recorded.excluded, paths, "caller evidence must list all seven exact exclusions");
  assert.equal(recorded.sourcePresentBeforeDelete, "true");
  assert.deepEqual(recorded.rows, ["(none)"]);
  assert.equal(recorded.result, "zero external callers");
  assert.equal(recorded.exitCode, String(rerun.exitCode));
  assert.equal(rerun.exitCode, 1, "zero-match rg exit code must be recorded");
  const rows = filteredRows(rerun.stdout);
  assert.deepEqual(rows, []);
  const payload = rows.join("\n");
  assert.equal(recorded.filteredResultSha256, sha256Utf8(payload));
  assert.equal(recorded.filteredResultByteLength, String(Buffer.byteLength(payload, "utf8")));
}

function sourceFilesAbsent(paths: string[], simulatedPresent = new Set<string>()) {
  for (const originalPath of paths) {
    assert.equal(
      simulatedPresent.has(originalPath) || existsSync(originalPath),
      false,
      "removed source remains: " + originalPath,
    );
  }
  assert.equal(existsSync(RETAINED_110), true, "retained 110 scenario must remain callable");
}

function metadataOnly(readme: string, manifestText: string) {
  const metadata = readme + "\n" + manifestText;
  assert.doesNotMatch(metadata, /(?:visual|screenshot)\s+(?:approval|approved|pass(?:ed)?|green|verified)/i);
  assert.doesNotMatch(metadata, /signed\s+(?:provenance|receipt|attestation|proof)/i);
  assert.doesNotMatch(metadata, /(?:browser|public[- ](?:origin|domain))\s+(?:smoke|verification|run|result)\s+(?:passed|executed|approved|complete|green)/i);
  assert.doesNotMatch(metadata, /data:image\/[a-z0-9.+-]+;base64/i);
  assert.doesNotMatch(metadata, /\b(?:OPENAI_API_KEY|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)/i);
  assert.doesNotMatch(metadata, /(?:cookie|token|prompt|provider payload|database dump)\s*[:=]\s*\S+/i);
  assert.doesNotMatch(metadata, /(?:\/Users\/|\/home\/|[A-Z]:\\)/i);
}

function normalizedManifest(text: string) {
  const manifest = JSON.parse(text);
  return JSON.stringify({
    archiveStatus: manifest.archiveStatus,
    archiveFile: manifest.archiveFile,
    callerEvidenceFile: manifest.callerEvidenceFile,
    archiveOrder: manifest.archiveOrder,
    retainedActiveScenarios: manifest.retainedActiveScenarios,
    rows: manifest.rows,
  });
}

describe("Phase 129 OBS-01 historical UI visual archive contract", () => {
  test("manifest has the exact seven sources, unique sections, zero callers, and replacement metadata", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    manifestShape(manifest);
  });

  test("caller evidence matches the exact source-excluding command and reruns to zero callers", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const evidence = readFileSync(EVIDENCE_PATH, "utf8");
    callerEvidenceMatches(evidence, manifest);
  });

  test("removed sources are absent while active 110 remains", () => {
    sourceFilesAbsent(expectedPaths());
  });

  test("aggregate sections preserve exact source bytes and remain non-runnable", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    archiveRowsMatch(manifest, readFileSync(AGGREGATE_PATH, "utf8"));
  });

  test("README and manifest keep archive evidence metadata-only without false proof", () => {
    const readme = readFileSync(README_PATH, "utf8");
    const manifestText = readFileSync(MANIFEST_PATH, "utf8");
    assert.match(readme, /archiveStatus:\s*historical-non-runnable/);
    assert.match(readme, /evidenceMode:\s*metadata-only/);
    assert.match(readme, /retainedActiveScenario:.*110-home-nutrition-animation-visual/);
    assert.match(readme, /visualReview:\s*human-only-not-recorded/);
    assert.match(readme, /browserRun:\s*not-executed/);
    assert.match(readme, /publicOriginSmoke:\s*not-executed/);
    metadataOnly(readme, manifestText);
  });

  test("normalizing the manifest twice is idempotent and preserves archive order", () => {
    const first = readFileSync(MANIFEST_PATH, "utf8");
    const second = readFileSync(MANIFEST_PATH, "utf8");
    assert.equal(normalizedManifest(first), normalizedManifest(second));
    const manifest = JSON.parse(first);
    assert.deepEqual(manifest.archiveOrder, [
      "section-01",
      "section-02",
      "section-03",
      "section-04",
      "section-05",
      "section-06",
      "section-07",
    ]);
  });

  test("mutation negative controls fail closed for duplicate sections, hash drift, caller drift, source remnants, and false claims", () => {
    const manifestText = readFileSync(MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(manifestText);
    const aggregate = readFileSync(AGGREGATE_PATH, "utf8");
    const evidence = readFileSync(EVIDENCE_PATH, "utf8");
    const readme = readFileSync(README_PATH, "utf8");

    const duplicateSection = structuredClone(manifest);
    duplicateSection.rows[1].aggregateSection = duplicateSection.rows[0].aggregateSection;
    assert.throws(() => manifestShape(duplicateSection), /aggregate sections must be unique/);

    const hashDrift = structuredClone(manifest);
    hashDrift.rows[0].sourceSha256 = "0".repeat(64);
    assert.throws(() => archiveRowsMatch(hashDrift, aggregate), /source hash mismatch/);

    const callerDrift = evidence.replace("filteredResultByteLength: 0", "filteredResultByteLength: 1");
    assert.throws(() => callerEvidenceMatches(callerDrift, manifest), /strictly equal|1.*0/);

    assert.throws(
      () => sourceFilesAbsent([expectedPaths()[0]], new Set([expectedPaths()[0]])),
      /removed source remains/,
    );

    assert.throws(
      () => metadataOnly(readme + "\nvisual approval: passed\n", manifestText),
      /visual approval/,
    );
  });
});
