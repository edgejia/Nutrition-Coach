process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-04-19T12:00:00+08:00");

class FixedDate extends REAL_DATE {
  constructor(...args: any[]) {
    switch (args.length) {
      case 0:
        super(FIXED_NOW);
        break;
      case 1:
        super(args[0]);
        break;
      case 2:
        super(args[0], args[1]);
        break;
      case 3:
        super(args[0], args[1], args[2]);
        break;
      case 4:
        super(args[0], args[1], args[2], args[3]);
        break;
      case 5:
        super(args[0], args[1], args[2], args[3], args[4]);
        break;
      case 6:
        super(args[0], args[1], args[2], args[3], args[4], args[5]);
        break;
      default:
        super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    }
  }

  static now(): number {
    return FIXED_NOW.getTime();
  }
}

describe("chat meal correction integration", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let deviceId: string;
  let sessionCookieHeader: string;
  let services: AppServices;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  beforeEach(async () => {
    globalThis.Date = FixedDate as DateConstructor;
    mockLLM = new MockLLMProvider();
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: mockLLM,
      onServicesReady: (ready) => {
        services = ready;
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = res.json().deviceId;
    sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
    globalThis.Date = REAL_DATE;
  });

  async function postChat(message: string): Promise<{
    status: number;
    body: {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      affectedDate?: string;
      dailySummary?: {
        totalCalories: number;
        totalProtein: number;
        totalCarbs: number;
        totalFat: number;
        mealCount: number;
        date: string;
      };
    };
  }> {
    const form = new FormData();
    form.append("message", message);

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    return { status: res.status, body: await res.json() };
  }

  async function getMeals() {
    const res = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(res.status, 200);
    return (await res.json() as { meals: Array<{
      id: string;
      foodName: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }> }).meals;
  }

  it("updates the original meal transaction instead of appending a duplicate", async () => {
    const original = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T01:00:00.000Z",
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_unique_meal",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把今天早餐的雞腿飯改成雞胸飯 500 卡",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "update_original_meal",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: original.id,
            food_name: "雞胸飯",
            calories: 500,
            protein: 42,
            carbs: 48,
            fat: 12,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已幫你把今天早餐那筆改成雞胸飯。",
    });

    const { status, body } = await postChat("把今天早餐的雞腿飯改成雞胸飯 500 卡");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /已幫你把今天早餐那筆改成雞胸飯/);
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.equal(body.dailySummary?.totalCalories, 500);

    const meals = await getMeals();
    assert.equal(meals.length, 1);
    assert.equal(meals[0]!.id, original.id, "historical correction must preserve the original transaction id");
    assert.equal(meals[0]!.foodName, "雞胸飯");
    assert.equal(meals[0]!.calories, 500);
  });

  it("returns affectedDate for historical updates resolved through shared date parsing", async () => {
    const original = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-03-25T04:00:00.000Z",
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_historical_update",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把 3/25 的雞腿飯改成雞胸飯 500 卡",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "apply_historical_update",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: original.id,
            food_name: "雞胸飯",
            calories: 500,
            protein: 42,
            carbs: 48,
            fat: 12,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已幫你更新 3/25 的那筆紀錄。",
    });

    const { status, body } = await postChat("把 3/25 的雞腿飯改成雞胸飯 500 卡");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.affectedDate, "2026-03-25");
    assert.equal(body.dailySummary?.date, "2026-03-25");
    assert.match(body.reply, /3\/25/);

    const meals = await services.foodLoggingService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    assert.equal(meals.length, 1);
    assert.equal(meals[0]!.id, original.id);
    assert.equal(meals[0]!.foodName, "雞胸飯");
    assert.equal(meals[0]!.calories, 500);
  });

  it("asks for clarification and does not mutate when multiple historical meals match", async () => {
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 620,
      protein: 28,
      carbs: 76,
      fat: 18,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_ambiguous_meal",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "delete",
            query: "把今天午餐的雞腿飯刪掉",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "我找到多筆今天的雞腿飯，請直接回覆編號。",
    });

    const { status, body } = await postChat("把今天的雞腿飯刪掉");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.match(body.reply, /多筆|回覆編號/);

    const meals = await getMeals();
    assert.equal(meals.length, 2);
  });

  it("respects the named food target even when the user also says recent-reference shorthand", async () => {
    const target = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    const breastOne = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 220,
      protein: 30,
      carbs: 0,
      fat: 5,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });
    const breastTwo = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 220,
      protein: 31,
      carbs: 0,
      fat: 5,
      loggedAt: "2026-04-19T05:00:00.000Z",
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_recent_named_target",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "update_named_recent_target",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: target.id,
            food_name: "雞腿",
            calories: 220,
            protein: 18,
            carbs: 0,
            fat: 9,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已幫你更新剛剛那筆雞腿的蛋白質。",
    });

    const { status, body } = await postChat("幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /雞腿/);

    const meals = await getMeals();
    assert.equal(meals.length, 3);

    const updated = meals.find((meal) => meal.id === target.id);
    const untouchedBreastOne = meals.find((meal) => meal.id === breastOne.id);
    const untouchedBreastTwo = meals.find((meal) => meal.id === breastTwo.id);

    assert.equal(updated?.foodName, "雞腿");
    assert.equal(updated?.protein, 18);
    assert.equal(untouchedBreastOne?.protein, 30);
    assert.equal(untouchedBreastTwo?.protein, 31);
  });

  it("carries a uniquely resolved target across turns and applies a partial nutrient patch", async () => {
    const target = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 220,
      protein: 30,
      carbs: 0,
      fat: 5,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 220,
      protein: 31,
      carbs: 0,
      fat: 5,
      loggedAt: "2026-04-19T05:00:00.000Z",
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_unique_target_for_followup",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "我已找到你要修改的那筆雞腿紀錄。如果要降低蛋白質，請直接告訴我要改成幾克。",
    });

    const firstTurn = await postChat("幫我把剛剛的雞腿蛋白質降低，我覺得沒這麼高");
    assert.equal(firstTurn.status, 200);
    assert.equal(firstTurn.body.didMutateMeal, false);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "reuse_pending_unique_target",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "正常平均幾g就幾g",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "partial_patch_update",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: target.id,
            protein: 22,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已幫你把那筆雞腿的蛋白質調整成約22g。",
    });

    const { status, body } = await postChat("正常平均幾g就幾g");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /22g/);

    const meals = await getMeals();
    const updated = meals.find((meal) => meal.id === target.id);
    assert.equal(updated?.foodName, "雞腿");
    assert.equal(updated?.calories, 220);
    assert.equal(updated?.protein, 22);
    assert.equal(updated?.carbs, 0);
    assert.equal(updated?.fat, 9);
  });

  it("applies grouped meal whole-meal nutrient patches proportionally without requiring full items[] replacement", async () => {
    const grouped = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 30, carbs: 0, fat: 5 },
        { foodName: "白飯", calories: 180, protein: 4, carbs: 40, fat: 0.5 },
        { foodName: "花椰菜", calories: 50, protein: 3, carbs: 8, fat: 0.5 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_grouped_target",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把今天那餐雞胸肉白飯的蛋白質改成 22g",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "patch_grouped_meal_total",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: grouped.id,
            protein: 22,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已幫你把那餐的蛋白質改成 22g。",
    });

    const { status, body } = await postChat("把今天那餐雞胸肉白飯的蛋白質改成 22g");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /22g/);

    const meals = await getMeals();
    const updated = meals.find((meal) => meal.id === grouped.id);
    assert.equal(updated?.foodName, "雞胸肉、白飯、花椰菜");
    assert.equal(updated?.calories, 450);
    assert.equal(updated?.protein, 22);
    assert.equal(updated?.carbs, 48);
    assert.equal(updated?.fat, 6);
  });

  it("consumes the pending selection on the next chat turn and deletes the chosen meal", async () => {
    const first = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    const second = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 620,
      protein: 28,
      carbs: 76,
      fat: 18,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_ambiguous_for_pending",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "delete",
            query: "把今天午餐的雞腿飯刪掉",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "我找到多筆今天的雞腿飯，請直接回覆編號。",
    });

    const firstTurn = await postChat("把今天午餐的雞腿飯刪掉");
    assert.equal(firstTurn.status, 200);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_pending_choice",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "delete",
            query: "第二個",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "delete_selected_meal",
        type: "function",
            function: {
              name: "delete_meal",
              arguments: JSON.stringify({
                meal_id: first.id,
              }),
            },
          }],
    });
    mockLLM.queueChatResponse({
      content: "已幫你刪除第二筆雞腿飯。",
    });

    const { status, body } = await postChat("第二個");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /已幫你刪除第二筆雞腿飯/);
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.equal(body.dailySummary?.totalCalories, 620);

    const meals = await getMeals();
    assert.equal(meals.length, 1);
    assert.equal(meals[0]!.id, second.id);
    assert.notEqual(meals[0]!.id, first.id);
  });

  it("returns affectedDate for historical deletes resolved through shared date parsing", async () => {
    const meal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-03-25T10:30:00.000Z",
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_historical_delete",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "delete",
            query: "把 3/25 的牛肉麵刪掉",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "apply_historical_delete",
        type: "function",
        function: {
          name: "delete_meal",
          arguments: JSON.stringify({
            meal_id: meal.id,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已幫你刪除 3/25 那筆牛肉麵。",
    });

    const { status, body } = await postChat("把 3/25 的牛肉麵刪掉");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.affectedDate, "2026-03-25");
    assert.equal(body.dailySummary?.date, "2026-03-25");
    assert.match(body.reply, /3\/25/);

    const meals = await services.foodLoggingService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));
    assert.equal(meals.length, 0);
  });
});
