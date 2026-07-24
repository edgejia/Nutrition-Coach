import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  assertDeferredReadinessInvariant,
  assertDeferredReadinessMutationNegativeControl,
} from "./phase129-phase128-readiness-replacement-contract.test.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARCHIVE_DIR = "tests/fixtures/historical/phase-128";
const MANIFEST_PATH = path.join(REPO_ROOT, ARCHIVE_DIR, "manifest.json");
const EVIDENCE_PATH = path.join(REPO_ROOT, ARCHIVE_DIR, "caller-evidence.txt");
const README_PATH = path.join(REPO_ROOT, ARCHIVE_DIR, "README.md");
const CANONICAL_INVENTORY_LINK = "../../../docs/workflow/gsd-workflow-inventory.md";
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
  String.raw`tests/integration/\*\.test\.ts|yarn test|yarn release:check|runStep\("Full test suite",|scenarios/\$\{name\}\.js`,
  "package.json",
  ".github/workflows/pr-check.yml",
  ".github/workflows/manual-release-diagnostic.yml",
  "scripts/release-check.mjs",
  "tests/harness/run.ts",
];

type ArchiveRow = {
  originalPath: string;
  archivePath: string;
  archiveOrder: number;
  sourceSha256: string;
  sourceByteLength: number;
  snapshotSha256: string;
  snapshotByteLength: number;
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
  canonicalEvidencePayloadSha256: string;
  canonicalEvidencePayloadByteLength: number;
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

function expectedPackageScriptOutput(): string {
  const packageJson = JSON.parse(readRepo("package.json")) as {
    scripts: { test?: string; "test:integration"?: string; "release:check"?: string };
  };
  return JSON.stringify({
    test: packageJson.scripts.test,
    testIntegration: packageJson.scripts["test:integration"],
    releaseCheck: packageJson.scripts["release:check"],
  });
}

function expectedCanonicalEvidencePayload(): string {
  const scan = runBoundedReferenceScan();
  assert.equal(scan.exitCode, 0, "bounded authority scan must find its expected references");
  return [
    "canonicalEvidenceVersion: phase-128-readiness-v1",
    `packageScriptCommand: node -e 'const p=require(\"./package.json\"); process.stdout.write(JSON.stringify({test:p.scripts.test,testIntegration:p.scripts[\"test:integration\"],releaseCheck:p.scripts[\"release:check\"]})+\"\\n\")'`,
    "packageScriptOutput:",
    expectedPackageScriptOutput(),
    `boundedReferenceScanCommand: ${BOUNDED_SCAN_COMMAND}`,
    "boundedReferenceScanExitCode: 0",
    "boundedReferenceScanOutput:",
    scan.output.trimEnd(),
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
    assert.equal(row.sourceByteLength, row.snapshotByteLength);
    assert.ok(row.preRemovalDiscoveryCallers.length > 0);
    assert.ok(row.supersededBy.trim());
    assert.ok(row.replacementProof.trim());
    assert.ok(row.remainingRisk.trim());
    assert.equal(row.archiveStageProof, "archive-before-deletion");
  }
}

function archiveRowsMatch(manifest: ArchiveManifest): void {
  for (const row of manifest.rows) {
    const snapshot = readRepo(row.archivePath);
    const begin = `<!-- BEGIN EXACT SOURCE: ${row.originalPath} -->\n`;
    const end = `<!-- END EXACT SOURCE: ${row.originalPath} -->`;
    const exactSource = Buffer.from(sectionBetween(snapshot, begin, end));
    assert.equal(exactSource.byteLength, row.sourceByteLength, `${row.originalPath} byte length drift`);
    assert.equal(sha256(exactSource), row.sourceSha256, `${row.originalPath} source hash drift`);
    assert.equal(sha256(exactSource), row.snapshotSha256, `${row.originalPath} snapshot hash drift`);
  }
}

function callerEvidenceMatches(manifest: ArchiveManifest, evidence: string): void {
  assert.equal(valueAfter(evidence, "archiveStage: "), "pre-removal");
  assert.equal(valueAfter(evidence, "sourcePresentBeforeDelete: "), "true");
  assert.equal(sectionBetween(evidence, "boundedReferenceScanCommand:\n", "boundedReferenceScanScope:"), `${BOUNDED_SCAN_COMMAND}\n`);
  assert.equal(valueAfter(evidence, "boundedReferenceScanExitCode: "), "0");
  const scan = runBoundedReferenceScan();
  assert.equal(scan.exitCode, 0);
  assert.equal(valueAfter(evidence, "boundedReferenceScanOutputSha256: "), sha256(Buffer.from(scan.output)));
  assert.equal(valueAfter(evidence, "boundedReferenceScanOutputByteLength: "), String(Buffer.byteLength(scan.output)));
  const recordedScanOutput = sectionBetween(evidence, "boundedReferenceScanOutput:\n", "\n\ncanonicalEvidencePayloadBegin");
  assert.equal(canonicalScanOutput(recordedScanOutput), scan.output);
  assert.match(recordedScanOutput, /package\.json:19:.*tests\/integration\/\*\.test\.ts/);
  assert.match(recordedScanOutput, /scripts\/release-check\.mjs:435:.*full_test_suite.*\[\"test\"\]/);
  assert.match(recordedScanOutput, /tests\/harness\/run\.ts:105:.*scenarios\/\$\{name\}\.js/);
  assert.match(recordedScanOutput, /\.github\/workflows\/pr-check\.yml:46:.*yarn release:check/);
  assert.match(recordedScanOutput, /\.github\/workflows\/manual-release-diagnostic\.yml:36:.*yarn release:check/);
  const canonicalPayload = sectionBetween(evidence, "canonicalEvidencePayloadBegin\n", "canonicalEvidencePayloadEnd");
  const expectedPayload = expectedCanonicalEvidencePayload();
  assert.equal(canonicalPayload, expectedPayload);
  assert.equal(sha256(Buffer.from(canonicalPayload)), manifest.canonicalEvidencePayloadSha256);
  assert.equal(Buffer.byteLength(canonicalPayload), manifest.canonicalEvidencePayloadByteLength);
  assert.equal(valueAfter(evidence, "canonicalEvidencePayloadSha256: "), sha256(Buffer.from(canonicalPayload)));
  assert.equal(valueAfter(evidence, "canonicalEvidencePayloadByteLength: "), String(Buffer.byteLength(canonicalPayload)));
  const releaseSource = readRepo("scripts/release-check.mjs");
  assert.ok(releaseSource.includes(EXACT_RELEASE_CHECK_ROW), "release-check source row must remain canonical evidence");
  assert.match(canonicalPayload, new RegExp(EXACT_RELEASE_CHECK_ROW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(valueAfter(evidence, "readinessDiscoveryClassification: "), /live package-glob.*release-check\/CI/);
  assert.match(valueAfter(evidence, "artifactScenarioDiscoveryCallers: "), /dynamic import .*no static invocation/);
  assert.match(valueAfter(evidence, "postRemovalActiveCallers: "), /^pending-until-task-2$/);
  assert.deepEqual(manifest.rows.map((row) => row.callerEvidenceRef), [
    "caller-evidence.txt#canonicalEvidencePayload",
    "caller-evidence.txt#canonicalEvidencePayload",
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
    canonicalEvidencePayloadSha256: manifest.canonicalEvidencePayloadSha256,
    canonicalEvidencePayloadByteLength: manifest.canonicalEvidencePayloadByteLength,
    rows: manifest.rows,
  });
}

describe("Phase 129 WFR-07 Phase 128 archive contract", () => {
  test("manifest has exact rows, final zero callers, and replacement proof", () => {
    manifestShape(readManifest());
  });

  test("caller evidence proves live pre-removal discovery and canonical release row", () => {
    const manifest = readManifest();
    callerEvidenceMatches(manifest, readFileSync(EVIDENCE_PATH, "utf8"));
  });

  test("snapshots preserve exact source bytes and remain non-runnable", () => {
    archiveRowsMatch(readManifest());
  });

  test("replacement invariant and mutation negative control execute independently", () => {
    assertDeferredReadinessInvariant();
    assertDeferredReadinessMutationNegativeControl();
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
    assert.equal(normalizedManifest(manifestText), normalizedManifest(manifestText));
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
    const evidence = readFileSync(EVIDENCE_PATH, "utf8");
    assert.throws(() => callerEvidenceMatches(manifest, evidence.replace(/canonicalEvidencePayloadByteLength: 2500/, "canonicalEvidencePayloadByteLength: 1")), /2500|byte/i);
    assert.throws(() => assertSourcesRemoved(new Set([EXPECTED_ROWS[0].originalPath])), /removed source remains/);
    const readme = readFileSync(README_PATH, "utf8");
    assert.throws(() => metadataOnly(readme.replace(CANONICAL_INVENTORY_LINK, "missing-inventory.md"), readFileSync(MANIFEST_PATH, "utf8")), /Canonical workflow inventory/);
    assert.throws(() => metadataOnly(readme + "\nsigned provenance: true\n", readFileSync(MANIFEST_PATH, "utf8")), /signed/);
  });
});
