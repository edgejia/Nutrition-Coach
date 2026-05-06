import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

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

function assertLogEventsExclude(events: readonly Record<string, unknown>[], forbiddenValues: readonly string[]) {
  const serialized = events.map((event) => JSON.stringify(event)).join("\n");
  for (const value of forbiddenValues) {
    assert.ok(!serialized.includes(value), `expected logs to exclude ${value}`);
  }
}

describe("Device API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ dbPath: ":memory:", llmProvider: new MockLLMProvider() });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createGuestDevice(goal: "fat_loss" | "muscle_gain" = "fat_loss") {
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
    assert.equal(res.json().dailyTargets.protein, 150);
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
    assert.equal(res.json().dailyTargets.protein, 150);
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

  it("OBS-02: emits target_gen_fallback event when LLM returns invalid targets", async () => {
    const { logLines, logStream } = createLogCapture();

    const obs02LLM = new MockLLMProvider();
    // Queue 2 invalid responses — target-generation makes 2 attempts before fallback
    obs02LLM.queueChatResponse({ content: "not valid json at all" });
    obs02LLM.queueChatResponse({ content: "also not valid json" });

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
      },
    });

    await obs02App.close();

    // Response should still succeed (fallback targets used)
    assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);

    // Find target_gen_fallback event in captured log lines
    let fallbackEventFound = false;
    for (const line of logLines) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.event === "target_gen_fallback") {
        fallbackEventFound = true;
        assert.ok(
          typeof parsed.reason === "string" && parsed.reason.length > 0,
          `target_gen_fallback must have a non-empty reason field. Got: ${JSON.stringify(parsed)}`,
        );
        break;
      }
    }
    assert.ok(
      fallbackEventFound,
      `Expected a log line with event="target_gen_fallback" but none found. Lines captured: ${logLines.length}`,
    );
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
    obs01LLM.queueChatResponse({ content: "not valid json" });
    obs01LLM.queueChatResponse({ content: "still not valid json" });
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
    const deviceId = (create.json() as { deviceId: string }).deviceId;

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
    const unauthorized = await obs01App.inject({
      method: "PATCH",
      url: "/api/device/goals",
      payload: { fat: 65 },
    });

    await obs01App.close();

    assert.equal(nonObject.statusCode, 400);
    assert.equal(invalidField.statusCode, 400);
    assert.equal(emptyValidFields.statusCode, 400);
    assert.equal(negativeValue.statusCode, 400);
    assert.equal(unauthorized.statusCode, 401);

    const validationEvents = findLogEvents(logLines, "device_goals_validation_failed");
    assert.deepEqual(
      validationEvents.map((event) => pickEventMetadata(event, ["event", "fields", "codes"])),
      [
        { event: "device_goals_validation_failed", fields: [], codes: ["invalid_body"] },
        { event: "device_goals_validation_failed", fields: ["protein"], codes: ["invalid_field_value"] },
        { event: "device_goals_validation_failed", fields: [], codes: ["empty_valid_fields"] },
        { event: "device_goals_validation_failed", fields: ["calories"], codes: ["invalid_field_value"] },
      ],
    );

    for (const event of validationEvents) {
      for (const key of ["route", "method", "deviceId", "body", "value", "target"]) {
        assert.ok(!(key in event), `expected validation event to exclude metadata key ${key}`);
      }
    }
    assert.equal(findLogEvents(logLines, "device_goals_updated_rest").length, 0);
    assertLogEventsExclude(
      validationEvents.map((event) => pickEventMetadata(event, ["event", "fields", "codes"])),
      [deviceId, cookieHeader, "151", "2010", "65", "-1", "not-a-number"],
    );
  });
});
