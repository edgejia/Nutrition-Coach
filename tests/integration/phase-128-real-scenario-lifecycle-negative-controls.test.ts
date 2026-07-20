process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  createScenarioApp,
  withScenarioAppLifecycleObserver,
} from "../harness/app-fixture.js";
import { StreamingLLMProvider } from "../harness/streaming-llm.js";
import { runScenarioByName } from "../harness/run.js";
import { writeRunnerFailureArtifacts, type RunnerFailureEnvelope } from "../harness/artifacts.js";
import type { ScenarioContext, ScenarioResult } from "../harness/scenario-types.js";

test("Phase 128 real catalog lifecycle has one app, one runner close, and bounded interruption evidence", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-real-scenario-lifecycle-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  const controller = new AbortController();
  let appCreations = 0;
  let appCloses = 0;
  let runnerCloseCalls = 0;
  let runnerProvider: StreamingLLMProvider | undefined;
  let failureEnvelope: RunnerFailureEnvelope | undefined;
  const startedAt = Date.now();

  try {
    await withScenarioAppLifecycleObserver({
      onCreate: () => { appCreations += 1; },
      onClose: () => { appCloses += 1; },
    }, async () => {
      await assert.rejects(
        () => runScenarioByName("text-log", {
          signal: controller.signal,
          createApp: async (options) => {
            const context = await createScenarioApp(options);
            runnerProvider = context.llmProvider as StreamingLLMProvider;
            setImmediate(() => controller.abort());
            return {
              ...context,
              close: async () => {
                runnerCloseCalls += 1;
                await context.close();
              },
              get closeCalls() {
                return context.closeCalls;
              },
            };
          },
          writeFailureArtifacts: (scenarioName, envelope) => {
            failureEnvelope = envelope;
            writeRunnerFailureArtifacts(scenarioName, envelope);
          },
        }),
      );
    });

    assert.ok(Date.now() - startedAt < 10_000, "real scenario interruption must remain bounded");
    assert.ok((runnerProvider?.chatCalls.length ?? 0) > 0, "the loaded real scenario must exercise the runner-provided provider");
    assert.equal(appCreations, 1, "the loaded real scenario must not boot a second app");
    assert.equal(appCloses, 1, "exactly one app close must be observed");
    assert.equal(runnerCloseCalls, 1, "only the runner may close the app");
    assert.deepEqual(failureEnvelope, {
      schemaVersion: 1,
      result: "failure",
      stage: "interrupt",
      category: "interrupted",
      owner: "runner",
      closeCalls: 1,
      cleanup: "complete",
      interrupted: true,
    });

    const failurePath = path.join(root, "text-log", "latest", "failure.json");
    const persisted = JSON.parse(fs.readFileSync(failurePath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(persisted).sort(), [
      "category", "cleanup", "closeCalls", "interrupted", "owner", "result", "schemaVersion", "stage",
    ]);
    assert.equal("error" in persisted, false);
    assert.equal("stack" in persisted, false);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Phase 128 runner fails closed when a scenario attempts a second app boot", async () => {
  const controller = new AbortController();
  let failureEnvelope: RunnerFailureEnvelope | undefined;
  const events: string[] = [];
  let appCreations = 0;
  let appCloses = 0;

  await withScenarioAppLifecycleObserver({
    onCreate: () => { appCreations += 1; },
    onClose: () => { appCloses += 1; },
  }, async () => {
    await assert.rejects(
      () => runScenarioByName("phase-128-nested-app", {
        loadScenario: async () => ({
          name: "phase-128-nested-app",
          run: async (): Promise<ScenarioResult> => {
            events.push("scenario");
            await createScenarioApp({});
            return { ok: true, steps: [], artifacts: {}, consoleSummary: "PASS phase-128-nested-app 0/0" };
          },
        }),
        writeFailureArtifacts: (_name, envelope) => {
          events.push("failure-artifact");
          failureEnvelope = envelope;
        },
        signal: controller.signal,
      }),
    );
  });

  assert.deepEqual(events, ["scenario", "failure-artifact"]);
  assert.equal(appCreations, 1, "direct nested createScenarioApp must not boot a second app");
  assert.equal(appCloses, 1, "runner must still close its sole app");
  assert.deepEqual(failureEnvelope, {
    schemaVersion: 1,
    result: "failure",
    stage: "boot",
    category: "boot_failed",
    owner: "runner",
    closeCalls: 1,
    cleanup: "complete",
    interrupted: false,
  });
});

test("Phase 128 runner closes every owner-provided nested app before interrupted publication", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  let appCreations = 0;
  let appCloses = 0;
  let rootContext: Awaited<ReturnType<typeof createScenarioApp>> | undefined;
  let failureEnvelope: RunnerFailureEnvelope | undefined;

  await withScenarioAppLifecycleObserver({
    onCreate: () => {
      appCreations += 1;
      events.push("create");
    },
    onClose: () => {
      appCloses += 1;
      events.push("close");
    },
  }, async () => {
    await assert.rejects(
      () => runScenarioByName("phase-128-nested-interrupt", {
        createApp: async (options) => {
          rootContext = await createScenarioApp(options);
          return {
            ...rootContext,
            close: async () => {
              events.push("root-close");
              await rootContext!.close();
            },
            get closeCalls() {
              return rootContext!.closeCalls;
            },
          };
        },
        loadScenario: async () => ({
          name: "phase-128-nested-interrupt",
          run: async ({ createApp, signal }: ScenarioContext): Promise<ScenarioResult> => {
            events.push("scenario");
            await createApp({});
            await createApp({});
            events.push("nested-ready");
            setImmediate(() => controller.abort());
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                events.push("scenario-abort");
                reject(new Error("cooperative interruption"));
              }, { once: true });
            });
            return { ok: true, steps: [], artifacts: {}, consoleSummary: "PASS phase-128-nested-interrupt 0/0" };
          },
        }),
        signal: controller.signal,
        writeFailureArtifacts: (_name, envelope) => {
          events.push("failure-artifact");
          failureEnvelope = envelope;
        },
      }),
    );
  });

  assert.equal(appCreations, 3, "root plus both owner-provided nested apps must boot");
  assert.equal(appCloses, 3, "runner must close root plus every nested app exactly once");
  assert.equal(rootContext?.closeCalls, 1);
  assert.deepEqual(events, [
    "create",
    "scenario",
    "create",
    "create",
    "nested-ready",
    "scenario-abort",
    "close",
    "close",
    "root-close",
    "close",
    "failure-artifact",
  ]);
  assert.deepEqual(failureEnvelope, {
    schemaVersion: 1,
    result: "failure",
    stage: "interrupt",
    category: "interrupted",
    owner: "runner",
    closeCalls: 1,
    cleanup: "complete",
    interrupted: true,
  });
});
