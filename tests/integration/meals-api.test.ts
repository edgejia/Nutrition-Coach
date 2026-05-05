process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  let deviceCookieHeader: string;
  let otherCookieHeader: string;
  let tempRoot: string;
  let uploadsDir: string;
  let assetsDir: string;
  let services: AppServices | undefined;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

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
    const deviceRes = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = deviceRes.json().deviceId;
    deviceCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);

    const otherDeviceRes = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "muscle_gain" } });
    otherDeviceId = otherDeviceRes.json().deviceId;
    otherCookieHeader = toCookieHeader(otherDeviceRes.headers["set-cookie"]);
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
      headers: { cookie: deviceCookieHeader },
      body: form,
    });
  }

  async function postImageChatMessage(fileName: string) {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob(["fake image"], { type: "image/png" }), fileName);
    return fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: deviceCookieHeader },
      body: form,
    });
  }

  async function createOwnedAsset(ownerDeviceId: string, fileName: string) {
    assert.ok(services, "expected onServicesReady to capture app services");
    const stagedPath = path.join(tempRoot, fileName);
    await writeFile(stagedPath, "fake image");
    return services.assetService.createAsset(ownerDeviceId, {
      stagedPath,
      mimeType: "image/png",
      originalFilename: fileName,
    });
  }

  function assertNoRawImageStorageFields(value: unknown) {
    const serialized = JSON.stringify(value);
    assert.ok(!serialized.includes("storageKey"), "route DTO must not expose asset storage keys");
    assert.ok(!serialized.includes("uploadsDir"), "route DTO must not expose upload directory names");
    assert.ok(!serialized.includes("/uploads/"), "route DTO must not expose staged upload paths");
    assert.ok(!serialized.includes("asset:"), "route DTO must not expose raw asset refs as URLs");
  }

  async function readOptionalSSEChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
  ): Promise<string | null> {
    const decoder = new TextDecoder();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const read = reader.read()
      .then((chunk) => (chunk.value ? decoder.decode(chunk.value) : ""))
      .catch(() => "");
    return Promise.race([read, timeout]);
  }

  it("GET /api/meals returns today's meals in ascending timeline order after two meal logs", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "早餐",
            calories: 350,
            protein: 18,
            carbs: 45,
            fat: 10,
            protein_sources: [
              { name: "蛋餅", protein: 18, is_primary: true, certainty: "clear" },
            ],
          }),
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
          arguments: JSON.stringify({
            food_name: "晚餐",
            calories: 620,
            protein: 34,
            carbs: 58,
            fat: 24,
            protein_sources: [
              { name: "雞腿", protein: 34, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄晚餐！" });
    await postChatMessage("我晚餐吃了雞腿飯");

    const res = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { cookie: deviceCookieHeader },
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
          arguments: JSON.stringify({
            food_name: "午餐",
            calories: 600,
            protein: 35,
            carbs: 55,
            fat: 22,
            protein_sources: [
              { name: "雞腿排", protein: 35, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄午餐！" });
    await postChatMessage("我午餐吃了便當");

    const mealsRes = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { cookie: deviceCookieHeader },
    });
    const mealId = mealsRes.json().meals[0].id as string;

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/meals/${mealId}`,
      headers: { cookie: otherCookieHeader },
    });
    assert.equal(foreignDelete.statusCode, 404);
    assert.deepEqual(foreignDelete.json(), { error: "Meal not found" });

    const ownDelete = await app.inject({
      method: "DELETE",
      url: `/api/meals/${mealId}`,
      headers: { cookie: deviceCookieHeader },
    });
    assert.equal(ownDelete.statusCode, 200);
    assert.deepEqual(ownDelete.json(), {
      affectedDate: formatLocalDate(new Date()),
      dailySummary: {
        date: formatLocalDate(new Date()),
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        mealCount: 0,
      },
    });

    const remainingMeals = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { cookie: deviceCookieHeader },
    });
    assert.deepEqual(remainingMeals.json().meals, []);
  });

  it("PATCH /api/meals/:id updates the meal for the owner and returns the affected daily summary", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉沙拉",
      calories: 420,
      protein: 32,
      carbs: 14,
      fat: 22,
    });

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/meals/${meal.id}`,
      headers: { cookie: deviceCookieHeader },
      payload: {
        foodName: "雞胸肉沙拉半份",
        calories: 260,
        protein: 20,
        carbs: 8,
        fat: 12,
        imageAssetId: null,
      },
    });

    assert.equal(updateRes.statusCode, 200);
    const body = updateRes.json();
    assert.equal(body.affectedDate, formatLocalDate(new Date(meal.loggedAt)));
    assert.equal(body.dailySummary.totalCalories, 260);
    assert.equal(body.meal.foodName, "雞胸肉沙拉半份");
  });

  it("PATCH /api/meals/:id returns 404 for another device", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉沙拉",
      calories: 420,
      protein: 32,
      carbs: 14,
      fat: 22,
    });

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/meals/${meal.id}`,
      headers: { cookie: otherCookieHeader },
      payload: {
        foodName: "雞胸肉沙拉半份",
        calories: 260,
        protein: 20,
        carbs: 8,
        fat: 12,
        imageAssetId: null,
      },
    });

    assert.equal(updateRes.statusCode, 404);
    assert.deepEqual(updateRes.json(), { error: "Meal not found" });
  });

  it("PATCH /api/meals/:id rejects negative nutrition values", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉沙拉",
      calories: 420,
      protein: 32,
      carbs: 14,
      fat: 22,
    });

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/meals/${meal.id}`,
      headers: { cookie: deviceCookieHeader },
      payload: {
        foodName: "雞胸肉沙拉半份",
        calories: -1,
        protein: 20,
        carbs: 8,
        fat: 12,
        imageAssetId: null,
      },
    });

    assert.equal(updateRes.statusCode, 400);
    assert.deepEqual(updateRes.json(), { error: "Invalid meal update" });
  });

  it("PATCH /api/meals/:id rejects nonexistent or foreign image assets", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉沙拉",
      calories: 420,
      protein: 32,
      carbs: 14,
      fat: 22,
    });
    const foreignAsset = await createOwnedAsset(otherDeviceId, "foreign.png");

    for (const imageAssetId of ["missing-asset", foreignAsset.id]) {
      const updateRes = await app.inject({
        method: "PATCH",
        url: `/api/meals/${meal.id}`,
        headers: { cookie: deviceCookieHeader },
        payload: {
          foodName: "雞胸肉沙拉半份",
          calories: 260,
          protein: 20,
          carbs: 8,
          fat: 12,
          imageAssetId,
        },
      });

      assert.equal(updateRes.statusCode, 400);
      assert.deepEqual(updateRes.json(), { error: "Invalid meal image asset" });
    }
  });

  it("projects the same meal.id imageAssetId and /api/assets URL across meal route DTOs", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const dateKey = formatLocalDate(new Date());
    const imageAsset = await createOwnedAsset(deviceId, "continuity.png");
    const imageMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "照片便當",
      calories: 640,
      protein: 32,
      carbs: 78,
      fat: 21,
      imagePath: `asset:${imageAsset.id}`,
    });
    const textMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "文字點心",
      calories: 120,
      protein: 6,
      carbs: 14,
      fat: 4,
    });

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/meals/${imageMeal.id}`,
      headers: { cookie: deviceCookieHeader },
      payload: {
        foodName: "照片便當更新",
        calories: 660,
        protein: 34,
        carbs: 80,
        fat: 22,
        imageAssetId: imageAsset.id,
      },
    });
    assert.equal(updateRes.statusCode, 200);
    const updated = updateRes.json() as {
      meal: {
        id: string;
        imageAssetId: string | null;
        imageUrl: string | null;
      };
    };
    assert.equal(updated.meal.id, imageMeal.id);
    assert.equal(updated.meal.imageAssetId, imageAsset.id);
    assert.equal(updated.meal.imageUrl, `/api/assets/${imageAsset.id}`);
    assertNoRawImageStorageFields(updated);

    const todayRes = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { cookie: deviceCookieHeader },
    });
    assert.equal(todayRes.statusCode, 200);
    const todayBody = todayRes.json() as {
      meals: Array<{ id: string; imageAssetId: string | null; imageUrl: string | null }>;
    };
    const todayImageMeal = todayBody.meals.find((meal) => meal.id === imageMeal.id);
    assert.ok(todayImageMeal, "expected today's records to include the image-backed meal.id");
    assert.equal(todayImageMeal.imageAssetId, imageAsset.id);
    assert.equal(todayImageMeal.imageUrl, `/api/assets/${imageAsset.id}`);
    const todayTextMeal = todayBody.meals.find((meal) => meal.id === textMeal.id);
    assert.ok(todayTextMeal, "expected today's records to include the text-only meal.id");
    assert.equal(todayTextMeal.imageAssetId, null);
    assert.equal(todayTextMeal.imageUrl, null);
    assertNoRawImageStorageFields(todayBody);

    const historyRes = await app.inject({
      method: "GET",
      url: `/api/history/days/${dateKey}`,
      headers: { cookie: deviceCookieHeader },
    });
    assert.equal(historyRes.statusCode, 200);
    const historyBody = historyRes.json() as {
      meals: Array<{
        id: string;
        imageAssetId: string | null;
        imageUrl: string | null;
        asset: { imageAssetId: string | null; imageUrl: string | null };
      }>;
    };
    const historyImageMeal = historyBody.meals.find((meal) => meal.id === imageMeal.id);
    assert.ok(historyImageMeal, "expected history day to include the image-backed meal.id");
    assert.equal(historyImageMeal.imageAssetId, imageAsset.id);
    assert.equal(historyImageMeal.imageUrl, `/api/assets/${imageAsset.id}`);
    assert.deepEqual(historyImageMeal.asset, {
      imageAssetId: imageAsset.id,
      imageUrl: `/api/assets/${imageAsset.id}`,
    });
    const historyTextMeal = historyBody.meals.find((meal) => meal.id === textMeal.id);
    assert.ok(historyTextMeal, "expected history day to include the text-only meal.id");
    assert.equal(historyTextMeal.imageAssetId, null);
    assert.equal(historyTextMeal.imageUrl, null);
    assert.deepEqual(historyTextMeal.asset, { imageAssetId: null, imageUrl: null });
    assertNoRawImageStorageFields(historyBody);

    const snapshotRes = await app.inject({
      method: "GET",
      url: `/api/day-snapshot?date=${dateKey}`,
      headers: { cookie: deviceCookieHeader },
    });
    assert.equal(snapshotRes.statusCode, 200);
    const snapshotBody = snapshotRes.json() as {
      meals: Array<{ id: string; imageAssetId: string | null; imageUrl: string | null }>;
    };
    const snapshotImageMeal = snapshotBody.meals.find((meal) => meal.id === imageMeal.id);
    assert.ok(snapshotImageMeal, "expected day snapshot to include the image-backed meal.id");
    assert.equal(snapshotImageMeal.imageAssetId, imageAsset.id);
    assert.equal(snapshotImageMeal.imageUrl, `/api/assets/${imageAsset.id}`);
    const snapshotTextMeal = snapshotBody.meals.find((meal) => meal.id === textMeal.id);
    assert.ok(snapshotTextMeal, "expected day snapshot to include the text-only meal.id");
    assert.equal(snapshotTextMeal.imageAssetId, null);
    assert.equal(snapshotTextMeal.imageUrl, null);
    assertNoRawImageStorageFields(snapshotBody);
  });

  it("rejects foreign guest-session image reads and meal image attachment", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const ownerAsset = await createOwnedAsset(deviceId, "owner-image.png");
    const foreignRead = await app.inject({
      method: "GET",
      url: `/api/assets/${ownerAsset.id}`,
      headers: { cookie: otherCookieHeader },
    });
    assert.equal(foreignRead.statusCode, 404);
    assert.deepEqual(foreignRead.json(), { error: "Asset not found" });

    const foreignAsset = await createOwnedAsset(otherDeviceId, "foreign-owner-image.png");
    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉沙拉",
      calories: 420,
      protein: 32,
      carbs: 14,
      fat: 22,
    });
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/meals/${meal.id}`,
      headers: { cookie: deviceCookieHeader },
      payload: {
        foodName: "雞胸肉沙拉半份",
        calories: 260,
        protein: 20,
        carbs: 8,
        fat: 12,
        imageAssetId: foreignAsset.id,
      },
    });
    assert.equal(updateRes.statusCode, 400);
    assert.deepEqual(updateRes.json(), { error: "Invalid meal image asset" });
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
        headers: { cookie: deviceCookieHeader },
      });

      assert.equal(deleteRes.statusCode, 200);
      assert.equal(deleteRes.json().affectedDate, formatLocalDate(new Date(loggedAt)));
      assert.deepEqual(
        requestedDates,
        [formatLocalDate(new Date(loggedAt))],
        "delete should recompute the affected local day, not today",
      );
    } finally {
      services.summaryService.getDailySummary = originalGetDailySummary;
    }
  });

  it("DELETE /api/meals/:id does not publish historical recomputes into the today SSE loop", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "回補早餐",
      calories: 420,
      protein: 20,
      carbs: 50,
      fat: 14,
      loggedAt: "2026-03-25T04:00:00.000Z",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const sseRes = await fetch(`${address}/api/sse`, {
        headers: { cookie: deviceCookieHeader },
        signal: controller.signal,
      });
      assert.equal(sseRes.status, 200);
      assert.ok(sseRes.body);
      reader = sseRes.body.getReader();

      await reader.read();

      const deleteRes = await fetch(`${address}/api/meals/${meal.id}`, {
        method: "DELETE",
        headers: { cookie: deviceCookieHeader },
      });
      assert.equal(deleteRes.status, 200);
      assert.deepEqual(await deleteRes.json(), {
        affectedDate: "2026-03-25",
        dailySummary: {
          date: "2026-03-25",
          totalCalories: 0,
          totalProtein: 0,
          totalCarbs: 0,
          totalFat: 0,
          mealCount: 0,
        },
      });

      const extraChunk = await readOptionalSSEChunk(reader, 250);
      assert.ok(
        extraChunk === null || !extraChunk.includes("event: daily_summary"),
        `historical delete must not emit a today SSE summary, got ${extraChunk ?? "<none>"}`,
      );
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("GET /api/meals projects asset-backed image metadata without leaking staging paths", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_image_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "便當",
            calories: 640,
            protein: 32,
            carbs: 78,
            fat: 21,
            protein_sources: [
              { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
              { name: "滷蛋", protein: 8, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄便當！" });

    const postRes = await postImageChatMessage("meal.png");
    assert.equal(postRes.status, 200);

    const mealsRes = await app.inject({
      method: "GET",
      url: "/api/meals",
      headers: { cookie: deviceCookieHeader },
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

    const rolloverDevice = await rolloverApp.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    const rolloverDeviceId = rolloverDevice.json().deviceId as string;
    const rolloverCookieHeader = toCookieHeader(rolloverDevice.headers["set-cookie"]);

    const res = await rolloverApp.inject({
      method: "GET",
      url: "/api/meals",
      headers: {
        cookie: rolloverCookieHeader,
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
