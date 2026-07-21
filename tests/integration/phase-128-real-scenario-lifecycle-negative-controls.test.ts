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
  createRunnerOwnedNestedScenarioAppFactory,
  ScenarioAppLifecycleError,
  withScenarioAppLifecycleObserver,
  type ScenarioAppContext,
  type ScenarioAppFactory,
  type ScenarioAppOptions,
  type ScenarioAppServices,
} from "../harness/app-fixture.js";
import { StreamingLLMProvider } from "../harness/streaming-llm.js";
import { runScenarioByName } from "../harness/run.js";
import { writeRunnerFailureArtifacts, type RunnerFailureEnvelope } from "../harness/artifacts.js";
import type { ScenarioContext, ScenarioResult } from "../harness/scenario-types.js";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function emptyResult(name: string): ScenarioResult {
  return { ok: true, steps: [], artifacts: {}, consoleSummary: `PASS ${name} 0/0` };
}

const THROWING_LIFECYCLE_HOOKS = [
  "onAppBuilt",
  "onServicesCaptured",
  "onContextCreated",
] as const;

type ThrowingLifecycleHook = (typeof THROWING_LIFECYCLE_HOOKS)[number];

function throwingLifecycleControl(
  hook: ThrowingLifecycleHook,
  capture: {
    events: string[];
    app: (app: ScenarioAppContext["app"]) => void;
    context: (context: ScenarioAppContext) => void;
    services: (services: ScenarioAppServices) => void;
  },
): NonNullable<ScenarioAppOptions["lifecycleTestControl"]> {
  const throwSelected = (current: ThrowingLifecycleHook): void => {
    if (hook === current) throw new Error(`injected ${current} observer failure`);
  };
  return {
    onAppBuilt: (app) => {
      capture.events.push("onAppBuilt");
      capture.app(app);
      throwSelected("onAppBuilt");
    },
    onServicesCaptured: (services) => {
      capture.events.push("onServicesCaptured");
      capture.services(services);
      throwSelected("onServicesCaptured");
    },
    onContextCreated: (context) => {
      capture.events.push("onContextCreated");
      capture.context(context);
      throwSelected("onContextCreated");
    },
  };
}

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

test("Phase 128 prepareApp cannot boot an untracked standalone fixture", async () => {
  let appCreations = 0;
  let appCloses = 0;
  let failureEnvelope: RunnerFailureEnvelope | undefined;

  await withScenarioAppLifecycleObserver({
    onCreate: () => { appCreations += 1; },
    onClose: () => { appCloses += 1; },
  }, async () => {
    await assert.rejects(
      () => runScenarioByName("phase-128-prepare-bypass", {
        loadScenario: async () => ({
          name: "phase-128-prepare-bypass",
          prepareApp: async () => {
            await createScenarioApp({});
            return {};
          },
          run: async (): Promise<ScenarioResult> => ({
            ok: true,
            steps: [],
            artifacts: {},
            consoleSummary: "PASS phase-128-prepare-bypass 0/0",
          }),
        }),
        writeFailureArtifacts: (_name, envelope) => { failureEnvelope = envelope; },
      }),
    );
  });

  assert.equal(appCreations, 0, "prepareApp must not boot before runner root issuance");
  assert.equal(appCloses, 0, "no context means no cleanup close attempt");
  assert.deepEqual(failureEnvelope, {
    schemaVersion: 1,
    result: "failure",
    stage: "boot",
    category: "boot_failed",
    owner: "runner",
    closeCalls: 0,
    cleanup: "complete",
    interrupted: false,
  });
});

test("Phase 128 public nested-factory import cannot mint an untracked fixture", async () => {
  let appCreations = 0;
  let appCloses = 0;
  let failureEnvelope: RunnerFailureEnvelope | undefined;

  await withScenarioAppLifecycleObserver({
    onCreate: () => { appCreations += 1; },
    onClose: () => { appCloses += 1; },
  }, async () => {
    await assert.rejects(
      () => runScenarioByName("phase-128-public-factory-bypass", {
        loadScenario: async () => ({
          name: "phase-128-public-factory-bypass",
          run: async (): Promise<ScenarioResult> => {
            createRunnerOwnedNestedScenarioAppFactory(undefined);
            return { ok: true, steps: [], artifacts: {}, consoleSummary: "PASS phase-128-public-factory-bypass 0/0" };
          },
        }),
        writeFailureArtifacts: (_name, envelope) => { failureEnvelope = envelope; },
      }),
    );
  });

  assert.equal(appCreations, 1);
  assert.equal(appCloses, 1);
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

for (const stage of ["seed", "listen"] as const) {
  test(`Phase 128 real ${stage} failure uses pre-context close cardinality`, async () => {
    let appCreations = 0;
    let appCloses = 0;
    let failureEnvelope: RunnerFailureEnvelope | undefined;

    await withScenarioAppLifecycleObserver({
      onCreate: () => { appCreations += 1; },
      onClose: () => { appCloses += 1; },
    }, async () => {
      await assert.rejects(
        () => runScenarioByName(`phase-128-real-${stage}-failure`, {
          faultInjection: { stage },
          loadScenario: async () => ({
            name: `phase-128-real-${stage}-failure`,
            run: async (): Promise<ScenarioResult> => ({
              ok: true,
              steps: [],
              artifacts: {},
              consoleSummary: `PASS phase-128-real-${stage}-failure 0/0`,
            }),
          }),
          writeFailureArtifacts: (_name, envelope) => { failureEnvelope = envelope; },
        }),
      );
    });

    assert.equal(appCreations, 1, `${stage} failure must boot a real fixture before failing`);
    assert.equal(appCloses, 1, `${stage} failure must be cleaned by the runner`);
    assert.deepEqual(failureEnvelope, {
      schemaVersion: 1,
      result: "failure",
      stage,
      category: `${stage}_failed`,
      owner: "runner",
      closeCalls: 0,
      cleanup: "complete",
      interrupted: false,
    });
  });
}

test("Phase 128 scenario options cannot forge runner root ownership during prepare handoff", async () => {
  const forgedDone = deferred();
  let forgedContext: ScenarioAppContext | undefined;
  let forgedError: unknown;
  let appCreations = 0;
  let appCloses = 0;
  let rootCloseCalls = 0;

  try {
    await withScenarioAppLifecycleObserver({
      onCreate: () => { appCreations += 1; },
      onClose: () => { appCloses += 1; },
    }, async () => {
      await runScenarioByName("phase-128-forged-root-option", {
        loadScenario: async () => ({
          name: "phase-128-forged-root-option",
          prepareApp: () => {
            setImmediate(async () => {
              try {
                forgedContext = await createScenarioApp({ lifecycleOwner: "runner" } as never);
              } catch (error) {
                forgedError = error;
              } finally {
                forgedDone.resolve();
              }
            });
            return {};
          },
          run: async () => emptyResult("phase-128-forged-root-option"),
        }),
        createApp: async () => {
          await forgedDone.promise;
          return {
            app: {},
            address: "http://127.0.0.1:1",
            deviceId: "phase-128-root",
            cookieHeader: "",
            services: {},
            llmProvider: new StreamingLLMProvider(),
            close: async () => { rootCloseCalls += 1; },
            get closeCalls() { return rootCloseCalls; },
          } as never;
        },
        writeScenarioArtifacts: async () => {},
      });
    });
  } finally {
    await forgedContext?.close();
  }

  assert.equal(forgedContext, undefined, "public options must not mint a runner-owned context");
  assert.ok(forgedError instanceof ScenarioAppLifecycleError);
  assert.equal(appCreations, 0, "forged ownership must fail before app boot");
  assert.equal(appCloses, 0);
  assert.equal(rootCloseCalls, 1);
});

test("Phase 128 fire-and-forget nested creation is fenced, awaited, and closed before publication", async () => {
  const buildReached = deferred();
  const releaseBuild = deferred();
  const scenarioReturned = deferred();
  const events: string[] = [];
  let nestedContext: ScenarioAppContext | undefined;
  let nestedPromise: Promise<ScenarioAppContext> | undefined;
  let appCreations = 0;
  let appCloses = 0;
  let runSettled = false;

  const runPromise = withScenarioAppLifecycleObserver({
    onCreate: () => { appCreations += 1; events.push("create"); },
    onClose: () => { appCloses += 1; events.push("close"); },
  }, () => runScenarioByName("phase-128-fire-and-forget", {
    loadScenario: async () => ({
      name: "phase-128-fire-and-forget",
      run: async ({ createApp }: ScenarioContext): Promise<ScenarioResult> => {
        nestedPromise = createApp({
          lifecycleTestControl: {
            beforeBuild: async () => {
              events.push("nested-build-barrier");
              buildReached.resolve();
              await releaseBuild.promise;
            },
            onContextCreated: (context) => { nestedContext = context; },
          },
        });
        void nestedPromise.catch(() => {});
        events.push("scenario-return");
        scenarioReturned.resolve();
        return emptyResult("phase-128-fire-and-forget");
      },
    }),
    writeScenarioArtifacts: async () => { events.push("artifact"); },
  }));
  void runPromise.finally(() => { runSettled = true; });

  await Promise.all([buildReached.promise, scenarioReturned.promise]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const settledBeforeRelease = runSettled;
  const artifactBeforeRelease = events.includes("artifact");
  releaseBuild.resolve();

  try {
    await runPromise;
    await nestedPromise;
  } finally {
    await nestedContext?.close();
  }

  assert.equal(settledBeforeRelease, false, "runner must await an accepted nested creation");
  assert.equal(artifactBeforeRelease, false, "publication must wait for nested cleanup");
  assert.equal(appCreations, 2);
  assert.equal(appCloses, 2);
  assert.deepEqual(events.slice(-3), ["close", "close", "artifact"]);
});

test("Phase 128 retained runner factory rejects after run without booting", async () => {
  let retainedFactory: ScenarioAppFactory | undefined;
  let leakedContext: ScenarioAppContext | undefined;
  let leakedFacade: ScenarioAppContext | undefined;
  let appCreations = 0;
  let appCloses = 0;

  await withScenarioAppLifecycleObserver({
    onCreate: () => { appCreations += 1; },
    onClose: () => { appCloses += 1; },
  }, async () => {
    await runScenarioByName("phase-128-retained-factory", {
      loadScenario: async () => ({
        name: "phase-128-retained-factory",
        run: async ({ createApp }: ScenarioContext): Promise<ScenarioResult> => {
          retainedFactory = createApp;
          return emptyResult("phase-128-retained-factory");
        },
      }),
      writeScenarioArtifacts: async () => {},
    });

    try {
      await assert.rejects(async () => {
        leakedFacade = await retainedFactory!({
          lifecycleTestControl: { onContextCreated: (context) => { leakedContext = context; } },
        });
      }, ScenarioAppLifecycleError);
    } finally {
      await leakedContext?.close();
      await leakedFacade?.close();
    }
  });

  assert.equal(appCreations, 1, "retained factory must reject before a second boot");
  assert.equal(appCloses, 1);
});

test("Phase 128 custom incomplete lifecycle metadata remains incomplete", async () => {
  let failureEnvelope: RunnerFailureEnvelope | undefined;

  await assert.rejects(() => runScenarioByName("phase-128-custom-incomplete", {
    loadScenario: async () => ({
      name: "phase-128-custom-incomplete",
      run: async () => emptyResult("phase-128-custom-incomplete"),
    }),
    createApp: async () => {
      throw new ScenarioAppLifecycleError("seed", 0, "incomplete");
    },
    writeFailureArtifacts: (_name, envelope) => { failureEnvelope = envelope; },
  }));

  assert.equal(failureEnvelope?.cleanup, "incomplete");
  assert.equal(failureEnvelope?.closeCalls, 0);
});

for (const stage of ["services", "seed", "listen"] as const) {
  test(`Phase 128 standalone ${stage} failure closes its real fixture exactly once`, async () => {
    let appCreations = 0;
    let appCloses = 0;
    let builtApp: ScenarioAppContext["app"] | undefined;
    let sqlite: ScenarioAppServices["db"]["$client"] | undefined;

    try {
      await withScenarioAppLifecycleObserver({
        onCreate: () => { appCreations += 1; },
        onClose: () => { appCloses += 1; },
      }, async () => {
        await assert.rejects(
          () => createScenarioApp({
            lifecycleFault: stage,
            lifecycleTestControl: {
              onAppBuilt: (app) => { builtApp = app; },
              onServicesCaptured: (services) => { sqlite = services.db.$client; },
            },
          }),
          ScenarioAppLifecycleError,
        );
      });
    } finally {
      if (builtApp?.server.listening) await builtApp.close();
    }

    assert.equal(appCreations, 1);
    assert.equal(appCloses, 1, `${stage} failure must perform one standalone cleanup`);
    assert.equal(sqlite?.open, false, `${stage} failure must close its in-memory SQLite client`);
  });
}

for (const [hookIndex, hook] of THROWING_LIFECYCLE_HOOKS.entries()) {
  test(`Phase 128 runner cleans a real fixture when ${hook} throws`, async () => {
    const hookEvents: string[] = [];
    let appCreations = 0;
    let appCloses = 0;
    let builtApp: ScenarioAppContext["app"] | undefined;
    let capturedContext: ScenarioAppContext | undefined;
    let sqlite: ScenarioAppServices["db"]["$client"] | undefined;
    let failureEnvelope: RunnerFailureEnvelope | undefined;
    let rejection: unknown;
    let listeningAfterFailure: boolean | undefined;
    let sqliteOpenAfterFailure: boolean | undefined;

    const lifecycleTestControl = throwingLifecycleControl(hook, {
      events: hookEvents,
      app: (app) => { builtApp = app; },
      context: (context) => { capturedContext = context; },
      services: (services) => { sqlite = services.db.$client; },
    });

    try {
      await withScenarioAppLifecycleObserver({
        onCreate: () => { appCreations += 1; },
        onClose: () => { appCloses += 1; },
      }, async () => {
        try {
          await runScenarioByName(`phase-128-runner-${hook}-failure`, {
            loadScenario: async () => ({
              name: `phase-128-runner-${hook}-failure`,
              prepareApp: () => ({ appOptions: { lifecycleTestControl } }),
              run: async () => emptyResult(`phase-128-runner-${hook}-failure`),
            }),
            writeFailureArtifacts: (_name, envelope) => { failureEnvelope = envelope; },
          });
        } catch (error) {
          rejection = error;
        }
      });
    } finally {
      listeningAfterFailure = builtApp?.server.listening;
      sqliteOpenAfterFailure = sqlite?.open;
      try { await capturedContext?.close(); } catch { /* test recovery only */ }
      try { await builtApp?.close(); } catch { /* test recovery only */ }
      try { if (sqlite?.open) sqlite.close(); } catch { /* test recovery only */ }
    }

    assert.ok(rejection instanceof ScenarioAppLifecycleError);
    assert.equal(rejection.stage, "boot");
    assert.deepEqual(hookEvents, THROWING_LIFECYCLE_HOOKS.slice(0, hookIndex + 1));
    assert.equal(appCreations, 1);
    assert.equal(appCloses, 1, `${hook} failure must run one runner-owned cleanup`);
    assert.equal(listeningAfterFailure, false, `${hook} failure must not retain a listener`);
    if (hook !== "onAppBuilt") {
      assert.equal(sqliteOpenAfterFailure, false, `${hook} failure must close SQLite`);
    }
    assert.deepEqual(failureEnvelope, {
      schemaVersion: 1,
      result: "failure",
      stage: "boot",
      category: "boot_failed",
      owner: "runner",
      closeCalls: 0,
      cleanup: "complete",
      interrupted: false,
    });
  });
}

for (const [hookIndex, hook] of THROWING_LIFECYCLE_HOOKS.entries()) {
  test(`Phase 128 standalone fixture cleans itself when ${hook} throws`, async () => {
    const hookEvents: string[] = [];
    let appCreations = 0;
    let appCloses = 0;
    let builtApp: ScenarioAppContext["app"] | undefined;
    let capturedContext: ScenarioAppContext | undefined;
    let sqlite: ScenarioAppServices["db"]["$client"] | undefined;
    let rejection: unknown;
    let listeningAfterFailure: boolean | undefined;
    let sqliteOpenAfterFailure: boolean | undefined;

    const lifecycleTestControl = throwingLifecycleControl(hook, {
      events: hookEvents,
      app: (app) => { builtApp = app; },
      context: (context) => { capturedContext = context; },
      services: (services) => { sqlite = services.db.$client; },
    });

    try {
      await withScenarioAppLifecycleObserver({
        onCreate: () => { appCreations += 1; },
        onClose: () => { appCloses += 1; },
      }, async () => {
        try {
          await createScenarioApp({ lifecycleTestControl });
        } catch (error) {
          rejection = error;
        }
      });
    } finally {
      listeningAfterFailure = builtApp?.server.listening;
      sqliteOpenAfterFailure = sqlite?.open;
      try { await capturedContext?.close(); } catch { /* test recovery only */ }
      try { await builtApp?.close(); } catch { /* test recovery only */ }
      try { if (sqlite?.open) sqlite.close(); } catch { /* test recovery only */ }
    }

    assert.ok(rejection instanceof ScenarioAppLifecycleError);
    assert.equal(rejection.stage, "boot");
    assert.equal(rejection.cleanup, "complete");
    assert.deepEqual(hookEvents, THROWING_LIFECYCLE_HOOKS.slice(0, hookIndex + 1));
    assert.equal(appCreations, 1);
    assert.equal(appCloses, 1, `${hook} failure must run one standalone cleanup`);
    assert.equal(listeningAfterFailure, false, `${hook} failure must not retain a listener`);
    if (hook !== "onAppBuilt") {
      assert.equal(sqliteOpenAfterFailure, false, `${hook} failure must close SQLite`);
    }
  });
}

test("Phase 128 runner reports incomplete cleanup when a throwing hook cleanup fails", async () => {
  let appCreations = 0;
  let appCloses = 0;
  let closeAttempts = 0;
  let builtApp: ScenarioAppContext["app"] | undefined;
  let sqlite: ScenarioAppServices["db"]["$client"] | undefined;
  let originalClose: (() => Promise<void>) | undefined;
  let failureEnvelope: RunnerFailureEnvelope | undefined;
  let rejection: unknown;
  let listeningAfterFailure: boolean | undefined;
  let sqliteOpenAfterFailure: boolean | undefined;

  try {
    await withScenarioAppLifecycleObserver({
      onCreate: () => { appCreations += 1; },
      onClose: () => { appCloses += 1; },
    }, async () => {
      try {
        await runScenarioByName("phase-128-runner-hook-cleanup-failure", {
          loadScenario: async () => ({
            name: "phase-128-runner-hook-cleanup-failure",
            prepareApp: () => ({
              appOptions: {
                lifecycleTestControl: {
                  onContextCreated: (context) => {
                    builtApp = context.app;
                    sqlite = context.services.db.$client;
                    originalClose = context.app.close.bind(context.app);
                    context.app.close = (async () => {
                      closeAttempts += 1;
                      throw new Error("injected hook cleanup failure");
                    }) as unknown as typeof context.app.close;
                    throw new Error("injected onContextCreated observer failure");
                  },
                },
              },
            }),
            run: async () => emptyResult("phase-128-runner-hook-cleanup-failure"),
          }),
          writeFailureArtifacts: (_name, envelope) => { failureEnvelope = envelope; },
        });
      } catch (error) {
        rejection = error;
      }
    });
  } finally {
    listeningAfterFailure = builtApp?.server.listening;
    sqliteOpenAfterFailure = sqlite?.open;
    try { await originalClose?.(); } catch { /* test recovery only */ }
    try { if (sqlite?.open) sqlite.close(); } catch { /* test recovery only */ }
  }

  assert.ok(rejection instanceof ScenarioAppLifecycleError);
  assert.equal(appCreations, 1);
  assert.equal(closeAttempts, 1, "runner must make one cleanup attempt");
  assert.equal(appCloses, 0, "an incomplete cleanup must not emit a completed close observation");
  assert.equal(listeningAfterFailure, true, "failed app cleanup must leave the listener visibly open");
  assert.equal(sqliteOpenAfterFailure, false, "runner must still close SQLite when app close fails");
  assert.equal(builtApp?.server.listening, false, "test recovery must release the poisoned listener");
  assert.equal(failureEnvelope?.cleanup, "incomplete");
  assert.equal(failureEnvelope?.closeCalls, 0);
});

test("Phase 128 standalone hook failure reports incomplete cleanup exactly", async () => {
  let appCreations = 0;
  let appCloses = 0;
  let closeAttempts = 0;
  let builtApp: ScenarioAppContext["app"] | undefined;
  let sqlite: ScenarioAppServices["db"]["$client"] | undefined;
  let originalClose: (() => Promise<void>) | undefined;
  let rejection: unknown;
  let listeningAfterFailure: boolean | undefined;
  let sqliteOpenAfterFailure: boolean | undefined;

  try {
    await withScenarioAppLifecycleObserver({
      onCreate: () => { appCreations += 1; },
      onClose: () => { appCloses += 1; },
    }, async () => {
      try {
        await createScenarioApp({
          lifecycleTestControl: {
            onContextCreated: (context) => {
              builtApp = context.app;
              sqlite = context.services.db.$client;
              originalClose = context.app.close.bind(context.app);
              context.app.close = (async () => {
                closeAttempts += 1;
                throw new Error("injected standalone hook cleanup failure");
              }) as unknown as typeof context.app.close;
              throw new Error("injected standalone onContextCreated observer failure");
            },
          },
        });
      } catch (error) {
        rejection = error;
      }
    });
  } finally {
    listeningAfterFailure = builtApp?.server.listening;
    sqliteOpenAfterFailure = sqlite?.open;
    try { await originalClose?.(); } catch { /* test recovery only */ }
    try { if (sqlite?.open) sqlite.close(); } catch { /* test recovery only */ }
  }

  assert.ok(rejection instanceof ScenarioAppLifecycleError);
  assert.equal(rejection.stage, "boot");
  assert.equal(rejection.cleanup, "incomplete");
  assert.equal(appCreations, 1);
  assert.equal(closeAttempts, 1, "standalone fixture must make one cleanup attempt");
  assert.equal(appCloses, 0, "an incomplete cleanup must not emit a completed close observation");
  assert.equal(listeningAfterFailure, true, "failed standalone app cleanup must leave the listener visibly open");
  assert.equal(sqliteOpenAfterFailure, false, "standalone cleanup must still close SQLite when app close fails");
  assert.equal(builtApp?.server.listening, false, "test recovery must release the poisoned listener");
});
