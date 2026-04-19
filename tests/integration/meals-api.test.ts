process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { formatLocalDate } from "../../server/lib/time.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Meals API", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let deviceId: string;
  let otherDeviceId: string;
  let tempRoot: string;
  let uploadsDir: string;
  let assetsDir: string;
  let services: AppServices | undefined;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-meals-api-"));
    uploadsDir = path.join(tempRoot, "uploads");
    assetsDir = path.join(tempRoot, "assets");
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: mockLLM,
      uploadsDir,
      assetsDir,
      onServicesReady: (readyServices) => {
        services = readyServices;
      },
    });
    deviceId = (
      await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } })
    ).json().deviceId;
    otherDeviceId = (
      await app.inject({ method: "POST", url: "/api/device", payload: { goal: "muscle_gain" } })
    ).json().deviceId;
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function postChatMessage(message: string) {
    const form = new FormData();
    form.append("message", message);
    return fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });
  }

  async function postImageChatMessage(fileName: string) {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob(["fake image"], { type: "image/png" }), fileName);
    return fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });
  }

  it("GET /api/meals returns today's meals in ascending timeline order after two meal logs", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "早餐", calories: 350, protein: 18, carbs: 45, fat: 10 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄早餐！" });
    await postChatMessage("我早餐吃了蛋餅");

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_2",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "晚餐", calories: 620, protein: 34, carbs: 58, fat: 24 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄晚餐！" });
    await postChatMessage("我晚餐吃了雞腿飯");

    const res = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { "x-device-id": deviceId },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.meals.map((meal: { foodName: string }) => meal.foodName), ["早餐", "晚餐"]);
  });

  it("DELETE /api/meals/:id removes the meal for the owner and returns 404 for another device", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "午餐", calories: 600, protein: 35, carbs: 55, fat: 22 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄午餐！" });
    await postChatMessage("我午餐吃了便當");

    const mealsRes = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { "x-device-id": deviceId },
    });
    const mealId = mealsRes.json().meals[0].id as string;

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/meals/${mealId}`,
      headers: { "x-device-id": otherDeviceId },
    });
    assert.equal(foreignDelete.statusCode, 404);
    assert.deepEqual(foreignDelete.json(), { error: "Meal not found" });

    const ownDelete = await app.inject({
      method: "DELETE",
      url: `/api/meals/${mealId}`,
      headers: { "x-device-id": deviceId },
    });
    assert.equal(ownDelete.statusCode, 204);

    const remainingMeals = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { "x-device-id": deviceId },
    });
    assert.deepEqual(remainingMeals.json().meals, []);
  });

  it("DELETE /api/meals/:id recomputes the deleted transaction's affected local day", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const loggedAt = "2026-03-25T04:00:00.000Z";
    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "回補早餐",
      calories: 420,
      protein: 20,
      carbs: 50,
      fat: 14,
      loggedAt,
    });

    const requestedDates: string[] = [];
    const originalGetDailySummary = services.summaryService.getDailySummary.bind(services.summaryService);
    services.summaryService.getDailySummary = async (summaryDeviceId, date) => {
      requestedDates.push(formatLocalDate(date));
      return originalGetDailySummary(summaryDeviceId, date);
    };

    try {
      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/meals/${meal.id}`,
        headers: { "x-device-id": deviceId },
      });

      assert.equal(deleteRes.statusCode, 204);
      assert.deepEqual(
        requestedDates,
        [formatLocalDate(new Date(loggedAt))],
        "delete should recompute the affected local day, not today",
      );
    } finally {
      services.summaryService.getDailySummary = originalGetDailySummary;
    }
  });

  it("GET /api/meals projects asset-backed image metadata without leaking staging paths", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_image_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "便當", calories: 640, protein: 32, carbs: 78, fat: 21 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄便當！" });

    const postRes = await postImageChatMessage("meal.png");
    assert.equal(postRes.status, 200);

    const mealsRes = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { "x-device-id": deviceId },
    });

    assert.equal(mealsRes.statusCode, 200);
    const body = mealsRes.json() as {
      meals: Array<{
        imageAssetId?: string | null;
        imageUrl?: string | null;
      }>;
    };
    assert.equal(body.meals.length, 1);
    assert.ok(body.meals[0].imageAssetId);
    assert.equal(body.meals[0].imageUrl, `/api/assets/${body.meals[0].imageAssetId}`);
    assert.doesNotMatch(body.meals[0].imageUrl ?? "", /\/uploads\//);
  });

  it("GET /api/meals logs redacted day_rollover event when requested", async () => {
    const rolloverLogLines: string[] = [];
    const logStream = new Writable({
      write(chunk, _, cb) {
        chunk.toString().split("\n").filter(Boolean).forEach((line: string) => rolloverLogLines.push(line));
        cb();
      },
    });

    const rolloverApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });

    const rolloverDeviceId = (
      await rolloverApp.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } })
    ).json().deviceId as string;

    const res = await rolloverApp.inject({
      method: "GET",
      url: "/api/meals",
      headers: {
        "x-device-id": rolloverDeviceId,
        "x-refresh-reason": "day_rollover",
      },
    });

    await rolloverApp.close();

    assert.equal(res.statusCode, 200);
    const parsedLines = rolloverLogLines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    assert.ok(
      parsedLines.some((line) => line.event === "day_rollover"),
      `Expected day_rollover log event. Captured lines: ${rolloverLogLines.length}`,
    );
    assert.ok(
      !rolloverLogLines.join("\n").includes(rolloverDeviceId),
      "day_rollover logs must not include raw deviceId",
    );
  });
});
