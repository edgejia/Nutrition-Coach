import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { writeScenarioArtifacts } from "../harness/artifacts.js";
import type { ScenarioMetadata, ScenarioResult } from "../harness/scenario-types.js";

const SENTINEL = "phase128-raw-sentinel-value";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase-128-artifacts-"));
}

function safeMetadata(): ScenarioMetadata {
  return {
    scenarioId: "phase-128-artifact-integrity",
    scenarioName: "phase-128-artifact-integrity",
    status: "pass",
    startedAt: "2026-07-19T14:00:00.000Z",
    finishedAt: "2026-07-19T14:00:00.125Z",
    durationMs: 125,
    counts: { steps: 2, passed: 2, traces: 2 },
    assertions: {
      closed: true,
      exactCardinality: true,
      observedReads: 4,
    },
    files: [
      {
        path: "latest/summary.json",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        byteLength: 128,
      },
    ],
    trace: {
      eventNames: ["status", "chunk", "done"],
      counts: { status: 1, chunk: 1, done: 1 },
    },
  };
}

function result(metadata: ScenarioMetadata): ScenarioResult {
  return {
    ok: metadata.status === "pass",
    steps: [
      { name: "bootstrap", ok: true },
      { name: "verify_metadata", ok: metadata.status === "pass" },
    ],
    artifacts: {},
    metadata,
    consoleSummary: "PASS phase-128-artifact-integrity 2/2",
  };
}

function latest(root: string, scenarioName: string): string {
  return path.join(root, scenarioName, "latest");
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  delete process.env.HARNESS_ARTIFACTS_DIR;
});

describe("Phase 128 artifact integrity negative controls", () => {
  test("persists only the positive metadata schema on a passing run", async () => {
    const root = tempRoot();
    roots.push(root);
    process.env.HARNESS_ARTIFACTS_DIR = root;

    await writeScenarioArtifacts("phase-128-artifact-integrity", result(safeMetadata()));

    const output = latest(root, "phase-128-artifact-integrity");
    const summary = JSON.parse(fs.readFileSync(path.join(output, "summary.json"), "utf8")) as Record<string, unknown>;
    const snapshots = JSON.parse(fs.readFileSync(path.join(output, "snapshots.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(summary).sort(), [
      "counts",
      "durationMs",
      "finishedAt",
      "scenarioId",
      "scenarioName",
      "startedAt",
      "status",
    ]);
    assert.equal(summary.status, "pass");
    assert.deepEqual(snapshots.trace, safeMetadata().trace);
    assert.doesNotMatch(
      fs.readFileSync(path.join(output, "scenario-result.json"), "utf8"),
      /rawSSE|transcript|events\.data|Reply|providerPayload|phase128-raw-sentinel-value/,
    );
  });

  test("rejects nested aliases, case variants, events[].data, and raw SSE/transcript values", async () => {
    const cases: Array<{ name: string; mutate: (metadata: ScenarioMetadata) => void }> = [
      {
        name: "nested-alias",
        mutate: (metadata) => {
          (metadata.assertions as Record<string, unknown>).Reply = SENTINEL;
        },
      },
      {
        name: "case-variant",
        mutate: (metadata) => {
          (metadata.assertions as Record<string, unknown>).STATUS = SENTINEL;
        },
      },
      {
        name: "event-data",
        mutate: (metadata) => {
          (metadata.trace as unknown as Record<string, unknown>).events = [{ data: SENTINEL }];
        },
      },
      {
        name: "raw-transcript",
        mutate: (metadata) => {
          (metadata.trace as unknown as Record<string, unknown>).rawSSE = `event: chunk\ndata: ${SENTINEL}`;
        },
      },
    ];

    for (const current of cases) {
      const root = tempRoot();
      roots.push(root);
      process.env.HARNESS_ARTIFACTS_DIR = root;
      const metadata = safeMetadata();
      current.mutate(metadata);

      await assert.rejects(
        writeScenarioArtifacts(`phase-128-artifact-integrity-${current.name}`, result(metadata)),
        (error: unknown) => {
          assert.equal((error as { category?: string }).category, "artifact_allowlist_violation");
          assert.match((error as { fieldPath?: string }).fieldPath ?? "", /^metadata\./);
          assert.equal("value" in (error as object), false);
          return true;
        },
      );

      const output = latest(root, `phase-128-artifact-integrity-${current.name}`);
      const files = fs.readdirSync(output);
      const raw = files.map((file) => fs.readFileSync(path.join(output, file), "utf8")).join("\n");
      const envelopes = files
        .filter((file) => file === "failure.json")
        .map((file) => JSON.parse(fs.readFileSync(path.join(output, file), "utf8")) as Record<string, unknown>);
      assert.equal(envelopes.length, 1);
      assert.deepEqual(Object.keys(envelopes[0]!).sort(), ["category", "fieldPath", "scenarioId"]);
      assert.equal(envelopes[0]!.category, "artifact_allowlist_violation");
      assert.doesNotMatch(raw, new RegExp(SENTINEL));
    }
  });

  test("uses the same metadata-only schema for an allowed failure result", async () => {
    const root = tempRoot();
    roots.push(root);
    process.env.HARNESS_ARTIFACTS_DIR = root;
    const metadata = safeMetadata();
    metadata.status = "fail";
    metadata.errorCategory = "assertion_failed";

    await writeScenarioArtifacts("phase-128-artifact-failure", result(metadata));

    const output = latest(root, "phase-128-artifact-failure");
    const summary = JSON.parse(fs.readFileSync(path.join(output, "summary.json"), "utf8")) as Record<string, unknown>;
    assert.equal(summary.status, "fail");
    assert.equal((summary.errorCategory as string | undefined), "assertion_failed");
    assert.equal(fs.existsSync(path.join(output, "failure.json")), false);
  });

  test("rejects legacy results without positive metadata instead of redacting arbitrary evidence", async () => {
    const root = tempRoot();
    roots.push(root);
    process.env.HARNESS_ARTIFACTS_DIR = root;

    const legacyResult = {
      ok: true,
      steps: [{ name: "legacy", ok: true, actual: SENTINEL }],
      artifacts: { nested: { rawTranscript: SENTINEL } },
      consoleSummary: "PASS phase-128-legacy 1/1",
    } as ScenarioResult;

    await assert.rejects(
      writeScenarioArtifacts("phase-128-legacy", legacyResult),
      (error: unknown) => {
        assert.equal((error as { category?: string }).category, "artifact_allowlist_violation");
        assert.equal("value" in (error as object), false);
        return true;
      },
    );

    const output = latest(root, "phase-128-legacy");
    const raw = fs.readdirSync(output)
      .map((file) => fs.readFileSync(path.join(output, file), "utf8"))
      .join("\n");
    assert.doesNotMatch(raw, new RegExp(SENTINEL));
  });
});
