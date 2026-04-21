process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

describe("chat goal update integration", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let sessionCookieHeader: string;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  async function postChat(message: string): Promise<{
    status: number;
    body: { reply: string; didLogMeal: boolean; dailyTargets?: DailyTargets };
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

  async function readTargets(): Promise<DailyTargets> {
    const res = await fetch(`${address}/api/device/goals`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookieHeader,
      },
      body: JSON.stringify({ fat: 50 }),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { dailyTargets: DailyTargets };
    return body.dailyTargets;
  }

  it("persists explicit target numbers and returns the deterministic receipt", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_success",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g",
    });

    const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.match(body.reply, /已更新每日目標：/);
    assert.match(body.reply, /卡路里 1800 kcal/);
    assert.match(body.reply, /蛋白質 130 g/);
    assert.deepEqual(body.dailyTargets, {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });

    assert.deepEqual(await readTargets(), {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });
  });

  it("appends the deterministic receipt when the final model reply omits it", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_success_omitted_receipt",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已經幫你更新好了。" });

    const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

    assert.equal(status, 200);
    assert.match(body.reply, /已經幫你更新好了/);
    assert.match(body.reply, /已更新每日目標：/);
    assert.match(body.reply, /卡路里 1800 kcal/);
    assert.match(body.reply, /蛋白質 130 g/);
    assert.deepEqual(body.dailyTargets, {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });
    assert.deepEqual(await readTargets(), {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });
  });

  it("returns the deterministic receipt when final reply generation fails after mutation", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_success_reply_error",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    mockLLM.queueChatError(new Error("reply generation failed"));

    const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

    assert.equal(status, 200);
    assert.equal(body.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.deepEqual(body.dailyTargets, {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });
    assert.deepEqual(await readTargets(), {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });
  });

  it("keeps targets unchanged when vague intent gets a recommendation without a tool call", async () => {
    mockLLM.queueChatResponse({
      content:
        "如果你想少吃一點，我建議先調成：\n- 熱量：1400 kcal\n- 蛋白質：120 g\n- 碳水化合物：130 g\n- 脂肪：45 g\n\n要幫你套用這組目標嗎？",
    });

    const { status, body } = await postChat("我想少吃一點");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.match(body.reply, /建議/);
    assert.match(body.reply, /1400 kcal/);
    assert.match(body.reply, /要幫你套用/);
    assert.doesNotMatch(body.reply, /已更新每日目標：/);
    assert.deepEqual(await readTargets(), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
  });

  it("updates targets when the user confirms the previous assistant recommendation", async () => {
    mockLLM.queueChatResponse({
      content:
        "如果你想少吃一點，我建議先調成：\n- 熱量：1400 kcal\n- 蛋白質：120 g\n- 碳水化合物：130 g\n- 脂肪：45 g\n\n要幫你套用這組目標嗎？",
    });

    const first = await postChat("我想少吃一點");
    assert.equal(first.status, 200);
    assert.doesNotMatch(first.body.reply, /已更新每日目標：/);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_confirm_recommendation",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1400, protein: 120, carbs: 130, fat: 45 }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已更新每日目標：\n• 卡路里 1400 kcal\n• 蛋白質 120 g\n• 碳水 130 g\n• 脂肪 45 g",
    });

    const { status, body } = await postChat("好");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.match(body.reply, /已更新每日目標：/);
    assert.deepEqual(body.dailyTargets, {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });
  });

  it("turns source-guard rejection into clarification and does not mutate targets", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_guard",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1700 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "你想把卡路里調整成多少？請提供具體數字。" });

    const { status, body } = await postChat("我想少吃一點");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.match(body.reply, /具體數字|調整成多少/);
    assert.doesNotMatch(body.reply, /已更新每日目標：/);
    assert.deepEqual(await readTargets(), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
  });

  it("turns validation rejection into clarification and does not mutate targets", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_validation",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 99999 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "請提供 500 到 8000 之間的每日卡路里目標。" });

    const { status, body } = await postChat("卡路里改成 99999");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.match(body.reply, /500 到 8000/);
    assert.doesNotMatch(body.reply, /已更新每日目標：/);
    assert.deepEqual(await readTargets(), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
  });
});
