import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface GuestSessionBootstrapResult {
  deviceId: string;
  goal: "fat_loss" | "muscle_gain";
  dailyTargets: DailyTargets;
  establishedBy: "active" | "resume" | "legacy_migration";
}

interface AppStateSnapshot {
  deviceId: string | null;
  goal: string | null;
  activeScreen: string;
  guestSessionStatus: string;
  guestSessionRecoveryAttempted: boolean;
  dailyTargets: DailyTargets | null;
}

interface StoreHarnessResult {
  snapshot: AppStateSnapshot;
  storage: Record<string, string>;
  calls: BrowserSessionCall[];
  cookieHeader: string;
}

interface BrowserSessionCall {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number;
  responseBody: string;
  setCookieHeaders: string[];
}

type InjectHeaders = Record<string, string | string[] | number | undefined>;

interface InjectResponseLike {
  statusCode: number;
  body: string;
  headers: InjectHeaders;
}

interface LocalStorageShim extends Storage {
  __storage: Map<string, string>;
}

function pass(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  scenarioName: string,
  steps: ScenarioStepResult[],
  failedStepName: string,
  artifacts: Record<string, unknown>,
): ScenarioResult {
  return { ok: false, failedStep: failedStepName, steps, artifacts, consoleSummary: `FAIL ${scenarioName} ${failedStepName}` };
}

const STEP_NAMES = [
  "legacy_migration",
  "same_browser_resume",
  "tampered_access_fail_closed",
  "blocking_rebuild_flow",
] as const;

const storeModuleUrl = new URL("../../../client/src/store.ts", import.meta.url);

function getSetCookieHeaders(
  res: { headers: InjectHeaders },
) {
  const rawHeader = res.headers["set-cookie"];
  if (Array.isArray(rawHeader)) {
    return rawHeader;
  }
  return typeof rawHeader === "string" ? [rawHeader] : [];
}

function parseCookiePair(cookieValue: string) {
  const [pair] = cookieValue.split(";", 1);
  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    name: pair.slice(0, separatorIndex),
    value: pair.slice(separatorIndex + 1),
  };
}

function parseCookieHeader(cookieHeader: string | undefined) {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = parseCookiePair(trimmed);
    if (parsed) {
      cookies.set(parsed.name, parsed.value);
    }
  }

  return cookies;
}

function cookieHeaderFromJar(jar: Map<string, string>) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function applySetCookieHeaders(jar: Map<string, string>, setCookieHeaders: string[]) {
  for (const header of setCookieHeaders) {
    const parsed = parseCookiePair(header);
    if (!parsed) {
      continue;
    }
    if (parsed.value === "" || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(header)) {
      jar.delete(parsed.name);
      continue;
    }
    jar.set(parsed.name, parsed.value);
  }
}

function installLocalStorage(initial: Record<string, string | undefined>): LocalStorageShim {
  const storage = new Map<string, string>();
  for (const [key, value] of Object.entries(initial)) {
    if (value !== undefined) {
      storage.set(key, value);
    }
  }

  const shim = {
    __storage: storage,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    get length() {
      return storage.size;
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
  } as LocalStorageShim;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: shim,
  });

  return shim;
}

function snapshotStoreState(state: {
  deviceId: string | null;
  goal: string | null;
  activeScreen: string;
  guestSessionStatus: string;
  guestSessionRecoveryAttempted: boolean;
  dailyTargets: DailyTargets | null;
}): AppStateSnapshot {
  return {
    deviceId: state.deviceId,
    goal: state.goal,
    activeScreen: state.activeScreen,
    guestSessionStatus: state.guestSessionStatus,
    guestSessionRecoveryAttempted: state.guestSessionRecoveryAttempted,
    dailyTargets: state.dailyTargets,
  };
}

function responseHeadersFromInject(
  headers: InjectHeaders,
) {
  const responseHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        responseHeaders.append(name, headerValue);
      }
      continue;
    }
    if (value !== undefined) {
      responseHeaders.set(name, String(value));
    }
  }

  return responseHeaders;
}

function createBrowserSession(
  app: Awaited<ReturnType<typeof createScenarioApp>>["app"],
  initialCookieHeader?: string,
) {
  const jar = parseCookieHeader(initialCookieHeader);
  const calls: BrowserSessionCall[] = [];

  const wrappedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const resolvedUrl = new URL(url, "http://scenario.local");
    const headers = new Headers(
      init?.headers
      ?? (input instanceof Request ? input.headers : undefined),
    );
    const cookieHeader = cookieHeaderFromJar(jar);
    if (cookieHeader && !headers.has("cookie")) {
      headers.set("cookie", cookieHeader);
    }

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = init?.body;
    if (body !== undefined && body !== null && typeof body !== "string") {
      throw new Error(`Unsupported store harness body type for ${resolvedUrl.pathname}`);
    }

    const injectOptions = {
      method,
      url: `${resolvedUrl.pathname}${resolvedUrl.search}`,
      headers: Object.fromEntries(headers.entries()),
      ...(typeof body === "string" ? { payload: body } : {}),
    };
    const res = await app.inject(injectOptions as never) as unknown as InjectResponseLike;

    const setCookieHeaders = getSetCookieHeaders(res);
    applySetCookieHeaders(jar, setCookieHeaders);
    calls.push({
      method,
      url: `${resolvedUrl.pathname}${resolvedUrl.search}`,
      requestHeaders: Object.fromEntries(headers.entries()),
      requestBody: typeof body === "string" ? body : null,
      status: res.statusCode,
      responseBody: res.body,
      setCookieHeaders,
    });

    return new Response(res.body, {
      status: res.statusCode,
      headers: responseHeadersFromInject(res.headers),
    });
  }) as typeof fetch;

  return { fetch: wrappedFetch, jar, calls };
}

async function loadFreshStore(tag: string) {
  return import(`${storeModuleUrl.href}?${encodeURIComponent(tag)}`) as Promise<{ useStore: { getState: () => any } }>;
}

async function runStoreFlow(params: {
  app: Awaited<ReturnType<typeof createScenarioApp>>["app"];
  storageSeed: Record<string, string | undefined>;
  initialCookieHeader?: string;
  tag: string;
  run: (store: { getState: () => any }, session: ReturnType<typeof createBrowserSession>, storage: Map<string, string>) => Promise<unknown>;
}) {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const session = createBrowserSession(params.app, params.initialCookieHeader);
  const localStorageShim = installLocalStorage(params.storageSeed);
  globalThis.fetch = session.fetch;

  try {
    const storeModule = await loadFreshStore(params.tag);
    const result = await params.run(storeModule.useStore, session, localStorageShim.__storage);
    return result;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: originalLocalStorage,
      });
    }
  }
}

const scenario: VerificationScenario = {
  name: "guest-session-hardening",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    const llmProvider = new StreamingLLMProvider();
    const tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-guest-session-hardening-"));
    const assetsDir = path.join(tempRoot, "assets");
    const stagedAssetPath = path.join(tempRoot, "tamper-proof.png");
    await writeFile(stagedAssetPath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

    const fixture = await createScenarioApp({ llmProvider, assetsDir });

    try {
      let migratedSession: GuestSessionBootstrapResult | undefined;
      let migratedCookieHeader = "";
      let resumeOnlyCookieHeader = "";

      try {
        const migrationEvidence = await runStoreFlow({
          app: fixture.app,
          storageSeed: { deviceId: fixture.deviceId },
          tag: `guest-session-hardening-bootstrap-${Date.now()}`,
          run: async (store, session, storage) => {
            const ok = await store.getState().bootstrapGuestSession();
            return {
              ok,
              snapshot: snapshotStoreState(store.getState()),
              storage: Object.fromEntries(storage.entries()),
              calls: session.calls,
              cookieHeader: cookieHeaderFromJar(session.jar),
            } satisfies StoreHarnessResult & { ok: boolean };
          },
        }) as StoreHarnessResult & { ok: boolean };

        const migrationCall = migrationEvidence.calls[0];
        const migrationBody = migrationCall ? JSON.parse(migrationCall.responseBody) as GuestSessionBootstrapResult : null;
        if (!migrationEvidence.ok) {
          throw new Error("bootstrapGuestSession returned false");
        }
        if (!migrationCall) {
          throw new Error("bootstrapGuestSession did not make a request");
        }
        if (migrationCall.status !== 200) {
          throw new Error(`Expected migration status 200, got ${migrationCall.status}`);
        }
        if (migrationBody?.establishedBy !== "legacy_migration") {
          throw new Error(`Expected legacy_migration, got ${migrationBody?.establishedBy ?? "missing"}`);
        }
        if (migrationEvidence.snapshot.guestSessionStatus !== "ready") {
          throw new Error(`Expected ready status, got ${migrationEvidence.snapshot.guestSessionStatus}`);
        }
        if (migrationEvidence.snapshot.deviceId !== fixture.deviceId) {
          throw new Error("Device ID changed during migration bootstrap");
        }

        migratedSession = migrationBody;
        migratedCookieHeader = migrationEvidence.cookieHeader;
        const migratedJar = parseCookieHeader(migratedCookieHeader);
        const resumeCookieName = [...migratedJar.keys()].find((name) => /resume/i.test(name));
        if (!resumeCookieName) {
          throw new Error("Missing resume cookie after legacy migration");
        }
        resumeOnlyCookieHeader = `${resumeCookieName}=${migratedJar.get(resumeCookieName)}`;
        artifacts.legacy_migration = {
          migrationCall,
          snapshot: migrationEvidence.snapshot,
          storage: migrationEvidence.storage,
          cookieHeader: migratedCookieHeader,
        };
        steps.push(pass("legacy_migration", artifacts.legacy_migration));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push(fail("legacy_migration", message, artifacts.legacy_migration));
        return failResult("guest-session-hardening", steps, "legacy_migration", artifacts);
      }

      try {
        const resumeEvidence = await runStoreFlow({
          app: fixture.app,
          storageSeed: { deviceId: fixture.deviceId },
          initialCookieHeader: resumeOnlyCookieHeader,
          tag: `guest-session-hardening-resume-${Date.now()}`,
          run: async (store, session, storage) => {
            const ok = await store.getState().recoverGuestSession();
            return {
              ok,
              snapshot: snapshotStoreState(store.getState()),
              storage: Object.fromEntries(storage.entries()),
              calls: session.calls,
              cookieHeader: cookieHeaderFromJar(session.jar),
            } satisfies StoreHarnessResult & { ok: boolean };
          },
        }) as StoreHarnessResult & { ok: boolean };

        const resumeCall = resumeEvidence.calls[0];
        const resumeBody = resumeCall ? JSON.parse(resumeCall.responseBody) as GuestSessionBootstrapResult : null;
        if (!resumeEvidence.ok) {
          throw new Error("recoverGuestSession returned false");
        }
        if (!resumeCall) {
          throw new Error("recoverGuestSession did not make a request");
        }
        if (resumeCall.status !== 200) {
          throw new Error(`Expected resume status 200, got ${resumeCall.status}`);
        }
        if (resumeBody?.establishedBy !== "resume") {
          throw new Error(`Expected resume establishment, got ${resumeBody?.establishedBy ?? "missing"}`);
        }
        if (resumeEvidence.snapshot.guestSessionStatus !== "ready") {
          throw new Error(`Expected ready status, got ${resumeEvidence.snapshot.guestSessionStatus}`);
        }
        if (resumeEvidence.snapshot.guestSessionRecoveryAttempted !== true) {
          throw new Error("Expected recovery attempt marker to stay true after resume");
        }

        migratedCookieHeader = resumeEvidence.cookieHeader;
        artifacts.same_browser_resume = {
          resumeCall,
          snapshot: resumeEvidence.snapshot,
          storage: resumeEvidence.storage,
          cookieHeader: migratedCookieHeader,
        };
        steps.push(pass("same_browser_resume", artifacts.same_browser_resume));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push(fail("same_browser_resume", message, artifacts.same_browser_resume));
        return failResult("guest-session-hardening", steps, "same_browser_resume", artifacts);
      }

      try {
        const historyMessage = await fixture.services.chatService.saveMessage(fixture.deviceId, "assistant", "session baseline");
        const asset = await fixture.services.assetService.createAsset(fixture.deviceId, {
          stagedPath: stagedAssetPath,
          mimeType: "image/png",
          originalFilename: "tamper-proof.png",
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

        try {
          const validSseRes = await fetch(`${fixture.address}/api/sse`, {
            headers: {
              cookie: migratedCookieHeader,
              Accept: "text/event-stream",
            },
            signal: controller.signal,
          });
          if (validSseRes.status !== 200 || !validSseRes.body) {
            throw new Error(`Expected valid SSE status 200, got ${validSseRes.status}`);
          }

          reader = validSseRes.body.getReader();
          const validSseText = await readStreamUntilEvent(reader, "daily_summary", 20);
          const validSseEvents = parseSSEEvents(validSseText);
          const invalidCookieHeader = cookieHeaderFromJar(
            new Map([...parseCookieHeader(migratedCookieHeader).keys()].map((name) => [name, "invalid"])),
          );

          const validHistoryRes = await fetch(`${fixture.address}/api/chat/history?limit=5`, {
            headers: { cookie: migratedCookieHeader },
          });
          const invalidHistoryRes = await fetch(`${fixture.address}/api/chat/history?limit=5`, {
            headers: { cookie: invalidCookieHeader },
          });
          const validAssetRes = await fetch(`${fixture.address}/api/assets/${asset.id}`, {
            headers: { cookie: migratedCookieHeader },
          });
          const invalidAssetRes = await fetch(`${fixture.address}/api/assets/${asset.id}`, {
            headers: { cookie: invalidCookieHeader },
          });
          const invalidSseRes = await fetch(`${fixture.address}/api/sse`, {
            headers: { cookie: invalidCookieHeader },
          });

          const validHistoryBody = await validHistoryRes.json() as { messages: Array<{ id: string; content: string }> };
          const invalidHistoryBody = await invalidHistoryRes.json() as { error: string };
          const invalidAssetBody = await invalidAssetRes.json() as { error: string };
          const invalidSseBody = await invalidSseRes.json() as { error: string };

          if (!validSseEvents.some((event) => event.event === "daily_summary")) {
            throw new Error("Valid SSE session did not emit daily_summary");
          }
          if (validHistoryRes.status !== 200) {
            throw new Error(`Expected valid history status 200, got ${validHistoryRes.status}`);
          }
          if (!validHistoryBody.messages.some((message) => message.id === historyMessage.id)) {
            throw new Error("Expected valid history to include the seeded message");
          }
          if (validAssetRes.status !== 200) {
            throw new Error(`Expected valid asset status 200, got ${validAssetRes.status}`);
          }
          if (invalidHistoryRes.status !== 401 || invalidHistoryBody.error !== "Invalid guest session") {
            throw new Error(`Expected invalid history to fail closed, got ${invalidHistoryRes.status}`);
          }
          if (invalidAssetRes.status !== 401 || invalidAssetBody.error !== "Invalid guest session") {
            throw new Error(`Expected invalid asset to fail closed, got ${invalidAssetRes.status}`);
          }
          if (invalidSseRes.status !== 401 || invalidSseBody.error !== "Invalid guest session") {
            throw new Error(`Expected invalid SSE to fail closed, got ${invalidSseRes.status}`);
          }

          artifacts.tampered_access_fail_closed = {
            historyMessageId: historyMessage.id,
            assetId: asset.id,
            validSseEvents,
            validHistory: {
              status: validHistoryRes.status,
              messages: validHistoryBody.messages,
            },
            validAsset: {
              status: validAssetRes.status,
              contentType: validAssetRes.headers.get("content-type"),
            },
            invalidHistory: {
              status: invalidHistoryRes.status,
              body: invalidHistoryBody,
            },
            invalidAsset: {
              status: invalidAssetRes.status,
              body: invalidAssetBody,
            },
            invalidSse: {
              status: invalidSseRes.status,
              body: invalidSseBody,
            },
          };
        } finally {
          clearTimeout(timeout);
          controller.abort();
          await reader?.cancel().catch(() => {});
        }

        steps.push(pass("tampered_access_fail_closed", artifacts.tampered_access_fail_closed));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push(fail("tampered_access_fail_closed", message, artifacts.tampered_access_fail_closed));
        return failResult("guest-session-hardening", steps, "tampered_access_fail_closed", artifacts);
      }

      try {
        const invalidCookieHeader = cookieHeaderFromJar(
          new Map([...parseCookieHeader(migratedCookieHeader).keys()].map((name) => [name, "invalid"])),
        );

        const rebuildEvidence = await runStoreFlow({
          app: fixture.app,
          storageSeed: { deviceId: fixture.deviceId },
          initialCookieHeader: invalidCookieHeader,
          tag: `guest-session-hardening-rebuild-${Date.now()}`,
          run: async (store, session, storage) => {
            const firstRecover = await store.getState().recoverGuestSession();
            const afterFirstRecover = snapshotStoreState(store.getState());
            const secondRecover = await store.getState().recoverGuestSession();
            const afterSecondRecover = snapshotStoreState(store.getState());
            await store.getState().rebuildGuestSession();
            const afterRebuild = snapshotStoreState(store.getState());

            return {
              firstRecover,
              secondRecover,
              afterFirstRecover,
              afterSecondRecover,
              afterRebuild,
              storage: Object.fromEntries(storage.entries()),
              calls: session.calls,
              cookieHeader: cookieHeaderFromJar(session.jar),
            };
          },
        }) as {
          firstRecover: boolean;
          secondRecover: boolean;
          afterFirstRecover: AppStateSnapshot;
          afterSecondRecover: AppStateSnapshot;
          afterRebuild: AppStateSnapshot;
          storage: Record<string, string>;
          calls: BrowserSessionCall[];
          cookieHeader: string;
        };

        const recoverCalls = rebuildEvidence.calls.filter((call) => call.method === "POST" && call.url === "/api/device/session");
        const clearCalls = rebuildEvidence.calls.filter((call) => call.method === "DELETE" && call.url === "/api/device/session");

        if (rebuildEvidence.firstRecover !== false) {
          throw new Error("Expected first recoverGuestSession call to fail");
        }
        if (rebuildEvidence.afterFirstRecover.deviceId !== fixture.deviceId) {
          throw new Error("Device ID should remain until explicit rebuild");
        }
        if (rebuildEvidence.afterFirstRecover.guestSessionStatus !== "recovery_required") {
          throw new Error(`Expected recovery_required, got ${rebuildEvidence.afterFirstRecover.guestSessionStatus}`);
        }
        if (rebuildEvidence.afterFirstRecover.guestSessionRecoveryAttempted !== true) {
          throw new Error("Expected recoveryAttempted after first failure");
        }
        if (rebuildEvidence.secondRecover !== false) {
          throw new Error("Expected second recoverGuestSession call to short-circuit");
        }
        if (recoverCalls.length !== 1) {
          throw new Error(`Expected exactly one recovery POST, got ${recoverCalls.length}`);
        }
        if (clearCalls.length !== 1) {
          throw new Error(`Expected exactly one clear-session DELETE, got ${clearCalls.length}`);
        }
        if (rebuildEvidence.afterRebuild.deviceId !== null || rebuildEvidence.afterRebuild.activeScreen !== "onboarding") {
          throw new Error("Rebuild should clear the guest identity and return to onboarding");
        }
        if (rebuildEvidence.afterRebuild.guestSessionStatus !== "ready") {
          throw new Error(`Expected ready after rebuild, got ${rebuildEvidence.afterRebuild.guestSessionStatus}`);
        }
        if ("deviceId" in rebuildEvidence.storage) {
          throw new Error("Rebuild should clear persisted deviceId");
        }

        artifacts.blocking_rebuild_flow = rebuildEvidence;
        steps.push(pass("blocking_rebuild_flow", artifacts.blocking_rebuild_flow));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push(fail("blocking_rebuild_flow", message, artifacts.blocking_rebuild_flow));
        return failResult("guest-session-hardening", steps, "blocking_rebuild_flow", artifacts);
      }

      return {
        ok: true,
        steps,
        artifacts,
        consoleSummary: `PASS guest-session-hardening ${steps.filter((step) => step.ok).length}/${STEP_NAMES.length}`,
      };
    } finally {
      await fixture.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
};

export default scenario;
