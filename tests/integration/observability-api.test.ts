import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

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
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunk.toString()
        .split("\n")
        .filter(Boolean)
        .forEach((line: string) => lines.push(line));
      callback();
    },
  });

  return {
    stream,
    eventLogs() {
      return lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => typeof line.event === "string");
    },
    serialized() {
      return lines.join("\n");
    },
  };
}

describe("Observability API", () => {
  let app: FastifyInstance;
  let logs: ReturnType<typeof createLogCapture>;

  beforeEach(async () => {
    logs = createLogCapture();
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logs.stream },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createGuestDevice() {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    assert.equal(res.statusCode, 200);
    return {
      cookieHeader: toCookieHeader(res),
      deviceId: (res.json() as { deviceId: string }).deviceId,
    };
  }

  it("logs authenticated Home CTA intent events with redacted metadata only", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "POST",
      url: "/api/observability/client-event",
      headers: { cookie: create.cookieHeader },
      payload: {
        event: "home_cta_intent_selected",
        intent: "quick_log",
        prompt: "推薦三個便利商店高蛋白選擇",
        deviceId: create.deviceId,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });

    const eventLogs = logs.eventLogs().filter((line) => line.event === "home_cta_intent_selected");
    assert.equal(eventLogs.length, 1);
    assert.deepEqual(eventLogs[0], {
      level: eventLogs[0]?.level,
      time: eventLogs[0]?.time,
      pid: eventLogs[0]?.pid,
      hostname: eventLogs[0]?.hostname,
      reqId: eventLogs[0]?.reqId,
      event: "home_cta_intent_selected",
      intent: "quick_log",
      msg: eventLogs[0]?.msg,
    });

    const serialized = JSON.stringify(eventLogs[0]);
    assert.doesNotMatch(serialized, /prompt/);
    assert.doesNotMatch(serialized, /推薦三個便利商店高蛋白選擇/);
    assert.doesNotMatch(serialized, new RegExp(create.deviceId));
    assert.doesNotMatch(serialized, /deviceId/);
  });

  it("logs authenticated Home CTA option events with intent and promptKey only", async () => {
    const create = await createGuestDevice();

    const res = await app.inject({
      method: "POST",
      url: "/api/observability/client-event",
      headers: { cookie: create.cookieHeader },
      payload: {
        event: "home_cta_option_sent",
        intent: "quick_log",
        promptKey: "describe_meal",
        prompt: "assistant reply text",
        imagePath: "/tmp/uploads/photo.jpg",
        calories: 1800,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });

    const eventLogs = logs.eventLogs().filter((line) => line.event === "home_cta_option_sent");
    assert.equal(eventLogs.length, 1);
    assert.equal(eventLogs[0]?.intent, "quick_log");
    assert.equal(eventLogs[0]?.promptKey, "describe_meal");

    const serialized = JSON.stringify(eventLogs[0]);
    assert.doesNotMatch(serialized, /prompt/);
    assert.doesNotMatch(serialized, /assistant reply text/);
    assert.doesNotMatch(serialized, /imagePath/);
    assert.doesNotMatch(serialized, /photo\.jpg/);
    assert.doesNotMatch(serialized, /1800/);
  });

  it("requires a guest session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/observability/client-event",
      payload: { event: "home_cta_intent_selected", intent: "quick_log" },
    });

    assert.equal(res.statusCode, 401);
    assert.equal(logs.eventLogs().filter((line) => line.event === "home_cta_intent_selected").length, 0);
  });

  it("rejects invalid event bodies without logging client-event payloads", async () => {
    const create = await createGuestDevice();
    const invalidBodies = [
      { event: "chat_turn_completed", source: "sse" },
      { event: "home_cta_intent_selected", intent: "Quick Log" },
      { event: "home_cta_intent_selected", intent: "quick\nlog" },
      { event: "home_cta_option_sent", intent: "quick_log", promptKey: "x".repeat(65) },
      { event: "home_cta_option_sent", intent: "quick_log" },
    ];

    for (const body of invalidBodies) {
      const res = await app.inject({
        method: "POST",
        url: "/api/observability/client-event",
        headers: { cookie: create.cookieHeader },
        payload: body,
      });
      assert.equal(res.statusCode, 400);
    }

    const serialized = logs.serialized();
    assert.doesNotMatch(serialized, /quick\\nlog/);
    assert.equal(
      logs.eventLogs().filter((line) =>
        line.event === "home_cta_intent_selected" || line.event === "home_cta_option_sent"
      ).length,
      0,
    );
  });
});
