import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import Database from "better-sqlite3";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { applyMigrations } from "../../server/db/migrate.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";
import { UNSAFE_CALORIE_FLOOR_REASON } from "../../server/orchestrator/nutrition-safety-policy.js";
import { createDeviceService, getGoalDefaults, type Goal } from "../../server/services/device.js";

function getSetCookieHeaders(res: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  const rawHeader = res.headers["set-cookie"];
  if (Array.isArray(rawHeader)) {
    return rawHeader;
  }
  return typeof rawHeader === "string" ? [rawHeader] : [];
}

function toCookieHeader(res: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  return getSetCookieHeaders(res).map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieParts(cookieHeader: string) {
  return cookieHeader.split("; ").filter(Boolean);
}

function sessionCookieOnly(cookieHeader: string, name: "guest_session" | "guest_session_resume") {
  return cookieParts(cookieHeader).filter((part) => part.startsWith(`${name}=`)).join("; ");
}

function sessionCookiePair(setCookieHeaders: readonly string[]) {
  return setCookieHeaders.map((value) => value.split(";", 1)[0]).sort();
}

function assertClearSessionCookiesOnly(res: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  const setCookieHeaders = getSetCookieHeaders(res);
  assert.deepEqual(sessionCookiePair(setCookieHeaders), ["guest_session=", "guest_session_resume="]);
  assert.ok(setCookieHeaders.every((value) => /;\s*Max-Age=0(?:;|$)/.test(value)));
}

function assertRefreshedSessionCookies(res: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  const setCookieHeaders = getSetCookieHeaders(res);
  assert.equal(setCookieHeaders.length, 2);
  for (const name of ["guest_session", "guest_session_resume"] as const) {
    const header = setCookieHeaders.find((value) => value.startsWith(`${name}=`));
    assert.ok(header);
    assert.notEqual(header.split(";", 1)[0], `${name}=`);
    assert.ok(!/;\s*Max-Age=0(?:;|$)/.test(header));
  }
}

function createLogCapture() {
  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk, _, cb) {
      chunk.toString().split("\n").filter(Boolean).forEach((line: string) => logLines.push(line));
      cb();
    },
  });

  return { logLines, logStream };
}

function parseJsonLogLines(logLines: string[]) {
  return logLines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function findLogEvents(logLines: string[], event: string) {
  return parseJsonLogLines(logLines).filter((line) => line.event === event);
}

function pickEventMetadata(event: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, event[key]]));
}

function pickOnboardingMetadata(event: Record<string, unknown>) {
  if (event.event === "onboarding_submit_started") {
    return pickEventMetadata(event, ["event", "source"]);
  }
  if (event.event === "onboarding_validation_failed") {
    return pickEventMetadata(event, ["event", "source", "step", "fields", "codes"]);
  }
  return pickEventMetadata(event, ["event", "usedTargetFallback"]);
}

function pickTargetGenerationMetadata(event: Record<string, unknown>) {
  return pickEventMetadata(event, [
    "event",
    "attempt",
    "providerReason",
    "targetReason",
    "metadataContext",
    "issueCount",
    "fields",
    "codes",
    "noContentSubtype",
  ]);
}

function assertLogEventsExclude(events: readonly Record<string, unknown>[], forbiddenValues: readonly string[]) {
  const serialized = events.map((event) => JSON.stringify(event)).join("\n");
  for (const value of forbiddenValues) {
    assert.ok(!serialized.includes(value), `expected logs to exclude ${value}`);
  }
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
  assert.equal(typeof value, "number", `expected ${field} to be a number`);
  assert.ok(Number.isFinite(value), `expected ${field} to be finite`);
}

function assertDailyTargetsDto(value: unknown) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["calories", "carbs", "fat", "protein"]);
  assertFiniteNumber(value.calories, "dailyTargets.calories");
  assertFiniteNumber(value.protein, "dailyTargets.protein");
  assertFiniteNumber(value.carbs, "dailyTargets.carbs");
  assertFiniteNumber(value.fat, "dailyTargets.fat");
}

function assertGoalsResponseDto(value: unknown) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["dailyTargets"]);
  assertDailyTargetsDto(value.dailyTargets);
}

function assertLogEventApplicationKeys(event: Record<string, unknown>, allowedKeys: readonly string[]) {
  const pinoKeys = new Set(["level", "time", "pid", "hostname", "msg", "reqId"]);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(event)) {
    assert.ok(pinoKeys.has(key) || allowed.has(key), `expected ${event.event} event to exclude metadata key ${key}`);
  }
}

function extractTargetGenerationUserContent(mockLLM: MockLLMProvider, callIndex = 0): string {
  const content = mockLLM.objectCalls[callIndex]?.messages[1]?.content;
  if (typeof content !== "string") {
    throw new Error(`Missing target-generation user content for object call ${callIndex}`);
  }
  return content;
}

function readPersistedDeviceAge(dbPath: string, deviceId: string): number | null {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const row = sqlite.prepare("select age from devices where id = ?").get(deviceId) as { age: number | null } | undefined;
    return row?.age ?? null;
  } finally {
    sqlite.close();
  }
}

function createMigratedDeviceTestDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  try {
    applyMigrations(sqlite);
  } finally {
    sqlite.close();
  }
}

const deployedLikeLegacySessionProbeScript = `
const { Writable } = await import("node:stream");
const { buildApp } = await import("./server/app.ts");
const { MockLLMProvider } = await import("./server/llm/mock.ts");

const logLines = [];
const logStream = new Writable({
  write(chunk, _, cb) {
    chunk.toString().split("\\n").filter(Boolean).forEach((line) => logLines.push(line));
    cb();
  },
});

const app = await buildApp({
  dbPath: ":memory:",
  llmProvider: new MockLLMProvider(),
  logger: { level: "info", stream: logStream },
});
try {
  const create = await app.inject({
    method: "POST",
    url: "/api/device",
    payload: { goal: "fat_loss" },
  });
  const deviceId = create.json().deviceId;
  const requestPayload = { legacyDeviceId: deviceId };
  const session = await app.inject({
    method: "POST",
    url: "/api/device/session",
    payload: requestPayload,
  });
  const rawSetCookie = session.headers["set-cookie"];
  const setCookieHeaders = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : typeof rawSetCookie === "string"
      ? [rawSetCookie]
      : [];
  console.log(JSON.stringify({
    deviceId,
    requestBodyJson: JSON.stringify(requestPayload),
    statusCode: session.statusCode,
    setCookieHeaders,
    body: session.json(),
    logLines,
  }));
} finally {
  await app.close();
}
`;

function runDeployedLikeLegacySessionProbe() {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", deployedLikeLegacySessionProbeScript], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      TZ: "Asia/Taipei",
      GUEST_SESSION_COOKIE_SECURE: "true",
      GUEST_SESSION_SECRET: "test-guest-session-secret-strong-value",
      SOURCE_SHA: "0123456789abcdef0123456789abcdef01234567",
      CLIENT_DIST_DIR: ".nonexistent-device-probe-client-dist",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  const probeLine = result.stdout.trim().split("\n").at(-1);
  assert.ok(probeLine, output);
  return JSON.parse(probeLine) as {
    deviceId: string;
    requestBodyJson: string;
    statusCode: number;
    setCookieHeaders: string[];
    body: unknown;
    logLines: string[];
  };
}

describe("Device API", () => {
  let app: FastifyInstance;
  let services: AppServices | undefined;

  beforeEach(async () => {
    services = undefined;
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      onServicesReady(readyServices) {
        services = readyServices;
      },
    });
  });

  afterEach(async () => {
    await app.close();
    services = undefined;
  });

  async function createGuestDevice(goal: Goal = "fat_loss") {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal },
    });

    return {
      response: res,
      cookieHeader: toCookieHeader(res),
      ...(res.json() as { deviceId: string; dailyTargets: { calories: number; protein: number; carbs: number; fat: number } }),
    };
  }

  async function bumpDeviceSessionVersion(deviceId: string) {
    assert.ok(services, "expected onServicesReady to capture services");
    await createDeviceService(services.db).bumpSessionVersion(deviceId);
  }

  it("POST /api/device creates a device", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.deviceId);
    assert.equal(body.dailyTargets.calories, 1500);
    assert.equal(body.dailyTargets.protein, 120);
    assert.equal(body.usedFallback, false);
    const setCookieHeaders = getSetCookieHeaders(res);
    assert.equal(setCookieHeaders.length, 2);
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session=")));
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session_resume=")));
  });

  it("POST /api/device rejects invalid goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fly_to_moon" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("PUT /api/device/goals updates targets", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { protein: 150 },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as unknown;
    assertGoalsResponseDto(body);
    assertRecord(body);
    assertRecord(body.dailyTargets);
    assert.equal(body.dailyTargets.protein, 150);
  });

  it("PATCH /api/device/goals updates targets through the same guest-session contract", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { protein: 150 },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as unknown;
    assertGoalsResponseDto(body);
    assertRecord(body);
    assertRecord(body.dailyTargets);
    assert.equal(body.dailyTargets.protein, 150);
  });

  it("PUT /api/device/goals rejects below-floor calorie targets before persistence", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { calories: 500 },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), {
      error: "Unsafe calorie target",
      reason: UNSAFE_CALORIE_FLOOR_REASON,
    });

    const session = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: create.cookieHeader },
      payload: {},
    });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json().dailyTargets, create.dailyTargets);
  });

  it("PATCH /api/device/goals rejects below-floor calorie targets before persistence", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { calories: 500 },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), {
      error: "Unsafe calorie target",
      reason: UNSAFE_CALORIE_FLOOR_REASON,
    });

    const session = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: create.cookieHeader },
      payload: {},
    });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json().dailyTargets, create.dailyTargets);
  });

  it("PUT /api/device/goals rejects calorie-only exact-floor targets when persisted macros exceed calories", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { calories: 1200 },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), {
      error: "Macro targets exceed calorie target",
      reason: "macro_calorie_inconsistent",
    });

    const session = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: create.cookieHeader },
      payload: {},
    });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json().dailyTargets, create.dailyTargets);
  });

  it("PUT /api/device/goals allows complete macro-credible exact-floor targets", async () => {
    const create = await createGuestDevice();
    const exactFloorTargets = {
      calories: 1200,
      protein: 110,
      carbs: 110,
      fat: 35,
    };

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: exactFloorTargets,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as unknown;
    assertGoalsResponseDto(body);
    assertRecord(body);
    assertRecord(body.dailyTargets);
    assert.deepEqual(body.dailyTargets, exactFloorTargets);
  });

  it("PUT /api/device/goals projects only public dailyTargets", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: {
        protein: 150,
        requestEcho: "RAW_GOAL_REQUEST_SENTINEL",
        telemetry: { providerReason: "RAW_TELEMETRY_SENTINEL" },
        xDeviceId: "RAW_DEVICE_SENTINEL",
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as unknown;
    assertGoalsResponseDto(body);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "deviceId",
      "guest_session",
      "guest_session_resume",
      "requestEcho",
      "RAW_GOAL_REQUEST_SENTINEL",
      "telemetry",
      "RAW_TELEMETRY_SENTINEL",
      "RAW_DEVICE_SENTINEL",
      "providerReason",
      "targetReason",
      "metadataContext",
      "updatedFields",
    ]) {
      assert.ok(!serialized.includes(forbidden), `expected goals response to exclude ${forbidden}`);
    }
  });

  it("PUT /api/device/goals returns 401 without a guest session", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      payload: { protein: 150 },
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Guest session required" });
  });

  it("PUT /api/device/goals rejects unsupported multipart selectors at the shared boundary", async () => {
    const { logLines, logStream } = createLogCapture();
    const loggedApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    try {
      const create = await loggedApp.inject({
        method: "POST",
        url: "/api/device",
        payload: { goal: "fat_loss" },
      });
      const deviceId = create.json().deviceId as string;
      const boundary = "goals-boundary";
      const res = await loggedApp.inject({
        method: "PUT",
        url: "/api/device/goals",
        headers: {
          cookie: toCookieHeader(create),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: [
          `--${boundary}`,
          'Content-Disposition: form-data; name="deviceId"',
          "",
          deviceId,
          `--${boundary}--`,
          "",
        ].join("\r\n"),
      });

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.json(), { error: "Raw device selector is not allowed" });
      const events = findLogEvents(logLines, "ownership_bypass_blocked");
      assert.equal(events.length, 1);
      assert.equal(events[0]?.reason, "raw_device_id_param");
      assert.equal(events[0]?.route, "api_device_goals");
      assert.equal(events[0]?.operation, "device_goals_update");
      assertLogEventsExclude(events, [deviceId, "deviceId", "guest_session", "cookie"]);
    } finally {
      await loggedApp.close();
    }
  });

  it("POST /api/device creates a device with muscle_gain goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.deviceId);
    assert.equal(body.dailyTargets.calories, 2500);
    assert.equal(body.dailyTargets.protein, 180);
    assert.equal(body.usedFallback, false);
  });

  it("POST /api/device returns usedFallback false when generated targets are valid", async () => {
    const llmProvider = new MockLLMProvider();
    llmProvider.queueObjectContent(JSON.stringify({
      calories: 1800,
      protein: 120,
      carbs: 210,
      fat: 53,
      coachExplanation: "以穩定赤字開始，保留訓練表現。",
    }));
    const generatedApp = await buildApp({ dbPath: ":memory:", llmProvider });

    const res = await generatedApp.inject({
      method: "POST",
      url: "/api/device",
      payload: {
        goal: "fat_loss",
        sex: "female",
        age: 30,
        heightCm: 165,
        weightKg: 60,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), ["coachExplanation", "dailyTargets", "deviceId", "usedFallback"]);
    assert.equal(body.dailyTargets.calories, 1800);
    assert.equal(body.dailyTargets.protein, 120);
    assert.equal(body.dailyTargets.carbs, 210);
    assert.equal(body.dailyTargets.fat, 53);
    assert.equal(body.coachExplanation, "以穩定赤字開始，保留訓練表現。");
    assert.equal(body.usedFallback, false);
    assertLogEventsExclude([body], [
      "providerReason",
      "targetReason",
      "metadataContext",
      "issueCount",
      "fields",
      "codes",
      "noContentSubtype",
      "raw",
      "body",
      "headers",
    ]);
    assert.equal(llmProvider.objectCalls.length, 1);
    assert.equal(llmProvider.chatCalls.length, 0);

    const session = await generatedApp.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: toCookieHeader(res) },
      payload: {},
    });

    await generatedApp.close();

    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json(), {
      deviceId: body.deviceId,
      goal: "fat_loss",
      dailyTargets: body.dailyTargets,
      establishedBy: "active",
    });
  });

  it("POST /api/device sends submitted age to target generation and persists it", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-device-age-"));
    const dbPath = path.join(tempRoot, "nutrition.db");
    let ageApp: FastifyInstance | undefined;

    try {
      createMigratedDeviceTestDb(dbPath);

      const llmProvider = new MockLLMProvider();
      llmProvider.queueObjectContent(JSON.stringify({
        calories: 1800,
        protein: 120,
        carbs: 210,
        fat: 53,
        coachExplanation: "以目前資料建立第一版目標。",
      }));
      ageApp = await buildApp({ dbPath, llmProvider });

      const res = await ageApp.inject({
        method: "POST",
        url: "/api/device",
        payload: {
          goal: "fat_loss",
          sex: "female",
          age: 41,
          heightCm: 165,
          weightKg: 60,
          activityLevel: "moderate",
          trainingFrequency: "3_4",
        },
      });

      assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);
      const body = res.json() as {
        coachExplanation: string;
        dailyTargets: unknown;
        deviceId: string;
        usedFallback: boolean;
      };
      assert.deepEqual(Object.keys(body).sort(), ["coachExplanation", "dailyTargets", "deviceId", "usedFallback"]);
      assertDailyTargetsDto(body.dailyTargets);
      assert.equal(body.usedFallback, false);
      assert.equal(llmProvider.objectCalls.length, 1);
      assert.equal(llmProvider.chatCalls.length, 0);

      const userContent = extractTargetGenerationUserContent(llmProvider);
      assert.match(userContent, /"age": 41/);
      assert.doesNotMatch(userContent, /"age": 30/);
      assert.equal(readPersistedDeviceAge(dbPath, body.deviceId), 41);
    } finally {
      await ageApp?.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("POST /api/device returns usedFallback true when target generation falls back", async () => {
    const llmProvider = new MockLLMProvider();
    llmProvider.queueObjectNoContent("empty_content");
    llmProvider.queueObjectProviderError();
    const fallbackApp = await buildApp({ dbPath: ":memory:", llmProvider });

    const res = await fallbackApp.inject({
      method: "POST",
      url: "/api/device",
      payload: {
        goal: "fat_loss",
        sex: "female",
        age: 30,
        heightCm: 165,
        weightKg: 60,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
      },
    });

    await fallbackApp.close();

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.dailyTargets.calories, 1500);
    assert.equal(body.coachExplanation, "先用預設目標，之後可再微調。");
    assert.equal(body.usedFallback, true);
    assert.equal(llmProvider.objectCalls.length, 2);
    assert.equal(llmProvider.chatCalls.length, 0);
  });

  it("POST /api/device/session migrates a legacy device into cookie-backed mode", async () => {
    const create = await createGuestDevice();
    const { deviceId, dailyTargets } = create;

    const res = await app.inject({
      method: "POST",
      url: "/api/device/session",
      payload: { legacyDeviceId: deviceId },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      deviceId,
      goal: "fat_loss",
      dailyTargets,
      establishedBy: "legacy_migration",
    });
    const setCookieHeaders = getSetCookieHeaders(res);
    assert.equal(setCookieHeaders.length, 2);
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session=")));
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session_resume=")));
  });

  it("POST /api/device/session rejects stale active cookies after the device session version changes", async () => {
    const create = await createGuestDevice();
    await bumpDeviceSessionVersion(create.deviceId);

    const res = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: create.cookieHeader },
      payload: {},
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Invalid guest session" });
    assert.deepEqual(
      getSetCookieHeaders(res).map((value) => value.split(";", 1)[0]).sort(),
      ["guest_session=", "guest_session_resume="],
    );
  });

  it("POST /api/device/session rejects stale resume cookies without issuing replacements", async () => {
    const create = await createGuestDevice();
    const resumeOnlyCookie = create.cookieHeader
      .split("; ")
      .filter((cookie) => cookie.startsWith("guest_session_resume="))
      .join("; ");
    await bumpDeviceSessionVersion(create.deviceId);

    const res = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: resumeOnlyCookie },
      payload: {},
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Invalid guest session" });
    assert.deepEqual(
      getSetCookieHeaders(res).map((value) => value.split(";", 1)[0]).sort(),
      ["guest_session=", "guest_session_resume="],
    );
  });

  it("malformed percent-encoded guest-session cookies fail closed without 500s", async () => {
    const malformedCookieHeader = "guest_session=%; guest_session_resume=%E0%A4%A";
    const protectedRoute = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: malformedCookieHeader },
      payload: { protein: 151 },
    });

    assert.equal(protectedRoute.statusCode, 401);
    assert.deepEqual(protectedRoute.json(), { error: "Invalid guest session" });
    assertClearSessionCookiesOnly(protectedRoute);

    const sessionRoute = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: malformedCookieHeader },
      payload: {},
    });

    assert.equal(sessionRoute.statusCode, 401);
    assert.deepEqual(sessionRoute.json(), { error: "Invalid guest session" });
    assertClearSessionCookiesOnly(sessionRoute);
  });

  it("POST /api/device/session issues refreshed cookies only for current-version resume cookies", async () => {
    const create = await createGuestDevice();
    const resumeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session_resume");

    const res = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: resumeOnlyCookie },
      payload: {},
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().establishedBy, "resume");
    const setCookieHeaders = getSetCookieHeaders(res);
    assert.equal(setCookieHeaders.length, 2);
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session=")));
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session_resume=")));
  });

  it("copied-token resume-only session establishes before active-authority logout", async () => {
    const create = await createGuestDevice();
    const resumeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session_resume");

    const copiedResume = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: resumeOnlyCookie },
      payload: {},
    });

    assert.equal(copiedResume.statusCode, 200);
    assert.deepEqual(copiedResume.json(), {
      deviceId: create.deviceId,
      goal: "fat_loss",
      dailyTargets: create.dailyTargets,
      establishedBy: "resume",
    });
    assertRefreshedSessionCookies(copiedResume);
  });

  it("stale-token resume-only session fails after active-authority logout without refreshed session cookies", async () => {
    const create = await createGuestDevice();
    const activeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session");
    const resumeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session_resume");

    const logout = await app.inject({
      method: "DELETE",
      url: "/api/device/session",
      headers: { cookie: activeOnlyCookie },
    });
    assert.equal(logout.statusCode, 204);
    assertClearSessionCookiesOnly(logout);

    const staleResume = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: resumeOnlyCookie },
      payload: {},
    });

    assert.equal(staleResume.statusCode, 401);
    assert.deepEqual(staleResume.json(), { error: "Invalid guest session" });
    assertClearSessionCookiesOnly(staleResume);
  });

  it("stale-token active session and protected route fail after logout without refreshed session cookies", async () => {
    const create = await createGuestDevice();
    const activeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session");

    const logout = await app.inject({
      method: "DELETE",
      url: "/api/device/session",
      headers: { cookie: activeOnlyCookie },
    });
    assert.equal(logout.statusCode, 204);
    assertClearSessionCookiesOnly(logout);

    const staleActive = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: activeOnlyCookie },
      payload: {},
    });
    assert.equal(staleActive.statusCode, 401);
    assert.deepEqual(staleActive.json(), { error: "Invalid guest session" });
    assertClearSessionCookiesOnly(staleActive);

    const protectedRoute = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { protein: 151 },
    });
    assert.equal(protectedRoute.statusCode, 401);
    assert.notEqual(protectedRoute.statusCode, 500);
    assert.deepEqual(protectedRoute.json(), { error: "Invalid guest session" });
    assertClearSessionCookiesOnly(protectedRoute);
  });

  it("resume-authority logout bumps session version and invalidates the original active token", async () => {
    const create = await createGuestDevice();
    const activeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session");
    const resumeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session_resume");

    const logout = await app.inject({
      method: "DELETE",
      url: "/api/device/session",
      headers: { cookie: resumeOnlyCookie },
    });
    assert.equal(logout.statusCode, 204);
    assertClearSessionCookiesOnly(logout);

    const staleActive = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: activeOnlyCookie },
      payload: {},
    });
    assert.equal(staleActive.statusCode, 401);
    assert.deepEqual(staleActive.json(), { error: "Invalid guest session" });
    assertClearSessionCookiesOnly(staleActive);
  });

  it("no-valid-token logout clears only and leaves valid-token session current", async () => {
    const create = await createGuestDevice();
    const activeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session");

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/device/session",
    });
    assert.equal(missing.statusCode, 204);
    assertClearSessionCookiesOnly(missing);

    const invalid = await app.inject({
      method: "DELETE",
      url: "/api/device/session",
      headers: { cookie: "guest_session=invalid; guest_session_resume=invalid" },
    });
    assert.equal(invalid.statusCode, 204);
    assertClearSessionCookiesOnly(invalid);

    const stillCurrent = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: activeOnlyCookie },
      payload: {},
    });
    assert.equal(stillCurrent.statusCode, 200);
    assert.equal(stillCurrent.json().establishedBy, "active");
    assert.deepEqual(getSetCookieHeaders(stillCurrent), []);
  });

  it("valid-token resume sliding does not bump session version before explicit logout", async () => {
    const create = await createGuestDevice();
    const activeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session");
    const resumeOnlyCookie = sessionCookieOnly(create.cookieHeader, "guest_session_resume");

    const resumed = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: resumeOnlyCookie },
      payload: {},
    });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.json().establishedBy, "resume");
    assertRefreshedSessionCookies(resumed);

    const originalActive = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: activeOnlyCookie },
      payload: { carbs: 145 },
    });
    assert.equal(originalActive.statusCode, 200);
    assert.deepEqual(getSetCookieHeaders(originalActive), []);

    const logout = await app.inject({
      method: "DELETE",
      url: "/api/device/session",
      headers: { cookie: activeOnlyCookie },
    });
    assert.equal(logout.statusCode, 204);
    assertClearSessionCookiesOnly(logout);
  });

  it("POST /api/device/session accepts only explicit legacyDeviceId as legacy bootstrap authority", async () => {
    const create = await createGuestDevice();

    const allowedLegacy = await app.inject({
      method: "POST",
      url: "/api/device/session",
      payload: { legacyDeviceId: create.deviceId },
    });
    assert.equal(allowedLegacy.statusCode, 200);
    assert.equal(allowedLegacy.json().establishedBy, "legacy_migration");
    assert.equal(getSetCookieHeaders(allowedLegacy).length, 2);

    const rawSelectorCases = [
      {
        name: "body deviceId",
        request: {
          method: "POST" as const,
          url: "/api/device/session",
          payload: { deviceId: create.deviceId },
        },
      },
      {
        name: "query deviceId",
        request: {
          method: "POST" as const,
          url: `/api/device/session?deviceId=${encodeURIComponent(create.deviceId)}`,
          payload: {},
        },
      },
      {
        name: "x-device-id header",
        request: {
          method: "POST" as const,
          url: "/api/device/session",
          headers: { "x-device-id": create.deviceId },
          payload: {},
        },
      },
    ];

    for (const { name, request } of rawSelectorCases) {
      const res = await app.inject(request);
      assert.equal(res.statusCode, 401, name);
      assert.deepEqual(res.json(), { error: "No guest session available" });
      assert.deepEqual(getSetCookieHeaders(res), [], name);
    }

    const ambiguous = await app.inject({
      method: "POST",
      url: "/api/device/session",
      payload: { legacyDeviceId: create.deviceId, deviceId: create.deviceId },
    });
    assert.equal(ambiguous.statusCode, 400);
    assert.deepEqual(getSetCookieHeaders(ambiguous), []);
  });

  it("POST /api/device/session rejects raw legacy device ids in deployed-like runtime without cookies", () => {
    const result = runDeployedLikeLegacySessionProbe();

    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.setCookieHeaders, []);

    const events = findLogEvents(result.logLines, "ownership_bypass_blocked");
    assert.equal(events.length, 1);
    assert.deepEqual(pickEventMetadata(events[0]!, ["event", "reason", "route", "operation"]), {
      event: "ownership_bypass_blocked",
      reason: "legacy_device_id_rejected",
      route: "api_device_session",
      operation: "legacy_session_bootstrap",
    });
    assert.equal(typeof events[0]!.requestId, "string");
    assertLogEventApplicationKeys(events[0]!, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude(
      [events[0]!],
      [
        result.deviceId,
        "legacyDeviceId",
        "guest_session",
        "guest_session_resume",
        "cookie",
        "x-device-id",
        result.requestBodyJson,
        "forged_signature",
      ],
    );
  });

  it("POST /api/device/session preserves maintain goal for active and legacy sessions", async () => {
    const create = await createGuestDevice("maintain");
    const { deviceId, dailyTargets, cookieHeader } = create;

    const active = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: cookieHeader },
      payload: {},
    });
    const legacy = await app.inject({
      method: "POST",
      url: "/api/device/session",
      payload: { legacyDeviceId: deviceId },
    });

    assert.equal(active.statusCode, 200);
    assert.deepEqual(active.json(), {
      deviceId,
      goal: "maintain",
      dailyTargets,
      establishedBy: "active",
    });
    assert.equal(legacy.statusCode, 200);
    assert.deepEqual(legacy.json(), {
      deviceId,
      goal: "maintain",
      dailyTargets,
      establishedBy: "legacy_migration",
    });
  });

  it("POST /api/device/session rejects invalid legacy device ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device/session",
      payload: { legacyDeviceId: "missing-device" },
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Invalid device ID" });
  });

  it("PUT /api/device/goals rejects negative values", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { calories: -100 },
    });
    assert.equal(res.statusCode, 400);
  });

  it("PUT /api/device/goals returns 401 with invalid guest-session cookies", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: "guest_session=invalid; guest_session_resume=invalid" },
      payload: { protein: 150 },
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Invalid guest session" });
  });

  it("device goals aliases reject raw ownership selectors with metadata-only events", async () => {
    const { logLines, logStream } = createLogCapture();
    const loggedApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    try {
      const create = await loggedApp.inject({
        method: "POST",
        url: "/api/device",
        payload: { goal: "fat_loss" },
      });
      assert.equal(create.statusCode, 200);
      const deviceId = (create.json() as { deviceId: string }).deviceId;
      const cookieHeader = toCookieHeader(create);
      const cookieMaterial = cookieHeader.split(";", 1)[0] ?? cookieHeader;
      const requestBodies = [
        { protein: 151, deviceId },
        { protein: 152 },
        { protein: 153 },
      ];
      const rawSelectorRequests = [
        {
          method: "PATCH" as const,
          url: "/api/device/goals",
          headers: { cookie: cookieHeader },
          payload: requestBodies[0],
        },
        {
          method: "PUT" as const,
          url: `/api/device/goals?deviceId=${encodeURIComponent(deviceId)}`,
          headers: { cookie: cookieHeader },
          payload: requestBodies[1],
        },
        {
          method: "PUT" as const,
          url: "/api/device/goals",
          headers: { cookie: cookieHeader, "x-device-id": deviceId },
          payload: requestBodies[2],
        },
      ];

      for (const request of rawSelectorRequests) {
        const res = await loggedApp.inject(request);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.json(), { error: "Raw device selector is not allowed" });
      }

      const events = findLogEvents(logLines, "ownership_bypass_blocked");
      assert.equal(events.length, rawSelectorRequests.length);
      for (const event of events) {
        assert.deepEqual(pickEventMetadata(event, ["event", "reason", "route", "operation"]), {
          event: "ownership_bypass_blocked",
          reason: "raw_device_id_param",
          route: "api_device_goals",
          operation: "device_goals_update",
        });
        assert.equal(typeof event.requestId, "string");
        assertLogEventApplicationKeys(event, ["event", "reason", "route", "operation", "requestId"]);
      }
      assertLogEventsExclude(events, [
        deviceId,
        "deviceId",
        "x-device-id",
        "guest_session",
        "guest_session_resume",
        "cookie",
        cookieMaterial,
        ...requestBodies.map((body) => JSON.stringify(body)),
      ]);
    } finally {
      await loggedApp.close();
    }
  });

  it("PUT /api/device/goals returns 400 for null body", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: {
        cookie: create.cookieHeader,
        "content-type": "application/json",
      },
      body: "null",
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for array body", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: {
        cookie: create.cookieHeader,
        "content-type": "application/json",
      },
      body: "[1,2,3]",
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for string body", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: {
        cookie: create.cookieHeader,
        "content-type": "application/json",
      },
      body: '"hello"',
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for empty object body", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for unknown-only keys", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { sodium: 1 },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for string field value", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { protein: "150" },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for null field value", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: create.cookieHeader },
      payload: { protein: null },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("OBS-02: falls back, persists defaults, and logs sanitized target-generation failures for invalid structured output", async () => {
    const { logLines, logStream } = createLogCapture();

    const obs02LLM = new MockLLMProvider();
    obs02LLM.queueObjectContent(JSON.stringify({
      calories: 9999,
      protein: 210,
      carbs: 800,
      fat: 500,
      coachExplanation: "RAW_MODEL_SENTINEL",
    }));
    obs02LLM.queueObjectProviderError();

    const obs02App = await buildApp({
      dbPath: ":memory:",
      llmProvider: obs02LLM,
      logger: { level: "info", stream: logStream },
    });

    // POST /api/device with full intake fields to trigger generateTargets
    const res = await obs02App.inject({
      method: "POST",
      url: "/api/device",
      payload: {
        goal: "fat_loss",
        sex: "female",
        age: 30,
        heightCm: 165,
        weightKg: 60,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
        allergies: "INTAKE_ALLERGY_SENTINEL",
        goalClarification: "INTAKE_GOAL_SENTINEL",
        advancedNotes: "INTAKE_NOTES_SENTINEL",
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);
    const body = res.json() as {
      deviceId: string;
      dailyTargets: { calories: number; protein: number; carbs: number; fat: number };
      coachExplanation: string;
      usedFallback: boolean;
    };
    const fallbackTargets = getGoalDefaults("fat_loss");
    assert.deepEqual(body.dailyTargets, fallbackTargets);
    assert.equal(body.coachExplanation, "先用預設目標，之後可再微調。");
    assert.equal(body.usedFallback, true);
    assert.equal(obs02LLM.objectCalls.length, 2);
    assert.equal(obs02LLM.chatCalls.length, 0);

    const cookieHeader = toCookieHeader(res);
    const session = await obs02App.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: cookieHeader },
      payload: {},
    });

    await obs02App.close();

    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json(), {
      deviceId: body.deviceId,
      goal: "fat_loss",
      dailyTargets: fallbackTargets,
      establishedBy: "active",
    });

    const attemptEvents = findLogEvents(logLines, "target_generation_attempt_failed");
    assert.equal(attemptEvents.length, 2);
    assert.deepEqual(attemptEvents.map(pickTargetGenerationMetadata), [
      {
        event: "target_generation_attempt_failed",
        attempt: 1,
        providerReason: "schema_validation",
        targetReason: "bounds_failed",
        metadataContext: "target_generation",
        issueCount: 1,
        fields: ["calories"],
        codes: ["bounds_failed"],
        noContentSubtype: undefined,
      },
      {
        event: "target_generation_attempt_failed",
        attempt: 2,
        providerReason: "provider_error",
        targetReason: "provider_error",
        metadataContext: "target_generation",
        issueCount: undefined,
        fields: undefined,
        codes: undefined,
        noContentSubtype: undefined,
      },
    ]);
    const fallbackEvents = findLogEvents(logLines, "target_generation_fallback_used");
    assert.equal(fallbackEvents.length, 1);
    assert.deepEqual(pickTargetGenerationMetadata(fallbackEvents[0]!), {
      event: "target_generation_fallback_used",
      attempt: 2,
      providerReason: "provider_error",
      targetReason: "provider_error",
      metadataContext: "target_generation",
      issueCount: undefined,
      fields: undefined,
      codes: undefined,
      noContentSubtype: undefined,
    });
    assert.deepEqual(
      findLogEvents(logLines, "onboarding_submit_succeeded").map((event) =>
        pickEventMetadata(event, ["event", "usedTargetFallback"]),
      ),
      [{ event: "onboarding_submit_succeeded", usedTargetFallback: true }],
    );

    const allowedTargetKeys = [
      "event",
      "attempt",
      "providerReason",
      "targetReason",
      "metadataContext",
      "issueCount",
      "fields",
      "codes",
      "noContentSubtype",
    ];
    for (const event of [...attemptEvents, ...fallbackEvents]) {
      assertLogEventApplicationKeys(event, allowedTargetKeys);
    }
    const targetGenerationPayloads = [...attemptEvents, ...fallbackEvents].map(pickTargetGenerationMetadata);
    const onboardingPayloads = findLogEvents(logLines, "onboarding_submit_succeeded").map(pickOnboardingMetadata);
    assertLogEventsExclude([...targetGenerationPayloads, ...onboardingPayloads], [
      body.deviceId,
      cookieHeader,
      "guest_session",
      "guest_session_resume",
      "INTAKE_ALLERGY_SENTINEL",
      "INTAKE_GOAL_SENTINEL",
      "INTAKE_NOTES_SENTINEL",
      "RAW_MODEL_SENTINEL",
      "9999",
      "210",
      "800",
      "500",
      String(fallbackTargets.calories),
      String(fallbackTargets.protein),
      String(fallbackTargets.carbs),
      String(fallbackTargets.fat),
      "minimum",
      "maximum",
      "too_big",
      "provider body",
      "provider header",
      "authorization",
      "bearer",
      "session",
      "validation error",
    ]);
  });

  it("OBS-01: logs onboarding validation failure with redacted fields and codes", async () => {
    const { logLines, logStream } = createLogCapture();
    const obs01App = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    const res = await obs01App.inject({
      method: "POST",
      url: "/api/device",
      payload: {
        goal: "fat_loss",
        sex: "female",
        age: 9,
        heightCm: 49,
        weightKg: 60,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
        allergies: "秘密花生過敏",
        advancedNotes: "不要把這段備註寫進 log",
      },
    });

    await obs01App.close();

    assert.equal(res.statusCode, 400);
    assert.deepEqual(
      findLogEvents(logLines, "onboarding_submit_started").map((event) => event.source),
      ["server"],
    );

    const failedEvents = findLogEvents(logLines, "onboarding_validation_failed");
    assert.equal(failedEvents.length, 1);
    assert.deepEqual(pickEventMetadata(failedEvents[0]!, ["event", "source", "step", "fields", "codes"]), {
      event: "onboarding_validation_failed",
      source: "server",
      step: 3,
      fields: ["age", "heightCm"],
      codes: ["AGE_OUT_OF_RANGE", "HEIGHT_OUT_OF_RANGE"],
    });
    assert.equal(findLogEvents(logLines, "onboarding_submit_succeeded").length, 0);
    assertLogEventsExclude(failedEvents, ["秘密花生過敏", "不要把這段備註寫進 log"]);
  });

  it("OBS-01: logs goal-only onboarding success without generated targets or device id", async () => {
    const { logLines, logStream } = createLogCapture();
    const obs01App = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    const res = await obs01App.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });

    await obs01App.close();

    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      deviceId: string;
      dailyTargets: { calories: number; protein: number; carbs: number; fat: number };
    };
    assert.deepEqual(
      findLogEvents(logLines, "onboarding_submit_started").map((event) => event.source),
      ["server"],
    );
    assert.deepEqual(
      findLogEvents(logLines, "onboarding_submit_succeeded").map((event) =>
        pickEventMetadata(event, ["event", "usedTargetFallback"]),
      ),
      [{ event: "onboarding_submit_succeeded", usedTargetFallback: false }],
    );
    assert.equal(findLogEvents(logLines, "onboarding_validation_failed").length, 0);
    assertLogEventsExclude(
      findLogEvents(logLines, "onboarding_submit_succeeded").map((event) =>
        pickEventMetadata(event, ["event", "usedTargetFallback"]),
      ),
      [
        body.deviceId,
        String(body.dailyTargets.calories),
        String(body.dailyTargets.protein),
        String(body.dailyTargets.carbs),
        String(body.dailyTargets.fat),
      ],
    );
  });

  it("OBS-01: logs intake onboarding success with fallback status only", async () => {
    const { logLines, logStream } = createLogCapture();
    const obs01LLM = new MockLLMProvider();
    obs01LLM.queueObjectContent("not valid json");
    obs01LLM.queueObjectContent("still not valid json");
    const obs01App = await buildApp({
      dbPath: ":memory:",
      llmProvider: obs01LLM,
      logger: { level: "info", stream: logStream },
    });

    const res = await obs01App.inject({
      method: "POST",
      url: "/api/device",
      payload: {
        goal: "fat_loss",
        sex: "female",
        age: 30,
        heightCm: 165,
        weightKg: 60,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
        allergies: "秘密花生過敏",
        goalClarification: "想在夏天前減脂",
        bodyFatPercent: 24,
        tdee: 1900,
        advancedNotes: "不要把這段備註寫進 log",
      },
    });

    await obs01App.close();

    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      deviceId: string;
      dailyTargets: { calories: number; protein: number; carbs: number; fat: number };
    };
    assert.deepEqual(
      findLogEvents(logLines, "onboarding_submit_started").map((event) => event.source),
      ["server"],
    );
    assert.deepEqual(
      findLogEvents(logLines, "onboarding_submit_succeeded").map((event) =>
        pickEventMetadata(event, ["event", "usedTargetFallback"]),
      ),
      [{ event: "onboarding_submit_succeeded", usedTargetFallback: true }],
    );

    const onboardingEvents = parseJsonLogLines(logLines).filter(
      (event) => typeof event.event === "string" && event.event.startsWith("onboarding_"),
    );
    assertLogEventsExclude(onboardingEvents.map(pickOnboardingMetadata), [
      body.deviceId,
      "秘密花生過敏",
      "想在夏天前減脂",
      "不要把這段備註寫進 log",
      String(body.dailyTargets.calories),
      String(body.dailyTargets.protein),
      String(body.dailyTargets.carbs),
      String(body.dailyTargets.fat),
    ]);
  });

  it("OBS-03: logs REST goal updates by field name only", async () => {
    const { logLines, logStream } = createLogCapture();
    const obs03App = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    const create = await obs03App.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const cookieHeader = toCookieHeader(create);
    const deviceId = (create.json() as { deviceId: string }).deviceId;

    const res = await obs03App.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { protein: 151, calories: 2010, fat: 65 },
    });

    await obs03App.close();

    assert.equal(res.statusCode, 200);
    const events = findLogEvents(logLines, "device_goals_updated_rest");
    assert.equal(events.length, 1);
    assert.deepEqual(pickEventMetadata(events[0]!, ["event", "updatedFields"]), {
      event: "device_goals_updated_rest",
      updatedFields: ["calories", "fat", "protein"],
    });
    assertLogEventsExclude(
      events.map((event) => pickEventMetadata(event, ["event", "updatedFields"])),
      [deviceId, "151", "2010", "65"],
    );
  });

  it("OBS-03: does not log successful REST goal updates for invalid or unauthorized requests", async () => {
    const { logLines, logStream } = createLogCapture();
    const obs03App = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    const create = await obs03App.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const cookieHeader = toCookieHeader(create);

    const invalid = await obs03App.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { protein: "151" },
    });
    const unauthorized = await obs03App.inject({
      method: "PUT",
      url: "/api/device/goals",
      payload: { protein: 151 },
    });

    await obs03App.close();

    assert.equal(invalid.statusCode, 400);
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(findLogEvents(logLines, "device_goals_updated_rest").length, 0);
  });

  it("OBS-01: logs goal validation failures with redacted fields and locked codes", async () => {
    const { logLines, logStream } = createLogCapture();
    const obs01App = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    const create = await obs01App.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const cookieHeader = toCookieHeader(create);
    const { deviceId, dailyTargets: originalTargets } = create.json() as {
      deviceId: string;
      dailyTargets: { calories: number; protein: number; carbs: number; fat: number };
    };

    const nonObject = await obs01App.inject({
      method: "PATCH",
      url: "/api/device/goals",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json",
      },
      body: "null",
    });
    const invalidField = await obs01App.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { protein: "151" },
    });
    const emptyValidFields = await obs01App.inject({
      method: "PATCH",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { timezone: "Asia/Taipei" },
    });
    const negativeValue = await obs01App.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { calories: -1 },
    });
    const caloriesTooHigh = await obs01App.inject({
      method: "PATCH",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { calories: 8001 },
    });
    const proteinTooHigh = await obs01App.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { protein: 401 },
    });
    const carbsTooHigh = await obs01App.inject({
      method: "PATCH",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { carbs: 1001 },
    });
    const fatTooHigh = await obs01App.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { fat: 301 },
    });
    const caloriesTooLow = await obs01App.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { cookie: cookieHeader },
      payload: { calories: 499 },
    });
    const unauthorized = await obs01App.inject({
      method: "PATCH",
      url: "/api/device/goals",
      payload: { fat: 65 },
    });
    const session = await obs01App.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: cookieHeader },
      payload: {},
    });

    await obs01App.close();

    assert.equal(nonObject.statusCode, 400);
    assert.equal(invalidField.statusCode, 400);
    assert.equal(emptyValidFields.statusCode, 400);
    assert.equal(negativeValue.statusCode, 400);
    assert.equal(caloriesTooHigh.statusCode, 400);
    assert.equal(proteinTooHigh.statusCode, 400);
    assert.equal(carbsTooHigh.statusCode, 400);
    assert.equal(fatTooHigh.statusCode, 400);
    assert.equal(caloriesTooLow.statusCode, 400);
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json().dailyTargets, originalTargets);

    const validationEvents = findLogEvents(logLines, "device_goals_validation_failed");
    assert.deepEqual(
      validationEvents.map((event) => pickEventMetadata(event, ["event", "fields", "codes"])),
      [
        { event: "device_goals_validation_failed", fields: [], codes: ["invalid_body"] },
        { event: "device_goals_validation_failed", fields: ["protein"], codes: ["invalid_field_value"] },
        { event: "device_goals_validation_failed", fields: [], codes: ["empty_valid_fields"] },
        { event: "device_goals_validation_failed", fields: ["calories"], codes: ["invalid_field_value"] },
        { event: "device_goals_validation_failed", fields: ["calories"], codes: ["invalid_field_value"] },
        { event: "device_goals_validation_failed", fields: ["protein"], codes: ["invalid_field_value"] },
        { event: "device_goals_validation_failed", fields: ["carbs"], codes: ["invalid_field_value"] },
        { event: "device_goals_validation_failed", fields: ["fat"], codes: ["invalid_field_value"] },
        { event: "device_goals_validation_failed", fields: ["calories"], codes: ["invalid_field_value"] },
      ],
    );

    for (const event of validationEvents) {
      for (const key of ["route", "method", "deviceId", "body", "value", "target", "min", "max", "actual", "received"]) {
        assert.ok(!(key in event), `expected validation event to exclude metadata key ${key}`);
      }
    }
    assert.equal(findLogEvents(logLines, "device_goals_updated_rest").length, 0);
    const validationPayloads = validationEvents.map(
      ({ level: _level, time: _time, pid: _pid, hostname: _hostname, msg: _msg, ...payload }) => payload,
    );
    assertLogEventsExclude(
      validationPayloads,
      [deviceId, cookieHeader, "151", "2010", "65", "-1", "8001", "401", "1001", "301", "499", "not-a-number"],
    );
  });
});
