process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { renderGoalAuthorityFailureCopy } from "../../server/orchestrator/mutation-receipts.js";

interface ChatBody {
  reply: string;
  didLogMeal: boolean;
  didMutateMeal?: boolean;
  affectedDate?: string;
  loggedMeal?: {
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  dailySummary?: {
    date: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  summaryOutcome?: {
    status: string;
  };
}

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

describe("chat controlled reply mutation projection", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let deviceId: string;
  let sessionCookieHeader: string;
  let services: AppServices;
  let publishCalls: Array<{ event: "daily_summary" }>;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    publishCalls = [];
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: mockLLM,
      onServicesReady(readyServices) {
        services = readyServices;
        const originalPublishDailySummary = readyServices.publisher.publishDailySummary.bind(readyServices.publisher);
        readyServices.publisher.publishDailySummary = (...args) => {
          publishCalls.push({ event: "daily_summary" });
          return originalPublishDailySummary(...args);
        };
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = (res.json() as { deviceId: string }).deviceId;
    sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  async function postChat(message: string): Promise<{ status: number; body: ChatBody }> {
    const form = new FormData();
    form.append("message", message);

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    return { status: res.status, body: await res.json() as ChatBody };
  }

  it("keeps committed meal mutation fields when a later same-round tool returns controlled copy", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "log_then_controlled_reply_log",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              items: [
                {
                  food_name: "雞腿便當",
                  calories: 620,
                  protein: 30,
                  carbs: 70,
                  fat: 18,
                },
              ],
            }),
          },
        },
        {
          id: "log_then_controlled_reply_goal_failure",
          type: "function",
          function: {
            name: "update_goals",
            arguments: JSON.stringify({ mode: "latest_proposal" }),
          },
        },
      ],
    });

    const { status, body } = await postChat("午餐我吃了雞腿便當，順便更新目標");

    assert.equal(status, 200);
    assert.equal(body.reply, renderGoalAuthorityFailureCopy());
    assert.equal(body.didLogMeal, true);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.loggedMeal?.foodName, "雞腿便當");
    assert.equal(body.summaryOutcome?.status, "fresh");
    assert.ok(body.dailySummary);
    assert.deepEqual(publishCalls, [{ event: "daily_summary" }]);

    const meals = await services.foodLoggingService.getMealsByDate(
      deviceId,
      body.affectedDate ? new Date(`${body.affectedDate}T12:00:00`) : new Date(),
    );
    assert.equal(meals.some((meal) => meal.foodName === "雞腿便當"), true);
  });
});
