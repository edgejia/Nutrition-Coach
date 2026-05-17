process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createLlmTraceRecorder } from "../../server/orchestrator/llm-trace.js";
import {
  renderGoalAuthorityFailureCopy,
  renderGoalCancelCopy,
  renderGoalProposalCopy,
  renderGoalValidationFailureCopy,
} from "../../server/orchestrator/mutation-receipts.js";
import type { FastifyInstance } from "fastify";

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface ChatBody {
  reply: string;
  didLogMeal: boolean;
  didMutateMeal?: boolean;
  dailyTargets?: DailyTargets;
}

const DEFAULT_TARGETS: DailyTargets = {
  calories: 1500,
  protein: 120,
  carbs: 150,
  fat: 50,
};

const SUCCESS_TARGETS: DailyTargets = {
  calories: 1800,
  protein: 130,
  carbs: 150,
  fat: 50,
};

const PROPOSAL_TARGETS: DailyTargets = {
  calories: 1400,
  protein: 125,
  carbs: 130,
  fat: 45,
};

const SUCCESS_RECEIPT = [
  "已更新每日目標：",
  "• 卡路里 1800 kcal",
  "• 蛋白質 130 g",
  "• 碳水 150 g",
  "• 脂肪 50 g",
].join("\n");

const PROPOSAL_SUCCESS_RECEIPT = [
  "已更新每日目標：",
  "• 卡路里 1400 kcal",
  "• 蛋白質 125 g",
  "• 碳水 130 g",
  "• 脂肪 45 g",
].join("\n");

const SUCCESS_STYLE_COPY = /已更新每日目標|已經幫你更新|更新好了/;

describe("chat goal update integration", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let sessionCookieHeader: string;
  let publishCalls: Array<{ event: "goals_update" }>;
  let traceRecorders: Array<ReturnType<typeof createLlmTraceRecorder>>;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    publishCalls = [];
    traceRecorders = [];
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: mockLLM,
      llmTraceRecorderFactory() {
        const recorder = createLlmTraceRecorder();
        traceRecorders.push(recorder);
        return recorder;
      },
      onServicesReady(services: AppServices) {
        const originalPublishGoalsUpdate = services.publisher.publishGoalsUpdate.bind(services.publisher);
        services.publisher.publishGoalsUpdate = (deviceId, targets) => {
          publishCalls.push({ event: "goals_update" });
          return originalPublishGoalsUpdate(deviceId, targets);
        };
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
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

  async function readTargets(): Promise<DailyTargets> {
    const res = await fetch(`${address}/api/device/session`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { dailyTargets: DailyTargets };
    return body.dailyTargets;
  }

  it("persists explicit current-turn targets, returns receipt, and publishes goals_update", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_success",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({
            mode: "current_turn_values",
            calories: 1800,
            protein: 130,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已經幫你更新好了。" });

    const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.reply, SUCCESS_RECEIPT);
    assert.deepEqual(body.dailyTargets, SUCCESS_TARGETS);
    assert.deepEqual(await readTargets(), SUCCESS_TARGETS);
    assert.deepEqual(publishCalls, [{ event: "goals_update" }]);
  });

  it("creates a backend proposal for vague intent without mutating targets or publishing", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_proposal",
        type: "function",
        function: {
          name: "propose_goals",
          arguments: JSON.stringify(PROPOSAL_TARGETS),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "模型不應該改寫提案。" });

    const { status, body } = await postChat("我想少吃一點，幫我建議一組目標");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, renderGoalProposalCopy(PROPOSAL_TARGETS));
    assert.equal(body.dailyTargets, undefined);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.deepEqual(publishCalls, []);
  });

  it("applies an active proposal once, then replayed consent fails closed without mutation", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_proposal_for_confirm",
        type: "function",
        function: {
          name: "propose_goals",
          arguments: JSON.stringify(PROPOSAL_TARGETS),
        },
      }],
    });
    const proposal = await postChat("我想少吃一點，幫我建議一組目標");
    assert.equal(proposal.status, 200);
    assert.equal(proposal.body.reply, renderGoalProposalCopy(PROPOSAL_TARGETS));
    assert.deepEqual(publishCalls, []);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_confirm_latest",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "latest_proposal" }),
        },
      }],
    });
    const confirmed = await postChat("好");

    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.reply, PROPOSAL_SUCCESS_RECEIPT);
    assert.deepEqual(confirmed.body.dailyTargets, PROPOSAL_TARGETS);
    assert.deepEqual(await readTargets(), PROPOSAL_TARGETS);
    assert.deepEqual(publishCalls, [{ event: "goals_update" }]);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_replay_latest",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "latest_proposal" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已經幫你更新每日目標。" });
    const replayed = await postChat("好");

    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.reply, renderGoalAuthorityFailureCopy());
    assert.equal(replayed.body.dailyTargets, undefined);
    assert.doesNotMatch(replayed.body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), PROPOSAL_TARGETS);
    assert.deepEqual(publishCalls, [{ event: "goals_update" }]);
  });

  it("fails closed for missing proposal confirmation without publishing or success prose", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_missing_proposal",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "latest_proposal" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已經幫你更新每日目標。" });

    const { status, body } = await postChat("好");

    assert.equal(status, 200);
    assert.equal(body.reply, renderGoalAuthorityFailureCopy());
    assert.equal(body.dailyTargets, undefined);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.deepEqual(publishCalls, []);
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("records rejected goal final reply metadata as renderer-owned without raw text evidence", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_trace_missing_proposal",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "latest_proposal" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已經幫你更新每日目標。" });

    const { status, body } = await postChat("好");

    assert.equal(status, 200);
    assert.equal(body.reply, renderGoalAuthorityFailureCopy());
    const trace = traceRecorders.at(-1)?.build({ scenario: "goal-missing-proposal", status: "pass" });
    assert.ok(trace);
    assert.deepEqual(trace.summary.finalReply, {
      source: "renderer",
      shape: "plain_text",
    });
    const toolResult = trace.timeline.find((event) => event.type === "tool_result");
    assert.deepEqual(toolResult, {
      type: "tool_result",
      round: 1,
      tool: "update_goals",
      success: false,
      executed: false,
      failureReason: "guard",
      updatedFields: [],
    });

    const traceJson = JSON.stringify(trace);
    for (const forbidden of [
      "好",
      renderGoalAuthorityFailureCopy(),
      "latest_proposal",
      "已經幫你更新每日目標",
      sessionCookieHeader,
      "guest_session",
      "data:image",
      "provider body",
      "database",
    ]) {
      assert.equal(traceJson.includes(forbidden), false, `trace should exclude ${forbidden}`);
    }
  });

  it("cancels an active proposal before the model runs and publishes nothing", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_proposal_for_cancel",
        type: "function",
        function: {
          name: "propose_goals",
          arguments: JSON.stringify(PROPOSAL_TARGETS),
        },
      }],
    });
    const proposal = await postChat("我想少吃一點，幫我建議一組目標");
    assert.equal(proposal.status, 200);
    assert.equal(mockLLM.chatCalls.length, 1);

    mockLLM.queueChatResponse({ content: "模型不應該看到取消回合。" });
    const cancelled = await postChat("先不用");

    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.reply, renderGoalCancelCopy());
    assert.equal(cancelled.body.didLogMeal, false);
    assert.equal(cancelled.body.didMutateMeal, false);
    assert.equal(cancelled.body.dailyTargets, undefined);
    assert.doesNotMatch(cancelled.body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.deepEqual(publishCalls, []);
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("treats negated consent as cancellation without applying the proposal", async () => {
    for (const [index, term] of ["不好", "不可以", "不行"].entries()) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `goal_proposal_for_negated_consent_${index}`,
          type: "function",
          function: {
            name: "propose_goals",
            arguments: JSON.stringify(PROPOSAL_TARGETS),
          },
        }],
      });
      const proposal = await postChat("我想少吃一點，幫我建議一組目標");
      assert.equal(proposal.status, 200);
      assert.equal(proposal.body.reply, renderGoalProposalCopy(PROPOSAL_TARGETS));

      const cancelled = await postChat(term);

      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.body.reply, renderGoalCancelCopy());
      assert.equal(cancelled.body.didLogMeal, false);
      assert.equal(cancelled.body.didMutateMeal, false);
      assert.equal(cancelled.body.dailyTargets, undefined);
      assert.doesNotMatch(cancelled.body.reply, SUCCESS_STYLE_COPY);
      assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
      assert.deepEqual(publishCalls, []);
      assert.equal(mockLLM.chatCalls.length, index + 1);
    }
  });

  it("returns validation range copy without mutation, publish, or final reply generation", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_validation",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({
            mode: "current_turn_values",
            calories: 99999,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "更新好了。" });

    const { status, body } = await postChat("卡路里改成 99999");

    assert.equal(status, 200);
    assert.equal(body.reply, renderGoalValidationFailureCopy(["calories"]));
    assert.equal(body.dailyTargets, undefined);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.deepEqual(publishCalls, []);
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("returns generic rejection copy for empty update_goals args without final reply generation", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_empty_args",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({}),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已經幫你更新每日目標。" });

    const { status, body } = await postChat("好");

    assert.equal(status, 200);
    assert.equal(body.reply, renderGoalAuthorityFailureCopy());
    assert.equal(body.dailyTargets, undefined);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.deepEqual(publishCalls, []);
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("returns generic rejection copy for update_goals without mode without final reply generation", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_missing_mode",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已經幫你更新每日目標。" });

    const { status, body } = await postChat("卡路里 1800");

    assert.equal(status, 200);
    assert.equal(body.reply, renderGoalAuthorityFailureCopy());
    assert.equal(body.dailyTargets, undefined);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.deepEqual(publishCalls, []);
    assert.equal(mockLLM.chatCalls.length, 1);
  });
});
