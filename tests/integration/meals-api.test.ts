process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Meals API", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let deviceId: string;
  let otherDeviceId: string;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
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
});
