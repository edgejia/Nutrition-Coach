import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { readPublishedArtifact, writeScenarioArtifacts } from "../harness/artifacts.js";
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

  test("rejects sensitive metadata keys, UUID-like identifiers, and asset paths without leaking values", async () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const uuidV7 = "01890f47-42e7-7b5d-b1bd-6f062e6c7c8c";
    const uuidLike = "deadbeef-cafe-f00d-0123-0123456789ab";
    const rawProposalIdentifier = "proposal-sensitive-identifier";
    const cases: Array<{
      name: string;
      expectedPath: string;
      sensitiveValue?: string;
      mutate: (metadata: ScenarioMetadata) => void;
    }> = [
      {
        name: "count-meal-id",
        expectedPath: "metadata.counts.mealId",
        mutate: (metadata) => {
          (metadata.counts as Record<string, number>).mealId = 1;
        },
      },
      {
        name: "assertion-food-name",
        expectedPath: "metadata.assertions.foodName",
        mutate: (metadata) => {
          (metadata.assertions as Record<string, boolean>).foodName = true;
        },
      },
      {
        name: "uuid-v7-scenario-id",
        expectedPath: "metadata.scenarioId",
        sensitiveValue: uuidV7,
        mutate: (metadata) => {
          metadata.scenarioId = uuidV7;
        },
      },
      {
        name: "uuid-like-scenario-name",
        expectedPath: "metadata.scenarioName",
        sensitiveValue: uuidLike,
        mutate: (metadata) => {
          metadata.scenarioName = uuidLike;
        },
      },
      {
        name: "uuid-rule-id",
        expectedPath: "metadata.policyFacts[0].ruleId",
        sensitiveValue: uuidV7,
        mutate: (metadata) => {
          metadata.policyFacts = [{
            step: "verify_policy",
            tool: "safe_tool",
            policyClass: "confirm-first",
            decision: "blocked",
            ruleId: uuidV7,
          }];
        },
      },
      {
        name: "raw-proposal-identifier",
        expectedPath: "metadata.policyFacts[0].proposalId",
        sensitiveValue: rawProposalIdentifier,
        mutate: (metadata) => {
          metadata.policyFacts = [{
            step: "verify_policy",
            tool: "safe_tool",
            policyClass: "confirm-first",
            decision: "blocked",
            ruleId: "confirm_required",
          }];
          (metadata.policyFacts[0] as unknown as Record<string, unknown>).proposalId = rawProposalIdentifier;
        },
      },
      {
        name: "uuid-asset-path",
        expectedPath: "metadata.files[0].path",
        sensitiveValue: uuidV7,
        mutate: (metadata) => {
          metadata.files = [{
            path: `api/assets/${uuidV7}`,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            byteLength: 128,
          }];
        },
      },
    ];

    for (const current of cases) {
      const root = tempRoot();
      roots.push(root);
      process.env.HARNESS_ARTIFACTS_DIR = root;
      const metadata = safeMetadata();
      current.mutate(metadata);
      const sensitiveValue = current.sensitiveValue ?? uuid;

      await assert.rejects(
        writeScenarioArtifacts(`phase-128-private-${current.name}`, result(metadata)),
        (error: unknown) => {
          const bounded = error as { category?: string; fieldPath?: string; value?: unknown };
          assert.equal(bounded.category, "artifact_allowlist_violation");
          assert.equal(bounded.fieldPath, current.expectedPath);
          assert.equal("value" in bounded, false);
          assert.doesNotMatch(String((error as Error).message), new RegExp(sensitiveValue, "i"));
          return true;
        },
      );

      const failure = fs.readFileSync(
        path.join(latest(root, `phase-128-private-${current.name}`), "failure.json"),
        "utf8",
      );
      assert.doesNotMatch(failure, new RegExp(sensitiveValue, "i"));
    }
  });

  test("rejects a pre-existing scenario-root symlink before writing outside the artifact root", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    roots.push(root, outside);
    process.env.HARNESS_ARTIFACTS_DIR = root;
    const scenarioName = "phase-128-scenario-root-escape";
    fs.symlinkSync(outside, path.join(root, scenarioName), "dir");

    await assert.rejects(
      writeScenarioArtifacts(scenarioName, result(safeMetadata())),
      (error: unknown) => {
        assert.match((error as Error).message, /artifact path/i);
        assert.equal((error as Error).message.includes(outside), false);
        return true;
      },
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test("rejects latest pointers outside or not directly under the scenario root", () => {
    const root = tempRoot();
    const outside = tempRoot();
    roots.push(root, outside);
    process.env.HARNESS_ARTIFACTS_DIR = root;

    for (const location of ["outside", "nested"] as const) {
      const scenarioName = `phase-128-pointer-${location}`;
      const scenarioRoot = path.join(root, scenarioName);
      const generationId = location === "outside"
        ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const generation = location === "outside"
        ? path.join(outside, `generation-${generationId}`)
        : path.join(scenarioRoot, "nested", `generation-${generationId}`);
      fs.mkdirSync(generation, { recursive: true });
      const summary = JSON.stringify({ scenarioId: "safe-scenario", status: "pass" });
      fs.writeFileSync(path.join(generation, "summary.json"), summary, "utf8");
      fs.writeFileSync(path.join(generation, "index.json"), JSON.stringify({
        schemaVersion: 1,
        generation: generationId,
        files: {
          "summary.json": {
            sha256: createHash("sha256").update(summary, "utf8").digest("hex"),
            byteLength: Buffer.byteLength(summary),
          },
        },
      }), "utf8");
      fs.mkdirSync(scenarioRoot, { recursive: true });
      fs.symlinkSync(path.relative(scenarioRoot, generation), path.join(scenarioRoot, "latest"), "dir");

      assert.throws(
        () => readPublishedArtifact(scenarioName, "summary.json"),
        (error: unknown) => {
          assert.match((error as Error).message, /pointer/i);
          assert.doesNotMatch((error as Error).message, new RegExp(generationId));
          return true;
        },
      );
    }
  });
});
