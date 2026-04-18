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
  let deviceId: string;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = res.json().deviceId;
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  async function postChat(message: string): Promise<{ status: number; body: { reply: string; didLogMeal: boolean } }> {
    const form = new FormData();
    form.append("message", message);

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    return { status: res.status, body: await res.json() };
  }

  async function readTargets(): Promise<DailyTargets> {
    const res = await fetch(`${address}/api/device/goals`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-device-id": deviceId,
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

    assert.deepEqual(await readTargets(), {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });
  });

  it("keeps targets unchanged when vague intent is clarified without a tool call", async () => {
    mockLLM.queueChatResponse({ content: "你想把每日熱量或三大營養素調整成多少？" });

    const { status, body } = await postChat("我想少吃一點");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.match(body.reply, /調整成多少/);
    assert.doesNotMatch(body.reply, /已更新每日目標：/);
    assert.deepEqual(await readTargets(), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
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
