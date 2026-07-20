process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
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

  const publicationTestControl = holdMode === "owner-window"
    ? { beforeLockPublish: waitAtCheckpoint }
    : holdMode === "pre-owner"
    ? { afterTemporaryLockCreate: waitAtCheckpoint }
    : holdMode === "lock"
    ? { afterLock: waitAtCheckpoint }
    : holdMode === "generation"
      ? { afterTemporaryGeneration: waitAtCheckpoint }
      : holdMode === "generation-renamed"
        ? { afterGenerationRename: waitAtCheckpoint }
      : undefined;

  try {
    await writeScenarioArtifacts("phase-128-processes", result, { publicationTestControl });
    console.log("success");
  } catch (error) {
    if (error && typeof error === "object" && error.category === "publication_conflict") {
      console.log("conflict");
    } else {
      const details = error && typeof error === "object"
        ? { name: error.name, code: error.code, category: error.category }
        : { name: typeof error };
      console.log("unexpected " + JSON.stringify(details));
      process.exitCode = 1;
    }
  }
`;

const PUBLICATION_WORKER_SOURCE = `
  const { parentPort, workerData } = require("node:worker_threads");

  process.env.HARNESS_ARTIFACTS_DIR = workerData.root;

  async function run() {
    const { writeScenarioArtifacts } = await import(workerData.artifactsModuleUrl);
    const result = {
      ok: true,
      steps: [{ name: "publication", ok: true }],
      artifacts: {},
      metadata: {
        scenarioId: "phase-128-worker-" + workerData.writerId,
        scenarioName: "phase-128-worker-" + workerData.writerId,
        status: "pass",
        counts: { completeGenerations: 1 },
        assertions: { noMixedGeneration: true },
        trace: { eventNames: ["scenario"], counts: { scenario: 1 } },
      },
      consoleSummary: "PASS phase-128-worker-" + workerData.writerId + " 1/1",
    };
    const publicationTestControl = workerData.hold
      ? {
          afterLock: () => {
            parentPort.postMessage({ kind: "locked", pid: process.pid });
            const gate = new Int32Array(workerData.gate);
            while (Atomics.load(gate, 0) === 0) Atomics.wait(gate, 0, 0);
          },
        }
      : undefined;
    try {
      await writeScenarioArtifacts("phase-128-workers", result, { publicationTestControl });
      parentPort.postMessage({ kind: "result", outcome: "success", pid: process.pid });
    } catch (error) {
      if (error && typeof error === "object" && error.category === "publication_conflict") {
        parentPort.postMessage({ kind: "result", outcome: "conflict", pid: process.pid });
        return;
      }
      throw error;
    }
  }

  run().catch((error) => {
    parentPort.postMessage({
      kind: "unexpected",
      name: error && typeof error === "object" ? error.name : typeof error,
      code: error && typeof error === "object" ? error.code : undefined,
    });
  });
`;

interface PublicationWorkerMessage {
  kind: "locked" | "result" | "unexpected";
  outcome?: "success" | "conflict";
  pid?: number;
  name?: string;
  code?: string;
}

function waitForWorkerMessage(worker: Worker, kind: PublicationWorkerMessage["kind"]): Promise<PublicationWorkerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: PublicationWorkerMessage) => {
      if (message.kind !== kind) return;
      cleanup();
      resolve(message);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`publication worker exited before ${kind}: ${code}`));
    };
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
  });
}

function createPublicationWorker(
  root: string,
  writerId: string,
  hold: boolean,
  gate: SharedArrayBuffer,
): Worker {
  return new Worker(PUBLICATION_WORKER_SOURCE, {
    eval: true,
    workerData: {
      root,
      writerId,
      hold,
      gate,
      artifactsModuleUrl: new URL("../harness/artifacts.ts", import.meta.url).href,
    },
  });
}

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
  hold: "pre-owner" | "owner-window" | "lock" | "generation" | "generation-renamed" | "none",
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
      JSON.stringify({ pid: process.ppid, token: "11111111-1111-4111-8111-111111111111" }),
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

test("Phase 128 same-PID workers cannot both own one publication", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-worker-publication-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const gateView = new Int32Array(gate);
  const workers: Worker[] = [];
  try {
    const owner = createPublicationWorker(root, "owner", true, gate);
    workers.push(owner);
    const locked = await waitForWorkerMessage(owner, "locked");
    assert.equal(locked.pid, process.pid);

    const scenarioRoot = path.join(root, "phase-128-workers");
    const ownerMetadata = JSON.parse(fs.readFileSync(
      path.join(scenarioRoot, ".publication.lock", "owner.json"),
      "utf8",
    )) as { pid?: unknown; token?: unknown };
    assert.equal(ownerMetadata.pid, process.pid);
    assert.match(String(ownerMetadata.token), /^[a-f0-9-]{36}$/i);

    const sibling = createPublicationWorker(root, "sibling", false, gate);
    workers.push(sibling);
    const siblingResult = await waitForWorkerMessage(sibling, "result");
    assert.equal(siblingResult.pid, process.pid);
    assert.equal(siblingResult.outcome, "conflict");

    Atomics.store(gateView, 0, 1);
    Atomics.notify(gateView, 0);
    const ownerResult = await waitForWorkerMessage(owner, "result");
    assert.equal(ownerResult.outcome, "success");
    assert.match(readPublishedArtifact("phase-128-workers", "summary.json"), /worker-owner/);
    assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
  } finally {
    Atomics.store(gateView, 0, 1);
    Atomics.notify(gateView, 0);
    await Promise.all(workers.map((worker) => worker.terminate()));
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

test("Phase 128 lock acquisition never exposes an empty owner window", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-lock-owner-atomic-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  const ready = path.join(root, "owner-window.ready");
  const release = path.join(root, "owner-window.release");
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const owner = spawnPublicationChild(root, "owner-window-a", "owner-window", ready, release);
    children.push(owner);
    await waitForFile(ready);
    const scenarioRoot = path.join(root, "phase-128-processes");
    assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
    const candidates = fs.readdirSync(scenarioRoot)
      .filter((entry) => entry.startsWith(".publication-lock-") && entry.endsWith(".tmp"));
    assert.equal(candidates.length, 1);
    const ownerPath = path.join(scenarioRoot, candidates[0]!, "owner.json");
    const ownerMetadata = JSON.parse(fs.readFileSync(ownerPath, "utf8")) as { pid?: unknown; token?: unknown };
    assert.equal(ownerMetadata.pid, owner.pid);
    assert.match(String(ownerMetadata.token), /^[a-f0-9-]{36}$/i);

    const sibling = spawnPublicationChild(
      root,
      "owner-window-b",
      "none",
      path.join(root, "owner-window-b.ready"),
      path.join(root, "owner-window-b.release"),
    );
    children.push(sibling);
    const siblingResult = await waitForChild(sibling);
    assert.equal(siblingResult.code, 0);
    assert.equal(siblingResult.signal, null);
    assert.match(siblingResult.stdout, /^success\s*$/);
    assert.equal(siblingResult.stderr, "");

    fs.writeFileSync(release, "release", "utf8");
    const ownerResult = await waitForChild(owner);
    assert.equal(ownerResult.code, 0, `owner stdout=${ownerResult.stdout} stderr=${ownerResult.stderr}`);
    assert.equal(ownerResult.signal, null);
    assert.match(ownerResult.stdout, /^success\s*$/);
    assert.equal(ownerResult.stderr, "");
    assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
    assert.match(readPublishedArtifact("phase-128-processes", "summary.json"), /owner-window-a/);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 legacy pointer remains restorable after migration fault", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-legacy-rollback-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    for (const stage of ["afterLegacyMigration", "beforePointerRename", "afterPointerRename"] as const) {
      const scenarioName = `phase-128-legacy-rollback-${stage}`;
      const scenarioRoot = path.join(root, scenarioName);
      fs.mkdirSync(path.join(scenarioRoot, "latest"), { recursive: true });
      fs.writeFileSync(path.join(scenarioRoot, "latest", "index.json"), "legacy-pointer", "utf8");
      fs.writeFileSync(path.join(scenarioRoot, "latest", "summary.json"), "legacy-summary", "utf8");
      fs.writeFileSync(path.join(scenarioRoot, "latest.index.json"), "legacy-index", "utf8");
      const originalLatestPointer = fs.readFileSync(path.join(scenarioRoot, "latest", "index.json"), "utf8");
      const originalLatestSummary = fs.readFileSync(path.join(scenarioRoot, "latest", "summary.json"), "utf8");
      const originalLatestIndex = fs.readFileSync(path.join(scenarioRoot, "latest.index.json"), "utf8");
      const injectedFailure = new Error(`phase-128 injected ${stage} failure`);
      const publicationTestControl = {
        [stage]: () => {
          if (stage === "afterLegacyMigration") {
            const migrated = fs.readdirSync(scenarioRoot)
              .filter((entry) => entry.startsWith(".legacy-latest-"));
            assert.equal(migrated.length >= 1, true);
          }
          throw injectedFailure;
        },
      };

      await assert.rejects(
        writeScenarioArtifacts(
          scenarioName,
          result(safeMetadata("should-not-publish")),
          { publicationTestControl } as never,
        ),
        (error: unknown) => error === injectedFailure,
      );

      assert.equal(fs.lstatSync(path.join(scenarioRoot, "latest")).isDirectory(), true);
      assert.equal(fs.readFileSync(path.join(scenarioRoot, "latest", "index.json"), "utf8"), originalLatestPointer);
      assert.equal(fs.readFileSync(path.join(scenarioRoot, "latest", "summary.json"), "utf8"), originalLatestSummary);
      assert.equal(fs.readFileSync(path.join(scenarioRoot, "latest.index.json"), "utf8"), originalLatestIndex);
      assert.deepEqual(
        fs.readdirSync(scenarioRoot).filter((entry) => entry.startsWith(".legacy-latest-")),
        [],
      );
      assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
    }
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 killed complete generation is reaped without removing the current pointer target", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-complete-generation-recovery-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  const children: ReturnType<typeof spawn>[] = [];
  try {
    await writeScenarioArtifacts("phase-128-processes", result(safeMetadata("generation-baseline")));
    const scenarioRoot = path.join(root, "phase-128-processes");
    const baselineTarget = fs.realpathSync(path.join(scenarioRoot, "latest"));

    const ready = path.join(root, "generation-renamed.ready");
    const release = path.join(root, "generation-renamed.release");
    const killedOwner = spawnPublicationChild(root, "generation-killed", "generation-renamed", ready, release);
    children.push(killedOwner);
    await waitForFile(ready);
    assert.equal(fs.realpathSync(path.join(scenarioRoot, "latest")), baselineTarget);
    const completeBeforeKill = fs.readdirSync(scenarioRoot)
      .filter((entry) => entry.startsWith("generation-"))
      .map((entry) => path.join(scenarioRoot, entry));
    const killedGeneration = completeBeforeKill.find((entry) => entry !== baselineTarget);
    assert.notEqual(killedGeneration, undefined);
    assert.equal(killedOwner.kill("SIGKILL"), true);
    const killed = await waitForChild(killedOwner);
    assert.equal(killed.code, null);
    assert.equal(killed.signal, "SIGKILL");

    const survivor = spawnPublicationChild(
      root,
      "generation-survivor",
      "none",
      path.join(root, "generation-survivor.ready"),
      path.join(root, "generation-survivor.release"),
    );
    children.push(survivor);
    const recovered = await waitForChild(survivor);
    assert.equal(recovered.code, 0, `survivor stdout=${recovered.stdout} stderr=${recovered.stderr}`);
    assert.equal(recovered.signal, null);
    assert.match(recovered.stdout, /^success\s*$/);
    assert.equal(fs.existsSync(killedGeneration!), false);
    assert.match(readPublishedArtifact("phase-128-processes", "summary.json"), /generation-survivor/);
    const referencedGeneration = fs.realpathSync(path.join(scenarioRoot, "latest"));
    assert.equal(fs.existsSync(referencedGeneration), true);
    assert.deepEqual(
      fs.readdirSync(scenarioRoot).filter((entry) => entry.startsWith("generation-")),
      [path.basename(referencedGeneration)],
    );
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 pre-owner temp lock identity prevents live sibling garbage collection", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-pre-owner-lock-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const ready = path.join(root, "pre-owner.ready");
    const release = path.join(root, "pre-owner.release");
    const owner = spawnPublicationChild(root, "pre-owner-a", "pre-owner", ready, release);
    children.push(owner);
    await waitForFile(ready);
    const scenarioRoot = path.join(root, "phase-128-processes");
    assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
    const candidates = fs.readdirSync(scenarioRoot)
      .filter((entry) => entry.startsWith(".publication-lock-") && entry.endsWith(".tmp"));
    assert.equal(candidates.length, 1);
    assert.equal(fs.existsSync(path.join(scenarioRoot, candidates[0]!, "owner.json")), false);
    assert.match(candidates[0]!, new RegExp(`^\\.publication-lock-${owner.pid}-[a-f0-9-]+\\.tmp$`, "i"));

    const sibling = spawnPublicationChild(
      root,
      "pre-owner-b",
      "none",
      path.join(root, "pre-owner-b.ready"),
      path.join(root, "pre-owner-b.release"),
    );
    children.push(sibling);
    const siblingResult = await waitForChild(sibling);
    assert.equal(siblingResult.code, 0, `sibling stdout=${siblingResult.stdout} stderr=${siblingResult.stderr}`);
    assert.equal(fs.existsSync(path.join(scenarioRoot, candidates[0]!)), true);

    fs.writeFileSync(release, "release", "utf8");
    const ownerResult = await waitForChild(owner);
    assert.equal(ownerResult.code, 0, `owner stdout=${ownerResult.stdout} stderr=${ownerResult.stderr}`);
    assert.match(ownerResult.stdout, /^success\s*$/);
    assert.equal(fs.existsSync(path.join(scenarioRoot, candidates[0]!)), false);
    assert.match(readPublishedArtifact("phase-128-processes", "summary.json"), /pre-owner-a/);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 malformed and out-of-range lock owner PIDs are recoverable residue", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-owner-pid-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    for (const [name, pid] of [["out-of-range", 2_147_483_648], ["malformed", "not-a-pid"]] as const) {
      const scenarioName = `phase-128-owner-${name}`;
      const scenarioRoot = path.join(root, scenarioName);
      fs.mkdirSync(path.join(scenarioRoot, ".publication.lock"), { recursive: true });
      fs.writeFileSync(path.join(scenarioRoot, ".publication.lock", "owner.json"), JSON.stringify({ pid }), "utf8");
      await writeScenarioArtifacts(scenarioName, result(safeMetadata(`owner-${name}`)));
      assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
      assert.match(readPublishedArtifact(scenarioName, "summary.json"), new RegExp(`owner-${name}`));
    }
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 pointer token read errors fail closed and preserve the prior latest", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-pointer-token-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    const scenarioRoot = path.join(root, "phase-128-pointer-token");
    fs.mkdirSync(path.join(scenarioRoot, "latest", "index.json"), { recursive: true });
    fs.writeFileSync(path.join(scenarioRoot, "latest", "summary.json"), "prior-summary", "utf8");
    await assert.rejects(
      writeScenarioArtifacts("phase-128-pointer-token", result(safeMetadata("should-not-publish"))),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "EISDIR",
    );
    assert.equal(fs.lstatSync(path.join(scenarioRoot, "latest")).isDirectory(), true);
    assert.equal(fs.lstatSync(path.join(scenarioRoot, "latest", "index.json")).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(scenarioRoot, "latest", "summary.json"), "utf8"), "prior-summary");
    assert.equal(fs.existsSync(path.join(scenarioRoot, ".publication.lock")), false);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 directory fsync faults fail closed at generation and pointer durability boundaries", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-fsync-fault-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    for (const stage of ["generation-root", "pointer-root"] as const) {
      const scenarioName = `phase-128-fsync-${stage}`;
      await writeScenarioArtifacts(scenarioName, result(safeMetadata(`${stage}-baseline`)));
      const prior = readPublishedArtifact(scenarioName, "summary.json");
      const injected = new Error(`injected ${stage} fsync failure`);
      let observed = false;
      await assert.rejects(
        writeScenarioArtifacts(
          scenarioName,
          result(safeMetadata(`${stage}-replacement`)),
          {
            publicationTestControl: {
              beforeDirectoryFsync: (currentStage: string) => {
                if (currentStage !== stage) return;
                observed = true;
                throw injected;
              },
            },
          } as never,
        ),
        (error: unknown) => error === injected,
      );
      assert.equal(observed, true);
      assert.equal(readPublishedArtifact(scenarioName, "summary.json"), prior);
      assert.equal(fs.existsSync(path.join(root, scenarioName, ".publication.lock")), false);
    }
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 cleanup faults preserve primary identity, release ownership, and avoid ambiguous commit failure", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-cleanup-fault-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    for (const cleanupOperation of ["remove-pointer", "restore-legacy-latest", "remove-lock"] as const) {
      const scenarioName = `phase-128-cleanup-${cleanupOperation}`;
      await writeScenarioArtifacts(scenarioName, result(safeMetadata(`${cleanupOperation}-baseline`)));
      const prior = readPublishedArtifact(scenarioName, "summary.json");
      const primary = new Error(`primary ${cleanupOperation} failure`);
      const cleanupFault = new Error(`cleanup ${cleanupOperation} failure`);
      let cleanupObserved = false;
      await assert.rejects(
        writeScenarioArtifacts(
          scenarioName,
          result(safeMetadata(`${cleanupOperation}-replacement`)),
          {
            publicationTestControl: {
              afterPointerRename: () => {
                throw primary;
              },
              beforeCleanupOperation: (operation: string) => {
                if (operation !== cleanupOperation || cleanupObserved) return;
                cleanupObserved = true;
                throw cleanupFault;
              },
            },
          } as never,
        ),
        (error: unknown) => error === primary,
      );
      assert.equal(cleanupObserved, true);
      assert.equal(readPublishedArtifact(scenarioName, "summary.json"), prior);
      assert.equal(fs.existsSync(path.join(root, scenarioName, ".publication.lock")), false);
      await writeScenarioArtifacts(scenarioName, result(safeMetadata(`${cleanupOperation}-survivor`)));
      assert.match(readPublishedArtifact(scenarioName, "summary.json"), new RegExp(`${cleanupOperation}-survivor`));
    }

    const committedScenario = "phase-128-cleanup-after-commit";
    await writeScenarioArtifacts(committedScenario, result(safeMetadata("committed-baseline")));
    let durableCleanupObserved = false;
    await writeScenarioArtifacts(
      committedScenario,
      result(safeMetadata("committed-replacement")),
      {
        publicationTestControl: {
          beforeCleanupOperation: (operation: string) => {
            if (operation !== "remove-legacy-latest" || durableCleanupObserved) return;
            durableCleanupObserved = true;
            throw new Error("post-commit cleanup fault");
          },
        },
      } as never,
    );
    assert.equal(durableCleanupObserved, true);
    assert.match(readPublishedArtifact(committedScenario, "summary.json"), /committed-replacement/);
    assert.equal(fs.existsSync(path.join(root, committedScenario, ".publication.lock")), false);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
