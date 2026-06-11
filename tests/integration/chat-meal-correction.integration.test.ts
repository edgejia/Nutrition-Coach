process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import {
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericCancelCopy,
  renderMealNumericProposalCopy,
  renderProposalKindAmbiguityCopy,
} from "../../server/orchestrator/mutation-receipts.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-04-19T12:00:00+08:00");
const SUCCESS_STYLE_COPY = /已更新|更新好了|已經幫你更新|已套用/;

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
  let publishDailySummaryCalls: unknown[];
  let publishGoalsUpdateCalls: unknown[];

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  function defaultSessionKey() {
    return { deviceId, sessionId: DEFAULT_SESSION_ID };
  }

  beforeEach(async () => {
    globalThis.Date = FixedDate as DateConstructor;
    mockLLM = new MockLLMProvider();
    publishDailySummaryCalls = [];
    publishGoalsUpdateCalls = [];
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: mockLLM,
      onServicesReady: (ready) => {
        const originalPublishDailySummary = ready.publisher.publishDailySummary.bind(ready.publisher);
        ready.publisher.publishDailySummary = (...args) => {
          publishDailySummaryCalls.push(args);
          return originalPublishDailySummary(...args);
        };
        const originalPublishGoalsUpdate = ready.publisher.publishGoalsUpdate.bind(ready.publisher);
        ready.publisher.publishGoalsUpdate = (...args) => {
          publishGoalsUpdateCalls.push(args);
          return originalPublishGoalsUpdate(...args);
        };
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
      summaryOutcome?: unknown;
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
      mealRevisionId: string;
      foodName: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }> }).meals;
  }

  it("updates a resolved meal only when the current turn supplies the explicit numeric target", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_explicit_numeric_meal",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "雞腿飯蛋白質改成 28g",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "apply_explicit_numeric_meal",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: original.id,
            protein: 28,
          }),
        },
      }],
    });

    const { status, body } = await postChat("雞腿飯蛋白質改成 28g");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /已更新.*雞腿飯.*蛋白質 28 g/);
    assert.equal(body.dailySummary?.totalProtein, 28);

    const meals = await getMeals();
    const updated = meals.find((meal) => meal.id === original.id);
    assert.ok(updated);
    assert.notEqual(updated.mealRevisionId, original.mealRevisionId);
    assert.equal(updated.protein, 28);
    assert.equal(updated.calories, 650);
  });

  it("blocks vague model-estimated numeric updates without revision or daily_summary publish", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_vague_numeric_meal",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "雞腿飯蛋白質怪怪的，幫我改合理一點",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "unsafe_model_estimated_numeric_update",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: original.id,
            protein: 24,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已更新雞腿飯，蛋白質 24 g。" });

    const { status, body } = await postChat("雞腿飯蛋白質怪怪的，幫我改合理一點");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, renderMealNumericAuthorityFailureCopy({ field: "protein" }));
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assert.deepEqual(publishDailySummaryCalls, []);

    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);
    assert.ok(current);
    assert.equal(current.mealRevisionId, original.mealRevisionId);
    assert.equal(current.protein, 30);
  });

  it("creates a relative numeric proposal without mutating the meal", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_relative_numeric_meal",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "雞腿飯蛋白質減半",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "propose_relative_numeric_meal",
        type: "function",
        function: {
          name: "propose_meal_numeric_correction",
          arguments: JSON.stringify({
            meal_id: original.id,
            fields: ["protein"],
            operator: "half",
          }),
        },
      }],
    });

    const { status, body } = await postChat("雞腿飯蛋白質減半");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, renderMealNumericProposalCopy({
      mealLabel: "雞腿飯",
      affectedFields: [{ field: "protein", before: 30, after: 15 }],
      sourceOperator: "half",
    }));
    assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
    assert.deepEqual(publishDailySummaryCalls, []);

    const proposal = await services.mealNumericProposalService.getLatest(defaultSessionKey());
    assert.ok(proposal);
    assert.equal(proposal.mealId, original.id);
    assert.equal(proposal.expectedMealRevisionId, original.mealRevisionId);
    assert.deepEqual(proposal.updateInput, { protein: 15 });

    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);
    assert.equal(current?.mealRevisionId, original.mealRevisionId);
    assert.equal(current?.protein, 30);
  });

  it("rejects stale meal proposal approval without revision or daily_summary publish", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: original.id,
        expectedMealRevisionId: original.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    const externalUpdate = await services.foodLoggingService.updateMeal(deviceId, original.id, {
      expectedMealRevisionId: original.mealRevisionId,
      items: [{
        foodName: "新版雞腿飯",
        calories: 640,
        protein: 31,
        carbs: 78,
        fat: 19,
      }],
    });

    const { status, body } = await postChat("套用餐點修改");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(publishDailySummaryCalls, []);

    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);
    assert.equal(current?.mealRevisionId, externalUpdate.mealRevisionId);
    assert.equal(current?.protein, 31);
    assert.equal(await services.mealNumericProposalService.getLatest(defaultSessionKey()), undefined);
  });

  it("fails closed when active meal proposal is concurrently consumed before approval commit", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: original.id,
        expectedMealRevisionId: original.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    const realConsumeLatest = services.mealNumericProposalService.consumeLatest.bind(
      services.mealNumericProposalService,
    );
    services.mealNumericProposalService.consumeLatest = async (params) => {
      await realConsumeLatest(params);
      return undefined;
    };

    const { status, body } = await postChat("套用餐點修改");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, renderMealNumericAuthorityFailureCopy());
    assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(publishDailySummaryCalls, []);

    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);
    assert.equal(current?.mealRevisionId, original.mealRevisionId);
    assert.equal(current?.protein, 30);
    assert.equal(await services.mealNumericProposalService.getLatest(defaultSessionKey()), undefined);
  });

  it("clears stale resolved meal selection after stored proposal approval", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_relative_for_follow_up",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "雞腿飯蛋白質減半",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "propose_relative_for_follow_up",
        type: "function",
        function: {
          name: "propose_meal_numeric_correction",
          arguments: JSON.stringify({
            meal_id: original.id,
            fields: ["protein"],
            operator: "half",
          }),
        },
      }],
    });

    const proposed = await postChat("雞腿飯蛋白質減半");
    assert.equal(proposed.status, 200);
    assert.equal(proposed.body.didMutateMeal, false);
    assert.ok(await services.mealNumericProposalService.getLatest(defaultSessionKey()));

    const approved = await postChat("套用餐點修改");
    assert.equal(approved.status, 200);
    assert.equal(approved.body.didMutateMeal, true);
    assert.equal(await services.mealNumericProposalService.getLatest(defaultSessionKey()), undefined);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_follow_up_after_proposal",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "上一筆蛋白質改成 22g",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "apply_follow_up_after_proposal",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: original.id,
            protein: 22,
          }),
        },
      }],
    });

    const followUp = await postChat("上一筆蛋白質改成 22g");

    assert.equal(followUp.status, 200);
    assert.equal(followUp.body.didMutateMeal, true);
    assert.match(followUp.body.reply, /已更新.*雞腿飯.*蛋白質 22 g/);

    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);
    assert.ok(current);
    assert.notEqual(current.mealRevisionId, original.mealRevisionId);
    assert.equal(current.protein, 22);
  });

  it("fails closed for cross-kind bare approval and broad cancel clears active proposals", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.goalProposalService.putLatest({
      ...defaultSessionKey(),
      targets: {
        calories: 1400,
        protein: 125,
        carbs: 130,
        fat: 45,
      },
    });
    await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: original.id,
        expectedMealRevisionId: original.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    mockLLM.queueChatResponse({ content: "模型不應該選擇提案。" });

    const ambiguous = await postChat("好");

    assert.equal(ambiguous.status, 200);
    assert.equal(ambiguous.body.reply, renderProposalKindAmbiguityCopy());
    assert.equal(ambiguous.body.didLogMeal, false);
    assert.equal(ambiguous.body.didMutateMeal, false);
    assert.doesNotMatch(ambiguous.body.reply, SUCCESS_STYLE_COPY);
    assert.ok(await services.goalProposalService.getLatest(defaultSessionKey()));
    assert.ok(await services.mealNumericProposalService.getLatest(defaultSessionKey()));
    assert.deepEqual(publishDailySummaryCalls, []);
    assert.equal(mockLLM.chatCalls.length, 0);

    const cancelled = await postChat("取消");

    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.reply, renderMealNumericCancelCopy());
    assert.equal(cancelled.body.didLogMeal, false);
    assert.equal(cancelled.body.didMutateMeal, false);
    assert.doesNotMatch(cancelled.body.reply, SUCCESS_STYLE_COPY);
    assert.equal(await services.goalProposalService.getLatest(defaultSessionKey()), undefined);
    assert.equal(await services.mealNumericProposalService.getLatest(defaultSessionKey()), undefined);
    assert.deepEqual(publishDailySummaryCalls, []);
    assert.equal(mockLLM.chatCalls.length, 0);

    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);
    assert.equal(current?.mealRevisionId, original.mealRevisionId);
    assert.equal(current?.protein, 30);
  });

  it("updates the original meal transaction instead of appending a duplicate", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T01:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
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
    const { status, body } = await postChat("把今天早餐的雞腿飯改成雞胸飯 500 卡，蛋白質 42g，碳水 48g，脂肪 12g");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /已更新雞胸飯，500 kcal，蛋白質 42 g/);
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.equal(body.dailySummary?.totalCalories, 500);

    const meals = await getMeals();
    assert.equal(meals.length, 1);
    assert.equal(meals[0]!.id, original.id, "historical correction must preserve the original transaction id");
    assert.equal(meals[0]!.foodName, "雞胸飯");
    assert.equal(meals[0]!.calories, 500);
  });

  it("returns affectedDate for historical updates resolved through shared date parsing", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
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

    const { status, body } = await postChat("把 3/25 的雞腿飯改成雞胸飯 500 卡，蛋白質 42g，碳水 48g，脂肪 12g");

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
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
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
    const target = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
      ],
    });
    const breastOne = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 30, carbs: 0, fat: 5 },
      ],
    });
    const breastTwo = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T05:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 31, carbs: 0, fat: 5 },
      ],
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

    const { status, body } = await postChat("幫我把剛剛的雞腿蛋白質改成 18g");

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
    const target = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 220, protein: 24, carbs: 0, fat: 9 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 30, carbs: 0, fat: 5 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T05:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 31, carbs: 0, fat: 5 },
      ],
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
    const { status, body } = await postChat("蛋白質改成 22g");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /22\s*g/);

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
    const { status, body } = await postChat("把今天那餐雞胸肉白飯的蛋白質改成 22g");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /22\s*g/);

    const meals = await getMeals();
    const updated = meals.find((meal) => meal.id === grouped.id);
    assert.equal(updated?.foodName, "雞胸肉、白飯、花椰菜");
    assert.equal(updated?.calories, 450);
    assert.equal(updated?.protein, 22);
    assert.equal(updated?.carbs, 48);
    assert.equal(updated?.fat, 6);
  });

  it("updates the grouped target instead of an unrelated lunch candidate when the model adds a period hint", async () => {
    const grouped = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T09:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });
    const unrelatedLunch = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "蛋餅", calories: 330, protein: 12, carbs: 38, fat: 14 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_grouped_bento_target",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把中午雞腿便當的滷蛋改成兩顆水煮蛋",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "replace_grouped_bento_item",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: grouped.id,
            items: [
              { food_name: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
              { food_name: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
              { food_name: "兩顆水煮蛋", calories: 150, protein: 13, carbs: 1, fat: 10 },
              { food_name: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
            ],
          }),
        },
      }],
    });

    const { status, body } = await postChat("滷蛋改成兩顆水煮蛋，熱量 150 卡，蛋白質 13g，碳水 1g，脂肪 10g");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.reply, /雞腿、白飯、兩顆水煮蛋、青菜/);

    const meals = await getMeals();
    const updatedGrouped = meals.find((meal) => meal.id === grouped.id);
    const untouchedLunch = meals.find((meal) => meal.id === unrelatedLunch.id);
    assert.equal(updatedGrouped?.foodName, "雞腿、白飯、兩顆水煮蛋、青菜");
    assert.equal(updatedGrouped?.calories, 770);
    assert.equal(untouchedLunch?.foodName, "蛋餅");
    assert.equal(untouchedLunch?.calories, 330);
  });

  it("returns grouped-term clarification copy before any follow-up mutation is attempted", async () => {
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T09:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T10:00:00.000Z",
      items: [
        { foodName: "排骨", calories: 300, protein: 26, carbs: 8, fat: 18 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_ambiguous_grouped_item",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把中午雞腿便當的滷蛋改成兩顆水煮蛋",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "你是要修改中午雞腿便當嗎？" });

    const { status, body } = await postChat("滷蛋改成兩顆水煮蛋");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.match(body.reply, /滷蛋/);
    assert.match(body.reply, /雞腿、白飯、滷蛋、青菜/);
    assert.match(body.reply, /排骨、白飯、滷蛋、青菜/);
    assert.doesNotMatch(body.reply, /中午雞腿便當/);

    const meals = await getMeals();
    assert.equal(meals.length, 2);
    assert.ok(meals.every((meal) => meal.foodName.includes("滷蛋")));
  });

  it("Phase 67 D-39/D-40/D-42 mutates only after a mixed numbered selection revalidates the rendered option and explicit numeric evidence", async () => {
    const first = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const second = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_ambiguous_mixed_follow_up",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把今天午餐的雞腿飯蛋白質改掉",
          }),
        },
      }],
    });

    const firstTurn = await postChat("把今天午餐的雞腿飯蛋白質改掉");
    assert.equal(firstTurn.status, 200);
    assert.equal(firstTurn.body.didMutateMeal, false);
    assert.match(firstTurn.body.reply, /請直接回覆編號/);
    assert.equal(Object.prototype.hasOwnProperty.call(firstTurn.body, "summaryOutcome"), false);
    assert.deepEqual(publishDailySummaryCalls, []);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_mixed_numbered_selection",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "2，蛋白質改 28g",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "apply_mixed_numbered_selection",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: first.id,
            protein: 28,
          }),
        },
      }],
    });

    const selected = await postChat("2，蛋白質改 28g");

    assert.equal(selected.status, 200);
    assert.equal(selected.body.didLogMeal, false);
    assert.equal(selected.body.didMutateMeal, true);
    assert.match(selected.body.reply, /已更新.*雞腿飯.*蛋白質 28 g/);
    assert.ok(selected.body.summaryOutcome);
    assert.ok(publishDailySummaryCalls.length > 0);

    const meals = await getMeals();
    const updatedFirst = meals.find((meal) => meal.id === first.id);
    const untouchedSecond = meals.find((meal) => meal.id === second.id);
    assert.equal(updatedFirst?.protein, 28);
    assert.notEqual(updatedFirst?.mealRevisionId, first.mealRevisionId);
    assert.equal(untouchedSecond?.protein, 28);
    assert.equal(untouchedSecond?.mealRevisionId, second.mealRevisionId);
  });

  it("Phase 67 D-43 resolves a mixed numbered vague follow-up without direct mutation or daily_summary publish", async () => {
    const first = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const second = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_ambiguous_vague_follow_up",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把今天午餐的雞腿飯蛋白質改掉",
          }),
        },
      }],
    });
    const firstTurn = await postChat("把今天午餐的雞腿飯蛋白質改掉");
    assert.equal(firstTurn.status, 200);
    assert.equal(firstTurn.body.didMutateMeal, false);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_mixed_vague_selection",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "2，蛋白質改合理一點",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "unsafe_vague_selection_update",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: first.id,
            protein: 24,
          }),
        },
      }],
    });

    const selected = await postChat("2，蛋白質改合理一點");

    assert.equal(selected.status, 200);
    assert.equal(selected.body.didLogMeal, false);
    assert.equal(selected.body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(selected.body, "summaryOutcome"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(selected.body, "dailySummary"), false);
    assert.doesNotMatch(selected.body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(publishDailySummaryCalls, []);

    const meals = await getMeals();
    const unchangedFirst = meals.find((meal) => meal.id === first.id);
    const unchangedSecond = meals.find((meal) => meal.id === second.id);
    assert.equal(unchangedFirst?.mealRevisionId, first.mealRevisionId);
    assert.equal(unchangedFirst?.protein, 30);
    assert.equal(unchangedSecond?.mealRevisionId, second.mealRevisionId);
    assert.equal(unchangedSecond?.protein, 28);
  });

  it("Phase 67 D-38 route re-shows rendered options for an invalid number without mutation or publish", async () => {
    const first = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const second = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_invalid_number_options",
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
    const firstTurn = await postChat("把今天午餐的雞腿飯刪掉");
    assert.equal(firstTurn.status, 200);
    assert.match(firstTurn.body.reply, /請直接回覆編號/);

    const beforeSecondTurnCalls = mockLLM.chatCalls.length;
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_invalid_number_selection",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "delete",
            query: "3",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已刪除第三筆雞腿飯。" });

    const invalid = await postChat("3");

    assert.equal(invalid.status, 200);
    assert.equal(mockLLM.chatCalls.length, beforeSecondTurnCalls + 1);
    assert.equal(invalid.body.didLogMeal, false);
    assert.equal(invalid.body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(invalid.body, "summaryOutcome"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(invalid.body, "dailySummary"), false);
    assert.match(invalid.body.reply, /請直接回覆編號/);
    assert.match(invalid.body.reply, /1\./);
    assert.match(invalid.body.reply, /2\./);
    assert.doesNotMatch(invalid.body.reply, /3\.|已刪除|成功/);
    assert.deepEqual(publishDailySummaryCalls, []);

    const meals = await getMeals();
    assert.equal(meals.length, 2);
    assert.equal(meals.find((meal) => meal.id === first.id)?.mealRevisionId, first.mealRevisionId);
    assert.equal(meals.find((meal) => meal.id === second.id)?.mealRevisionId, second.mealRevisionId);
  });

  it("Phase 67 D-41/D-45/D-46 route rejects a deleted delayed selection without same-label auto-retargeting", async () => {
    const selectedTarget = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const newer = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_deleted_delayed_selection_options",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把今天午餐的雞腿飯蛋白質改掉",
          }),
        },
      }],
    });
    const firstTurn = await postChat("把今天午餐的雞腿飯蛋白質改掉");
    assert.equal(firstTurn.status, 200);
    assert.match(firstTurn.body.reply, /請直接回覆編號/);

    await services.foodLoggingService.deleteMeal(deviceId, selectedTarget.id, selectedTarget.mealRevisionId);
    const replacement = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T05:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 700, protein: 35, carbs: 82, fat: 24 },
      ],
    });

    const beforeSecondTurnCalls = mockLLM.chatCalls.length;
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_deleted_delayed_selection",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "2，蛋白質改 28g",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "unsafe_deleted_delayed_selection_update",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: selectedTarget.id,
            protein: 28,
          }),
        },
      }],
    });

    const staleSelection = await postChat("2，蛋白質改 28g");

    assert.equal(staleSelection.status, 200);
    assert.equal(mockLLM.chatCalls.length, beforeSecondTurnCalls + 1);
    assert.equal(staleSelection.body.didLogMeal, false);
    assert.equal(staleSelection.body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(staleSelection.body, "summaryOutcome"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(staleSelection.body, "dailySummary"), false);
    assert.match(staleSelection.body.reply, /請直接回覆編號/);
    assert.match(staleSelection.body.reply, /雞腿飯/);
    assert.doesNotMatch(staleSelection.body.reply, /蛋白質改|已更新|成功|MEAL_REVISION_STALE/);
    assert.deepEqual(publishDailySummaryCalls, []);

    const meals = await getMeals();
    assert.equal(meals.some((meal) => meal.id === selectedTarget.id), false);
    assert.equal(meals.find((meal) => meal.id === newer.id)?.protein, 28);
    assert.equal(meals.find((meal) => meal.id === replacement.id)?.protein, 35);
  });

  it("consumes the pending selection on the next chat turn and deletes the chosen meal", async () => {
    const first = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const second = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:30:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
      ],
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
    assert.match(body.reply, /已刪除雞腿飯，已從當日紀錄移除。/);
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.equal(body.dailySummary?.totalCalories, 620);

    const meals = await getMeals();
    assert.equal(meals.length, 1);
    assert.equal(meals[0]!.id, second.id);
    assert.notEqual(meals[0]!.id, first.id);
  });

  it("returns affectedDate for historical deletes resolved through shared date parsing", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T10:30:00.000Z",
      items: [
        { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
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

  it("fails closed when a resolved update target is stale before mutation", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_stale_update_target",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把雞腿飯蛋白質降低",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "我找到那筆雞腿飯，請告訴我要改成多少。",
    });

    const firstTurn = await postChat("把雞腿飯蛋白質降低");
    assert.equal(firstTurn.status, 200);
    assert.equal(firstTurn.body.didMutateMeal, false);

    const externalUpdate = await services.foodLoggingService.updateMeal(deviceId, original.id, {
      expectedMealRevisionId: original.mealRevisionId,
      items: [{
        foodName: "新版雞腿飯",
        calories: 640,
        protein: 31,
        carbs: 78,
        fat: 19,
      }],
    });
    const publishCalls: unknown[] = [];
    services.publisher.publishDailySummary = (...args) => {
      publishCalls.push(args);
      return { sent: 0 };
    };

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "resolve_stale_update_from_pending",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "改成 22g",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "apply_stale_update",
        type: "function",
        function: {
          name: "update_meal",
          arguments: JSON.stringify({
            meal_id: original.id,
            protein: 22,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "這筆餐點已經有較新的紀錄，請重新整理後再修改。",
    });

    const staleTurn = await postChat("改成 22g");
    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);

    assert.equal(staleTurn.status, 200);
    assert.equal(staleTurn.body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(staleTurn.body, "summaryOutcome"), false);
    assert.doesNotMatch(staleTurn.body.reply, /已更新/);
    assert.equal(current?.mealRevisionId, externalUpdate.mealRevisionId);
    assert.equal(current?.protein, 31);
    assert.deepEqual(publishCalls, []);
  });

  it("fails closed when a resolved delete target is stale before mutation", async () => {
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T10:30:00.000Z",
      items: [
        { foodName: "牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_stale_delete_target",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "delete",
            query: "刪掉牛肉麵",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "我找到那筆牛肉麵，請確認是否刪除。",
    });

    const firstTurn = await postChat("刪掉牛肉麵");
    assert.equal(firstTurn.status, 200);
    assert.equal(firstTurn.body.didMutateMeal, false);

    const externalUpdate = await services.foodLoggingService.updateMeal(deviceId, original.id, {
      expectedMealRevisionId: original.mealRevisionId,
      items: [{
        foodName: "新版牛肉麵",
        calories: 500,
        protein: 26,
        carbs: 60,
        fat: 15,
      }],
    });
    const publishCalls: unknown[] = [];
    services.publisher.publishDailySummary = (...args) => {
      publishCalls.push(args);
      return { sent: 0 };
    };

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "resolve_stale_delete_from_pending",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "delete",
            query: "確認刪除",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "apply_stale_delete",
        type: "function",
        function: {
          name: "delete_meal",
          arguments: JSON.stringify({
            meal_id: original.id,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "這筆餐點已經有較新的紀錄，請重新整理後再刪除。",
    });

    const staleTurn = await postChat("確認刪除");
    const meals = await getMeals();
    const current = meals.find((meal) => meal.id === original.id);

    assert.equal(staleTurn.status, 200);
    assert.equal(staleTurn.body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(staleTurn.body, "summaryOutcome"), false);
    assert.doesNotMatch(staleTurn.body.reply, /已刪除/);
    assert.equal(current?.mealRevisionId, externalUpdate.mealRevisionId);
    assert.equal(current?.foodName, "新版牛肉麵");
    assert.deepEqual(publishCalls, []);
  });

  it("Phase 67 D-28/D-32/D-39 route returns stable backend clarification without raw correction echo, mutation, summaryOutcome, or publish", async () => {
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T09:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T10:00:00.000Z",
      items: [
        { foodName: "排骨", calories: 300, protein: 26, carbs: 8, fat: 18 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "find_route_renderer_owned_clarification",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把中午雞腿便當的滷蛋改成兩顆水煮蛋",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已更新中午雞腿便當的滷蛋。" });

    const { status, body } = await postChat("把中午雞腿便當的滷蛋改成兩顆水煮蛋");

    assert.equal(status, 200);
    assert.equal(mockLLM.chatCalls.length, 1);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assert.match(body.reply, /請直接回覆編號/);
    assert.match(body.reply, /1\./);
    assert.match(body.reply, /2\./);
    assert.match(body.reply, /雞腿、白飯、滷蛋、青菜/);
    assert.match(body.reply, /排骨、白飯、滷蛋、青菜/);
    assert.doesNotMatch(body.reply, /中午雞腿便當|滷蛋改成|已更新|已套用|kcal|蛋白質/);
    assert.deepEqual(publishDailySummaryCalls, []);
    assert.deepEqual(publishGoalsUpdateCalls, []);
    assert.equal(mockLLM.chatCalls.length, 1, "terminal clarification must not consume a second model reply");

    const meals = await getMeals();
    assert.equal(meals.length, 2);
    assert.ok(meals.every((meal) => meal.foodName.includes("滷蛋")));
  });
});
