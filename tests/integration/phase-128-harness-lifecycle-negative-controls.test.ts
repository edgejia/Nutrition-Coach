process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import {
  ArtifactPublicationConflict,
  RunnerFailureEnvelope,
  readPublishedArtifact,
  writeRunnerFailureArtifacts,
  writeScenarioArtifacts,
} from "../harness/artifacts.js";
import { createScenarioApp } from "../harness/app-fixture.js";
import { runScenarioByName } from "../harness/run.js";
import type { ScenarioContext, ScenarioMetadata, ScenarioResult } from "../harness/scenario-types.js";

const PUBLICATION_CHILD_SOURCE = `
  import fs from "node:fs";
  import { writeScenarioArtifacts } from "./tests/harness/artifacts.ts";

  process.env.HARNESS_ARTIFACTS_DIR = process.env.PHASE_128_ROOT;

  function waitAtCheckpoint() {
    fs.writeFileSync(process.env.PHASE_128_READY, "ready", "utf8");
    const gate = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(process.env.PHASE_128_RELEASE)) Atomics.wait(gate, 0, 0, 25);
  }

  const writerId = process.env.PHASE_128_WRITER;
  const holdMode = process.env.PHASE_128_HOLD;
  const result = {
    ok: true,
    steps: [{ name: "publication", ok: true }],
    artifacts: {},
    metadata: {
      scenarioId: "phase-128-process-" + writerId,
      scenarioName: "phase-128-process-" + writerId,
      status: "pass",
      counts: { completeGenerations: 1 },
      assertions: { noMixedGeneration: true },
      trace: { eventNames: ["scenario"], counts: { scenario: 1 } },
    },
    consoleSummary: "PASS phase-128-process-" + writerId + " 1/1",
  };

  const publicationTestControl = holdMode === "lock"
    ? { afterLock: waitAtCheckpoint }
    : holdMode === "generation"
      ? { afterTemporaryGeneration: waitAtCheckpoint }
      : undefined;

  try {
    await writeScenarioArtifacts("phase-128-processes", result, { publicationTestControl });
    console.log("success");
  } catch (error) {
    if (error && typeof error === "object" && error.category === "publication_conflict") {
      console.log("conflict");
    } else {
      console.log("unexpected");
      process.exitCode = 1;
    }
  }
`;

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(filePath) && Date.now() < deadline) {
    await delay(10);
  }
  assert.equal(fs.existsSync(filePath), true, `timed out waiting for ${filePath}`);
}

function spawnPublicationChild(
  root: string,
  writer: string,
  hold: "lock" | "generation" | "none",
  ready: string,
  release: string,
) {
  return spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", PUBLICATION_CHILD_SOURCE],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        PHASE_128_ROOT: root,
        PHASE_128_WRITER: writer,
        PHASE_128_HOLD: hold,
        PHASE_128_READY: ready,
        PHASE_128_RELEASE: release,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function waitForChild(child: ReturnType<typeof spawn>): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  return new Promise((resolve) => {
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function result(metadata: ScenarioMetadata): ScenarioResult {
  return {
    ok: metadata.status === "pass",
    steps: [{ name: "publication", ok: metadata.status === "pass" }],
    artifacts: {},
    metadata,
    consoleSummary: `${metadata.status} phase-128-lifecycle`,
  };
}

function safeMetadata(id: string): ScenarioMetadata {
  return {
    scenarioId: id,
    scenarioName: id,
    status: "pass",
    counts: { completeGenerations: 1 },
    assertions: { noMixedGeneration: true },
    trace: { eventNames: ["scenario", "close"], counts: { scenario: 1, close: 1 } },
  };
}

test("Phase 128 lifecycle failure envelope is exactly bounded and metadata-only", () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-lifecycle-envelope-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    writeRunnerFailureArtifacts("phase-128-lifecycle", {
      schemaVersion: 1,
      result: "failure",
      stage: "scenario",
      category: "scenario_failed",
      owner: "runner",
      closeCalls: 1,
      cleanup: "complete",
      interrupted: false,
    });
    const envelope = JSON.parse(fs.readFileSync(
      path.join(root, "phase-128-lifecycle", "latest", "failure.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.deepEqual(Object.keys(envelope).sort(), [
      "category", "cleanup", "closeCalls", "interrupted", "owner", "result", "schemaVersion", "stage",
    ]);
    assert.equal(envelope.owner, "runner");
    assert.equal("error" in envelope, false);
    assert.equal("stack" in envelope, false);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 sibling publication has one complete winner and an exact loser with no latest mutation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-lifecycle-cas-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    await writeScenarioArtifacts("phase-128-cas", result(safeMetadata("generation-one")));
    const latestSummary = readPublishedArtifact("phase-128-cas", "summary.json");
    const scenarioRoot = path.join(root, "phase-128-cas");
    fs.mkdirSync(path.join(scenarioRoot, ".publication.lock"));
    fs.writeFileSync(
      path.join(scenarioRoot, ".publication.lock", "owner.json"),
      JSON.stringify({ pid: process.ppid }),
      "utf8",
    );
    await assert.rejects(
      () => writeScenarioArtifacts("phase-128-cas", result(safeMetadata("generation-two"))),
      (error: unknown) => error instanceof ArtifactPublicationConflict,
    );
    assert.equal(readPublishedArtifact("phase-128-cas", "summary.json"), latestSummary);
    assert.deepEqual(
      fs.readdirSync(path.join(scenarioRoot, "latest")).sort(),
      ["index.json", "llm-trace.json", "scenario-result.json", "snapshots.json", "steps.json", "summary.json"],
    );
    fs.rmSync(path.join(scenarioRoot, ".publication.lock"), { recursive: true, force: true });
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 real competing writers have one winner and killed-owner recovery has one survivor", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-real-publication-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const competingReady = path.join(root, "writer-a.ready");
    const competingRelease = path.join(root, "writer-a.release");
    const writerA = spawnPublicationChild(root, "writer-a", "lock", competingReady, competingRelease);
    children.push(writerA);
    await waitForFile(competingReady);

    const writerB = spawnPublicationChild(
      root,
      "writer-b",
      "none",
      path.join(root, "writer-b.ready"),
      path.join(root, "writer-b.release"),
    );
    children.push(writerB);
    const loser = await waitForChild(writerB);
    assert.equal(loser.code, 0);
    assert.equal(loser.signal, null);
    assert.match(loser.stdout, /^conflict\s*$/);
    assert.equal(loser.stderr, "");

    fs.writeFileSync(competingRelease, "release", "utf8");
    const winner = await waitForChild(writerA);
    assert.equal(winner.code, 0);
    assert.equal(winner.signal, null);
    assert.match(winner.stdout, /^success\s*$/);
    assert.equal(winner.stderr, "");
    assert.match(readPublishedArtifact("phase-128-processes", "summary.json"), /writer-a/);

    const killedReady = path.join(root, "writer-c.ready");
    const killedRelease = path.join(root, "writer-c.release");
    const killedOwner = spawnPublicationChild(root, "writer-c", "generation", killedReady, killedRelease);
    children.push(killedOwner);
    await waitForFile(killedReady);
    assert.equal(fs.existsSync(path.join(root, "phase-128-processes", ".publication.lock")), true);
    assert.equal(
      fs.readdirSync(path.join(root, "phase-128-processes")).some((entry) => entry.startsWith(".generation-")),
      true,
    );
    assert.equal(killedOwner.kill("SIGKILL"), true);
    const killed = await waitForChild(killedOwner);
    assert.equal(killed.code, null);
    assert.equal(killed.signal, "SIGKILL");
    assert.match(readPublishedArtifact("phase-128-processes", "summary.json"), /writer-a/);

    const survivor = spawnPublicationChild(
      root,
      "writer-d",
      "none",
      path.join(root, "writer-d.ready"),
      path.join(root, "writer-d.release"),
    );
    children.push(survivor);
    const recovered = await waitForChild(survivor);
    assert.equal(recovered.code, 0);
    assert.equal(recovered.signal, null);
    assert.match(recovered.stdout, /^success\s*$/);
    assert.equal(recovered.stderr, "");

    const scenarioRoot = path.join(root, "phase-128-processes");
    assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
    assert.equal(
      fs.readdirSync(scenarioRoot).some((entry) => entry.startsWith(".generation-") || entry.startsWith(".latest-")),
      false,
    );
    assert.match(readPublishedArtifact("phase-128-processes", "summary.json"), /writer-d/);
    assert.deepEqual(
      fs.readdirSync(path.join(scenarioRoot, "latest")).sort(),
      ["index.json", "llm-trace.json", "scenario-result.json", "snapshots.json", "steps.json", "summary.json"],
    );
    for (const fileName of ["summary.json", "steps.json", "snapshots.json", "scenario-result.json"]) {
      assert.doesNotThrow(() => readPublishedArtifact("phase-128-processes", fileName));
    }
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 app fixture close is runner-owned and idempotent", async () => {
  const fixture = await createScenarioApp({});
  assert.equal(fixture.closeCalls, 0);
  await fixture.close();
  await fixture.close();
  assert.equal(fixture.closeCalls, 1);
});

test("Phase 128 runner publishes scenario failure only after its sole close", async () => {
  const events: string[] = [];
  let closeCalls = 0;
  const envelopes: unknown[] = [];
  const context = {
    app: {},
    address: "http://127.0.0.1:1",
    deviceId: "phase-128-device",
    close: async () => {
      events.push("close");
      closeCalls += 1;
    },
    get closeCalls() {
      return closeCalls;
    },
  };

  await assert.rejects(
    () => runScenarioByName("phase-128-injected-failure", {
      loadScenario: async () => ({
        name: "phase-128-injected-failure",
        run: async () => {
          events.push("scenario");
          throw new Error("scenario failure");
        },
      }),
      createApp: async () => context,
      writeFailureArtifacts: (_name: string, envelope: RunnerFailureEnvelope) => {
        events.push("failure-artifact");
        envelopes.push(envelope);
      },
    } as never),
  );

  assert.deepEqual(events, ["scenario", "close", "failure-artifact"]);
  assert.equal(closeCalls, 1);
  assert.deepEqual(envelopes, [{
    schemaVersion: 1,
    result: "failure",
    stage: "scenario",
    category: "scenario_failed",
    owner: "runner",
    closeCalls: 1,
    cleanup: "complete",
    interrupted: false,
  }]);
});

test("Phase 128 runner turns cooperative cancellation into an interrupted bounded outcome", async () => {
  const events: string[] = [];
  let closeCalls = 0;
  const envelopes: unknown[] = [];
  const controller = new AbortController();
  const context = {
    app: {},
    address: "http://127.0.0.1:1",
    deviceId: "phase-128-device",
    close: async () => {
      events.push("close");
      closeCalls += 1;
    },
    get closeCalls() {
      return closeCalls;
    },
  };

  await assert.rejects(
    () => runScenarioByName("phase-128-injected-interrupt", {
      signal: controller.signal,
      loadScenario: async () => ({
        name: "phase-128-injected-interrupt",
        run: async ({ signal }: ScenarioContext) => {
          events.push("scenario");
          setImmediate(() => controller.abort());
          await new Promise<void>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              events.push("scenario-abort");
              reject(new Error("cancelled"));
            }, { once: true });
          });
        },
      }),
      createApp: async () => context,
      writeFailureArtifacts: (_name: string, envelope: RunnerFailureEnvelope) => {
        events.push("failure-artifact");
        envelopes.push(envelope);
      },
    } as never),
  );

  assert.deepEqual(events, ["scenario", "scenario-abort", "close", "failure-artifact"]);
  assert.equal(closeCalls, 1);
  assert.deepEqual(envelopes, [{
    schemaVersion: 1,
    result: "failure",
    stage: "interrupt",
    category: "interrupted",
    owner: "runner",
    closeCalls: 1,
    cleanup: "complete",
    interrupted: true,
  }]);
});

test("Phase 128 runner emits bounded envelopes for injected boot, seed, and listen failures", async () => {
  for (const stage of ["boot", "seed", "listen"] as const) {
    const events: string[] = [];
    const envelopes: RunnerFailureEnvelope[] = [];
    await assert.rejects(
      () => runScenarioByName(`phase-128-injected-${stage}`, {
        loadScenario: async () => ({
          name: `phase-128-injected-${stage}`,
          run: async () => {
            events.push("scenario");
            return result(safeMetadata("unexpected-scenario"));
          },
        }),
        createApp: async () => {
          events.push("unexpected-create-app");
          throw new Error("fault injection should fail before app creation");
        },
        faultInjection: { stage },
        writeFailureArtifacts: (_name: string, envelope: RunnerFailureEnvelope) => {
          events.push("failure-artifact");
          envelopes.push(envelope);
        },
      } as never),
    );
    assert.deepEqual(events, ["failure-artifact"]);
    assert.deepEqual(envelopes, [{
      schemaVersion: 1,
      result: "failure",
      stage,
      category: `${stage}_failed`,
      owner: "runner",
      closeCalls: 0,
      cleanup: "complete",
      interrupted: false,
    }]);
  }
});

test("Phase 128 runner publishes an incomplete bounded envelope when the sole close throws", async () => {
  const events: string[] = [];
  let closeCalls = 0;
  const envelopes: RunnerFailureEnvelope[] = [];
  const context = {
    app: {},
    address: "http://127.0.0.1:1",
    deviceId: "phase-128-device",
    close: async () => {
      events.push("close");
      closeCalls += 1;
    },
    get closeCalls() {
      return closeCalls;
    },
  };

  await assert.rejects(
    () => runScenarioByName("phase-128-injected-close-throw", {
      loadScenario: async () => ({
        name: "phase-128-injected-close-throw",
        run: async () => {
          events.push("scenario");
          return result(safeMetadata("close-throw"));
        },
      }),
      createApp: async () => context,
      faultInjection: { stage: "close" },
      writeFailureArtifacts: (_name: string, envelope: RunnerFailureEnvelope) => {
        events.push("failure-artifact");
        envelopes.push(envelope);
      },
    } as never),
  );

  assert.deepEqual(events, ["scenario", "close", "failure-artifact"]);
  assert.deepEqual(envelopes, [{
    schemaVersion: 1,
    result: "failure",
    stage: "close",
    category: "close_failed",
    owner: "runner",
    closeCalls: 1,
    cleanup: "incomplete",
    interrupted: false,
  }]);
});

test("Phase 128 next publication recovers stale owner residue and swaps one pointer", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-lifecycle-recovery-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    const scenarioRoot = path.join(root, "phase-128-recovery");
    fs.mkdirSync(path.join(scenarioRoot, ".publication.lock"), { recursive: true });
    fs.mkdirSync(path.join(scenarioRoot, ".generation-interrupted.tmp"), { recursive: true });
    fs.writeFileSync(path.join(scenarioRoot, ".generation-interrupted.tmp", "partial.json"), "partial");
    fs.mkdirSync(path.join(scenarioRoot, "latest"), { recursive: true });
    fs.writeFileSync(path.join(scenarioRoot, "latest", "index.json"), "legacy-pointer");
    fs.writeFileSync(path.join(scenarioRoot, "latest", "summary.json"), "legacy-summary");
    fs.writeFileSync(path.join(scenarioRoot, "latest.index.json"), "legacy-index-residue");

    const oldSwapSource = path.join(scenarioRoot, ".latest-red-first");
    fs.mkdirSync(path.join(scenarioRoot, ".generation-red-first.tmp"));
    fs.symlinkSync(".generation-red-first.tmp", oldSwapSource, "dir");
    assert.throws(
      () => fs.renameSync(oldSwapSource, path.join(scenarioRoot, "latest")),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "EISDIR",
    );
    fs.rmSync(oldSwapSource, { force: true });

    await writeScenarioArtifacts("phase-128-recovery", result(safeMetadata("recovered")));

    assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
    assert.equal(fs.existsSync(path.join(scenarioRoot, ".generation-interrupted.tmp")), false);
    assert.equal(fs.lstatSync(path.join(scenarioRoot, "latest")).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(scenarioRoot, "latest.index.json")), false);
    assert.deepEqual(
      fs.readdirSync(scenarioRoot).filter((entry) => entry.startsWith(".legacy-latest-")),
      [],
    );
    assert.match(readPublishedArtifact("phase-128-recovery", "summary.json"), /recovered/);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
