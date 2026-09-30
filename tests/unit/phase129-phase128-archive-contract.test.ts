import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARCHIVE_DIR = "tests/fixtures/historical/phase-128";
const MANIFEST_PATH = path.join(REPO_ROOT, ARCHIVE_DIR, "manifest.json");
const EVIDENCE_PATH = path.join(REPO_ROOT, ARCHIVE_DIR, "caller-evidence.txt");
const README_PATH = path.join(REPO_ROOT, ARCHIVE_DIR, "README.md");
const CANONICAL_INVENTORY_LINK = "../../../docs/workflow/gsd-workflow-inventory.md";
const REPLACEMENT_CONTRACT_URL = new URL("./phase129-phase128-readiness-replacement-contract.test.ts", import.meta.url);
const EXPECTED_ROWS = [
  {
    originalPath: "tests/integration/phase-128-readiness-audit-negative-controls.test.ts",
    archivePath: "tests/fixtures/historical/phase-128/phase-128-readiness-audit-negative-controls.test.md",
  },
  {
    originalPath: "tests/harness/scenarios/phase-128-artifact-integrity.ts",
    archivePath: "tests/fixtures/historical/phase-128/phase-128-artifact-integrity.ts.md",
  },
] as const;
const EXACT_RELEASE_CHECK_ROW = 'runStep("Full test suite", "full_test_suite", ["test"]';
const REFERENCE_SCAN_PATTERN = String.raw`tests/integration/\*\.test\.ts|yarn test|yarn release:check|runStep\("Full test suite",|scenarios/\$\{name\}\.js`;
const BOUNDED_SCAN_COMMAND = String.raw`rg -n --hidden --glob '!.planning/**' --glob '!.git/**' --glob '!tests/fixtures/historical/**' --glob '!tests/integration/phase-128-readiness-audit-negative-controls.test.ts' --glob '!tests/harness/scenarios/phase-128-artifact-integrity.ts' -e 'tests/integration/\*\.test\.ts|yarn test|yarn release:check|runStep\("Full test suite",|scenarios/\$\{name\}\.js' package.json .github/workflows/pr-check.yml .github/workflows/manual-release-diagnostic.yml scripts/release-check.mjs tests/harness/run.ts`;
const BOUNDED_SCAN_ARGS = [
  "-n",
  "--hidden",
  "--glob",
  "!.planning/**",
  "--glob",
  "!.git/**",
  "--glob",
  "!tests/fixtures/historical/**",
  "--glob",
  "!tests/integration/phase-128-readiness-audit-negative-controls.test.ts",
  "--glob",
  "!tests/harness/scenarios/phase-128-artifact-integrity.ts",
  "-e",
  REFERENCE_SCAN_PATTERN,
  "package.json",
  ".github/workflows/pr-check.yml",
  ".github/workflows/manual-release-diagnostic.yml",
  "scripts/release-check.mjs",
  "tests/harness/run.ts",
];
const HEAD_SCAN_PATHS = [
  "package.json",
  ".github/workflows/pr-check.yml",
  ".github/workflows/manual-release-diagnostic.yml",
  "scripts/release-check.mjs",
  "tests/harness/run.ts",
] as const;
const HEAD_SOURCE_COMMAND = HEAD_SCAN_PATHS.map((relativePath) => `git show HEAD:${relativePath}`).join("; ");

type ArchiveRow = {
  originalPath: string;
  archivePath: string;
  archiveOrder: number;
  sourceSha256: string;
  sourceByteLength: number;
  snapshotSha256: string;
  snapshotByteLength: number;
  snapshotFileSha256: string;
  snapshotFileByteLength: number;
  exactTextProof: string;
  callerEvidenceRef: string;
  preRemovalDiscoveryCallers: string[];
  preRemovalDiscoveryClassification: string;
  sourcePresentBeforeDelete: boolean;
  postRemovalActiveCallers: number;
  supersededBy: string;
  replacementProof: string;
  remainingRisk: string;
  archiveStageProof: string;
};

type ArchiveManifest = {
  archiveStatus: string;
  archiveStage: string;
  evidenceMode: string;
  archiveOrder: string[];
  callerEvidenceFile: string;
  canonicalInventory: string;
  observedLocalProvenance: string;
  observedLocalReferenceScanOutputSha256: string;
  observedLocalReferenceScanOutputByteLength: number;
  observedLocalCanonicalEvidencePayloadSha256: string;
  observedLocalCanonicalEvidencePayloadByteLength: number;
  committedHeadProvenance: string;
  committedHeadReferenceScanOutputSha256: string;
  committedHeadReferenceScanOutputByteLength: number;
  committedHeadCanonicalEvidencePayloadSha256: string;
  committedHeadCanonicalEvidencePayloadByteLength: number;
  rows: ArchiveRow[];
};

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readManifest(): ArchiveManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ArchiveManifest;
}

function readRepo(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function valueAfter(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  assert.ok(line, `missing evidence field ${prefix}`);
  return line.slice(prefix.length);
}

function sectionBetween(text: string, begin: string, end: string): string {
  const start = text.indexOf(begin);
  const finish = text.indexOf(end, start + begin.length);
  assert.notEqual(start, -1, `missing section begin ${begin}`);
  assert.notEqual(finish, -1, `missing section end ${end}`);
  return text.slice(start + begin.length, finish);
}

function canonicalScanOutput(output: string): string {
  const rows = output.split("\n").filter(Boolean).sort();
  return rows.length > 0 ? rows.join("\n") + "\n" : "";
}

function runBoundedReferenceScan(): { output: string; exitCode: number } {
  try {
    return {
      output: canonicalScanOutput(execFileSync("rg", BOUNDED_SCAN_ARGS, { cwd: REPO_ROOT, encoding: "utf8" })),
      exitCode: 0,
    };
  } catch (error) {
    const failure = error as { stdout?: string | Buffer; status?: number };
    return { output: canonicalScanOutput(failure.stdout?.toString() ?? ""), exitCode: failure.status ?? 1 };
  }
}

function expectedCanonicalEvidencePayload(packageScriptOutput: string, scanOutput: string): string {
  return [
    "canonicalEvidenceVersion: phase-128-readiness-v1",
    `packageScriptCommand: node -e 'const p=require(\"./package.json\"); process.stdout.write(JSON.stringify({test:p.scripts.test,testIntegration:p.scripts[\"test:integration\"],releaseCheck:p.scripts[\"release:check\"]})+\"\\n\")'`,
    "packageScriptOutput:",
    packageScriptOutput,
    `boundedReferenceScanCommand: ${BOUNDED_SCAN_COMMAND}`,
    "boundedReferenceScanExitCode: 0",
    "boundedReferenceScanOutput:",
    scanOutput.trimEnd(),
    `exactReleaseCheckSourceRow: ${EXACT_RELEASE_CHECK_ROW}`,
    "readinessClassification: live-package-glob-and-release-check-caller",
    "artifactScenarioClassification: dynamic-name-harness-reachability-only-no-static-invocation",
    "ciReachability: pull-request-and-manual-release-workflows-reach-yarn-release-check",
  ].join("\n") + "\n";
}

function manifestShape(manifest: ArchiveManifest): void {
  assert.equal(manifest.archiveStatus, "historical-non-runnable");
  assert.equal(manifest.archiveStage, "deletion-approved");
  assert.equal(manifest.evidenceMode, "metadata-only");
  assert.equal(manifest.observedLocalProvenance, "dirty-worktree-pre-removal-observation");
  assert.equal(manifest.committedHeadProvenance, "git-show-head-clean-clone-equivalent");
  for (const [label, value] of [
    ["observed local scan", manifest.observedLocalReferenceScanOutputSha256],
    ["observed local payload", manifest.observedLocalCanonicalEvidencePayloadSha256],
    ["committed HEAD scan", manifest.committedHeadReferenceScanOutputSha256],
    ["committed HEAD payload", manifest.committedHeadCanonicalEvidencePayloadSha256],
  ] as const) {
    assert.match(value, /^[0-9a-f]{64}$/, `${label} hash shape`);
  }
  for (const [label, value] of [
    ["observed local scan", manifest.observedLocalReferenceScanOutputByteLength],
    ["observed local payload", manifest.observedLocalCanonicalEvidencePayloadByteLength],
    ["committed HEAD scan", manifest.committedHeadReferenceScanOutputByteLength],
    ["committed HEAD payload", manifest.committedHeadCanonicalEvidencePayloadByteLength],
  ] as const) {
    assert.ok(Number.isSafeInteger(value) && value > 0, `${label} byte length shape`);
  }
  assert.notEqual(manifest.observedLocalReferenceScanOutputSha256, manifest.committedHeadReferenceScanOutputSha256, "observed local and committed HEAD scan hashes must remain distinct");
  assert.notEqual(manifest.observedLocalReferenceScanOutputByteLength, manifest.committedHeadReferenceScanOutputByteLength, "observed local and committed HEAD scan lengths must remain distinct");
  assert.deepEqual(manifest.archiveOrder, EXPECTED_ROWS.map((row) => row.archivePath));
  assert.equal(manifest.rows.length, EXPECTED_ROWS.length, "manifest must contain exactly two rows");
  assert.equal(new Set(manifest.rows.map((row) => row.originalPath)).size, EXPECTED_ROWS.length, "original paths must be unique");
  assert.equal(new Set(manifest.rows.map((row) => row.archivePath)).size, EXPECTED_ROWS.length, "archive paths must be unique");
  assert.deepEqual(
    manifest.rows.map((row) => ({ originalPath: row.originalPath, archivePath: row.archivePath })),
    EXPECTED_ROWS,
  );
  for (const [index, row] of manifest.rows.entries()) {
    assert.equal(row.archiveOrder, index + 1);
    assert.match(row.archivePath, /\.(?:md|txt)$/);
    assert.doesNotMatch(row.archivePath, /\.(?:js|mjs|cjs|ts|mts|cts)$/);
    assert.equal(row.sourcePresentBeforeDelete, true);
    assert.equal(row.postRemovalActiveCallers, 0);
    assert.equal(row.exactTextProof, "sourceBytesEqualSnapshotBytes");
    assert.match(row.sourceSha256, /^[0-9a-f]{64}$/);
    assert.match(row.snapshotSha256, /^[0-9a-f]{64}$/);
    assert.match(row.snapshotFileSha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(row.snapshotFileByteLength) && row.snapshotFileByteLength > 0);
    assert.equal(row.sourceByteLength, row.snapshotByteLength);
    assert.ok(row.preRemovalDiscoveryCallers.length > 0);
    assert.ok(row.supersededBy.trim());
    assert.ok(row.replacementProof.trim());
    assert.ok(row.remainingRisk.trim());
    assert.equal(row.archiveStageProof, "archive-before-deletion");
  }
}

function archiveRowsMatch(
  manifest: ArchiveManifest,
  snapshotReader: (relativePath: string) => Buffer = (relativePath) => Buffer.from(readRepo(relativePath), "utf8"),
): void {
  for (const row of manifest.rows) {
    const snapshotBytes = snapshotReader(row.archivePath);
    const snapshot = snapshotBytes.toString("utf8");
    const begin = `<!-- BEGIN EXACT SOURCE: ${row.originalPath} -->\n`;
    const end = `<!-- END EXACT SOURCE: ${row.originalPath} -->`;
    assert.equal(snapshot.split(begin).length - 1, 1, `${row.archivePath} must have one begin marker`);
    assert.equal(snapshot.split(end).length - 1, 1, `${row.archivePath} must have one end marker`);
    assert.equal(snapshotBytes.byteLength, row.snapshotFileByteLength, `${row.archivePath} outer byte length drift`);
    assert.equal(sha256(snapshotBytes), row.snapshotFileSha256, `${row.archivePath} outer snapshot hash drift`);
    const exactSource = Buffer.from(sectionBetween(snapshot, begin, end));
    assert.equal(exactSource.byteLength, row.sourceByteLength, `${row.originalPath} byte length drift`);
    assert.equal(sha256(exactSource), row.sourceSha256, `${row.originalPath} source hash drift`);
    assert.equal(sha256(exactSource), row.snapshotSha256, `${row.originalPath} snapshot hash drift`);
  }
}

function callerEvidenceMatches(manifest: ArchiveManifest, evidence: string): void {
  assert.equal(valueAfter(evidence, "archiveStage: "), "pre-removal");
  assert.equal(valueAfter(evidence, "sourcePresentBeforeDelete: "), "true");
  assert.equal(sectionBetween(evidence, "observedLocalReferenceScanCommand:\n", "observedLocalReferenceScanScope:"), `${BOUNDED_SCAN_COMMAND}\n`);
  assert.equal(valueAfter(evidence, "observedLocalReferenceScanProvenance: "), "dirty-worktree-pre-removal-observation");
  assert.equal(valueAfter(evidence, "observedLocalReferenceScanExitCode: "), "0");
  const observedScanOutput = canonicalScanOutput(sectionBetween(evidence, "observedLocalReferenceScanOutput:\n", "\n\nobservedLocalCanonicalEvidencePayloadBegin"));
  assert.equal(valueAfter(evidence, "observedLocalReferenceScanOutputSha256: "), sha256(Buffer.from(observedScanOutput)), "observed local scan hash mismatch");
  assert.equal(valueAfter(evidence, "observedLocalReferenceScanOutputByteLength: "), String(Buffer.byteLength(observedScanOutput)), "observed local scan byte length mismatch");
  assert.equal(valueAfter(evidence, "observedLocalReferenceScanOutputSha256: "), manifest.observedLocalReferenceScanOutputSha256);
  assert.equal(valueAfter(evidence, "observedLocalReferenceScanOutputByteLength: "), String(manifest.observedLocalReferenceScanOutputByteLength));
  assert.match(observedScanOutput, /package\.json:19:.*tests\/integration\/\*\.test\.ts/);
  assert.match(observedScanOutput, /scripts\/release-check\.mjs:435:.*full_test_suite.*\[\"test\"\]/);
  assert.match(observedScanOutput, /tests\/harness\/run\.ts:105:.*scenarios\/\$\{name\}\.js/);
  assert.match(observedScanOutput, /\.github\/workflows\/pr-check\.yml:46:.*yarn release:check/);
  assert.match(observedScanOutput, /\.github\/workflows\/manual-release-diagnostic\.yml:36:.*yarn release:check/);

  const observedPayload = sectionBetween(evidence, "observedLocalCanonicalEvidencePayloadBegin\n", "observedLocalCanonicalEvidencePayloadEnd");
  const observedPackageOutput = sectionBetween(observedPayload, "packageScriptOutput:\n", "boundedReferenceScanCommand:").trimEnd();
  assert.equal(observedPayload, expectedCanonicalEvidencePayload(observedPackageOutput, observedScanOutput));
  assert.equal(sha256(Buffer.from(observedPayload)), manifest.observedLocalCanonicalEvidencePayloadSha256);
  assert.equal(Buffer.byteLength(observedPayload), manifest.observedLocalCanonicalEvidencePayloadByteLength);
  assert.equal(valueAfter(evidence, "observedLocalCanonicalEvidencePayloadSha256: "), sha256(Buffer.from(observedPayload)));
  assert.equal(valueAfter(evidence, "observedLocalCanonicalEvidencePayloadByteLength: "), String(Buffer.byteLength(observedPayload)));
  assert.equal(valueAfter(evidence, "observedLocalPackageScriptOutputSha256: "), sha256(Buffer.from(observedPackageOutput)));
  assert.equal(valueAfter(evidence, "observedLocalPackageScriptOutputByteLength: "), String(Buffer.byteLength(observedPackageOutput)));
  assert.match(observedPayload, new RegExp(EXACT_RELEASE_CHECK_ROW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.equal(valueAfter(evidence, "committedHeadSourceCommand: "), HEAD_SOURCE_COMMAND);
  // The committed-HEAD payload is a point-in-time record of the pre-retirement tree; verify its internal
  // consistency instead of re-deriving it from the live HEAD, which later workflow slimming legitimately changed.
  const committedScanOutput = sectionBetween(evidence, "committedHeadEvidencePayloadBegin\n", "committedHeadEvidencePayloadEnd");
  const committedPackageOutput = sectionBetween(committedScanOutput, "packageScriptOutput:\n", "boundedReferenceScanCommand:").trimEnd();
  assert.equal(valueAfter(evidence, "committedHeadPackageScriptOutputSha256: "), sha256(Buffer.from(committedPackageOutput)));
  assert.equal(valueAfter(evidence, "committedHeadPackageScriptOutputByteLength: "), String(Buffer.byteLength(committedPackageOutput)));
  const committedScan = { output: canonicalScanOutput(sectionBetween(committedScanOutput, "boundedReferenceScanOutput:\n", "exactReleaseCheckSourceRow:")) };
  assert.equal(valueAfter(evidence, "committedHeadReferenceScanOutputSha256: "), sha256(Buffer.from(committedScan.output)), "committed HEAD scan hash mismatch");
  assert.equal(valueAfter(evidence, "committedHeadReferenceScanOutputByteLength: "), String(Buffer.byteLength(committedScan.output)), "committed HEAD scan byte length mismatch");
  assert.equal(valueAfter(evidence, "committedHeadReferenceScanOutputSha256: "), manifest.committedHeadReferenceScanOutputSha256);
  assert.equal(valueAfter(evidence, "committedHeadReferenceScanOutputByteLength: "), String(manifest.committedHeadReferenceScanOutputByteLength));
  const expectedCommittedPayload = expectedCanonicalEvidencePayload(committedPackageOutput, committedScan.output);
  assert.equal(committedScanOutput, expectedCommittedPayload);
  assert.equal(sha256(Buffer.from(committedScanOutput)), manifest.committedHeadCanonicalEvidencePayloadSha256);
  assert.equal(Buffer.byteLength(committedScanOutput), manifest.committedHeadCanonicalEvidencePayloadByteLength);
  assert.equal(valueAfter(evidence, "committedHeadCanonicalEvidencePayloadSha256: "), sha256(Buffer.from(committedScanOutput)));
  assert.equal(valueAfter(evidence, "committedHeadCanonicalEvidencePayloadByteLength: "), String(Buffer.byteLength(committedScanOutput)));
  assert.notEqual(manifest.observedLocalReferenceScanOutputSha256, manifest.committedHeadReferenceScanOutputSha256, "observed local and committed HEAD scan hashes must remain distinct");
  assert.notEqual(manifest.observedLocalReferenceScanOutputByteLength, manifest.committedHeadReferenceScanOutputByteLength, "observed local and committed HEAD scan lengths must remain distinct");

  assert.match(valueAfter(evidence, "readinessDiscoveryClassification: "), /live package-glob.*release-check\/CI/);
  assert.match(valueAfter(evidence, "artifactScenarioDiscoveryCallers: "), /dynamic import .*no static invocation/);
  assert.match(valueAfter(evidence, "postRemovalActiveCallers: "), /^pending-until-task-2$/);
  assert.deepEqual(manifest.rows.map((row) => row.callerEvidenceRef), [
    "caller-evidence.txt#observedLocalCanonicalEvidencePayload",
    "caller-evidence.txt#observedLocalCanonicalEvidencePayload",
  ]);
}

function assertSourcesRemoved(simulatedPresent = new Set<string>()): void {
  for (const row of EXPECTED_ROWS) {
    assert.equal(simulatedPresent.has(row.originalPath) || existsSync(path.join(REPO_ROOT, row.originalPath)), false, `removed source remains: ${row.originalPath}`);
  }
  const integrationFiles = readdirSync(path.join(REPO_ROOT, "tests/integration"));
  assert.equal(integrationFiles.includes("phase-128-readiness-audit-negative-controls.test.ts"), false);
  const harnessLoader = readRepo("tests/harness/run.ts");
  assert.match(harnessLoader, /import\(`\.\/scenarios\/\$\{name\}\.js`\)/);
  assert.doesNotMatch(harnessLoader, /phase-128-artifact-integrity/);
  const scan = runBoundedReferenceScan();
  assert.doesNotMatch(scan.output, /phase-128-readiness-audit-negative-controls\.test\.ts/);
  assert.doesNotMatch(scan.output, /phase-128-artifact-integrity\.ts/);
}

function metadataOnly(readme: string, manifestText: string): void {
  assert.match(readme, new RegExp(`\\[Canonical workflow inventory\\]\\(${CANONICAL_INVENTORY_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
  assert.match(readme, /archiveStatus: historical-non-runnable/);
  assert.match(readme, /archiveStage: deletion-approved/);
  assert.doesNotMatch(readme + manifestText, /signed\s+(?:provenance|receipt|attestation|proof)/i);
  assert.doesNotMatch(readme + manifestText, /data:image\/[a-z0-9.+-]+;base64/i);
  assert.doesNotMatch(readme + manifestText, /\b(?:OPENAI_API_KEY|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)/i);
  assert.doesNotMatch(readme + manifestText, /(?:cookie|token|prompt|provider payload|database dump)\s*[:=]\s*\S+/i);
  assert.doesNotMatch(readme + manifestText, /(?:\/Users\/|\/home\/|[A-Z]:\\)/i);
}

function normalizedManifest(text: string): string {
  const manifest = JSON.parse(text) as ArchiveManifest;
  return JSON.stringify({
    archiveStatus: manifest.archiveStatus,
    archiveStage: manifest.archiveStage,
    archiveOrder: manifest.archiveOrder,
    callerEvidenceFile: manifest.callerEvidenceFile,
    observedLocalProvenance: manifest.observedLocalProvenance,
    observedLocalReferenceScanOutputSha256: manifest.observedLocalReferenceScanOutputSha256,
    observedLocalReferenceScanOutputByteLength: manifest.observedLocalReferenceScanOutputByteLength,
    observedLocalCanonicalEvidencePayloadSha256: manifest.observedLocalCanonicalEvidencePayloadSha256,
    observedLocalCanonicalEvidencePayloadByteLength: manifest.observedLocalCanonicalEvidencePayloadByteLength,
    committedHeadProvenance: manifest.committedHeadProvenance,
    committedHeadReferenceScanOutputSha256: manifest.committedHeadReferenceScanOutputSha256,
    committedHeadReferenceScanOutputByteLength: manifest.committedHeadReferenceScanOutputByteLength,
    committedHeadCanonicalEvidencePayloadSha256: manifest.committedHeadCanonicalEvidencePayloadSha256,
    committedHeadCanonicalEvidencePayloadByteLength: manifest.committedHeadCanonicalEvidencePayloadByteLength,
    rows: manifest.rows,
  });
}

describe("Phase 129 WFR-07 Phase 128 archive contract", () => {
  test("manifest has exact rows, final zero callers, and replacement proof", () => {
    manifestShape(readManifest());
  });

  test("caller evidence separates observed-local history from committed HEAD proof", () => {
    const manifest = readManifest();
    callerEvidenceMatches(manifest, readFileSync(EVIDENCE_PATH, "utf8"));
  });

  test("snapshots preserve exact source bytes and remain non-runnable", () => {
    archiveRowsMatch(readManifest());
  });

  test("replacement invariant and mutation negative control execute independently", async () => {
    const replacement = await import(REPLACEMENT_CONTRACT_URL.href) as typeof import("./phase129-phase128-readiness-replacement-contract.test.js");
    replacement.assertDeferredReadinessInvariant();
    replacement.assertDeferredReadinessMutationNegativeControl();
  });

  test("original runnable paths and active package/harness references are absent", () => {
    assertSourcesRemoved();
  });

  test("README and manifest stay metadata-only and link to canonical inventory", () => {
    metadataOnly(readFileSync(README_PATH, "utf8"), readFileSync(MANIFEST_PATH, "utf8"));
  });

  test("archive normalization is idempotent and source evidence precedes deletion", () => {
    const manifestText = readFileSync(MANIFEST_PATH, "utf8");
    const manifest = readManifest();
    const canonicalOnce = normalizedManifest(manifestText);
    const canonicalTwice = normalizedManifest(canonicalOnce);
    assert.equal(canonicalTwice, canonicalOnce);
    assert.deepEqual(manifest.archiveOrder, manifest.rows.map((row) => row.archivePath));
    assert.ok(manifest.rows.every((row) => row.archiveStageProof === "archive-before-deletion"));
    assert.equal(valueAfter(readFileSync(EVIDENCE_PATH, "utf8"), "sourcePresentBeforeDelete: "), "true");
  });

  test("mutation negative controls fail closed for archive, evidence, source, and privacy drift", () => {
    const manifest = readManifest();
    const duplicate = structuredClone(manifest);
    duplicate.rows[1].archivePath = duplicate.rows[0].archivePath;
    assert.throws(() => manifestShape(duplicate), /unique|exact rows/);
    const lateStage = structuredClone(manifest);
    lateStage.archiveStage = "pre-removal";
    assert.throws(() => manifestShape(lateStage), /deletion-approved/);
    const missingProof = structuredClone(manifest);
    missingProof.rows[0].replacementProof = "";
    assert.throws(() => manifestShape(missingProof), /replacementProof/);
    const hashDrift = structuredClone(manifest);
    hashDrift.rows[0].sourceSha256 = "0".repeat(64);
    assert.throws(() => archiveRowsMatch(hashDrift), /hash drift/);
    const outerHashDrift = structuredClone(manifest);
    outerHashDrift.rows[0].snapshotFileSha256 = "0".repeat(64);
    assert.throws(() => archiveRowsMatch(outerHashDrift), /outer snapshot hash drift/);
    const duplicateMarker = readFileSync(path.join(REPO_ROOT, manifest.rows[0].archivePath), "utf8");
    const duplicateBegin = `<!-- BEGIN EXACT SOURCE: ${manifest.rows[0].originalPath} -->\n`;
    const duplicateSnapshot = duplicateMarker.replace(duplicateBegin, duplicateBegin + duplicateBegin);
    assert.throws(
      () => archiveRowsMatch(manifest, (relativePath) => Buffer.from(relativePath === manifest.rows[0].archivePath ? duplicateSnapshot : readRepo(relativePath), "utf8")),
      /must have one begin marker/,
    );
    const missingEndSnapshot = duplicateMarker.replace(`<!-- END EXACT SOURCE: ${manifest.rows[0].originalPath} -->`, "");
    assert.throws(
      () => archiveRowsMatch(manifest, (relativePath) => Buffer.from(relativePath === manifest.rows[0].archivePath ? missingEndSnapshot : readRepo(relativePath), "utf8")),
      /outer byte length drift|outer snapshot hash drift|must have one end marker/,
    );
    const evidence = readFileSync(EVIDENCE_PATH, "utf8");
    assert.throws(
      () => callerEvidenceMatches(manifest, evidence.replace(/observedLocalReferenceScanOutputSha256: [0-9a-f]+/, `observedLocalReferenceScanOutputSha256: ${"0".repeat(64)}`)),
      /hash|observed local/i,
    );
    assert.throws(
      () => callerEvidenceMatches(manifest, evidence.replace(/committedHeadReferenceScanOutputByteLength: 992/, "committedHeadReferenceScanOutputByteLength: 1")),
      /byte|committed HEAD/i,
    );
    const confusedManifest = structuredClone(manifest);
    confusedManifest.observedLocalReferenceScanOutputSha256 = manifest.committedHeadReferenceScanOutputSha256;
    assert.throws(() => manifestShape(confusedManifest), /distinct/);
    assert.throws(() => assertSourcesRemoved(new Set([EXPECTED_ROWS[0].originalPath])), /removed source remains/);
    const readme = readFileSync(README_PATH, "utf8");
    assert.throws(() => metadataOnly(readme.replace(CANONICAL_INVENTORY_LINK, "missing-inventory.md"), readFileSync(MANIFEST_PATH, "utf8")), /Canonical workflow inventory/);
    assert.throws(() => metadataOnly(readme + "\nsigned provenance: true\n", readFileSync(MANIFEST_PATH, "utf8")), /signed/);
  });
});
