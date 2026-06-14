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
  renderProposalKindAmbiguityCopy,
} from "../../server/orchestrator/mutation-receipts.js";
import type { createMealNumericProposalService } from "../../server/services/meal-numeric-proposals.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";
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
  proposalCard?: {
    proposalId: string;
    proposalKind: string;
    proposalLane: string;
    status: string;
    isActionable: boolean;
    title: string;
    details: { rows: Array<Record<string, unknown>> };
    actions: Record<string, string>;
    expiresAt: string | null;
  };
  proposalActionEvent?: {
    proposalId: string;
    proposalKind: string;
    action: string;
    transcriptCopy: string;
  };
}

type AppServicesWithMealProposal = AppServices & {
  mealNumericProposalService: ReturnType<typeof createMealNumericProposalService>;
};

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
  let deviceId: string;
  let sessionCookieHeader: string;
  let services: AppServicesWithMealProposal;
  let publishCalls: Array<{ event: "goals_update" }>;
  let traceRecorders: Array<ReturnType<typeof createLlmTraceRecorder>>;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  function defaultSessionKey() {
    return { deviceId, sessionId: DEFAULT_SESSION_ID };
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
      onServicesReady(appServices: AppServices) {
        const readyServices = appServices as AppServicesWithMealProposal;
        const originalPublishGoalsUpdate = readyServices.publisher.publishGoalsUpdate.bind(readyServices.publisher);
        readyServices.publisher.publishGoalsUpdate = (deviceId, targets) => {
          publishCalls.push({ event: "goals_update" });
          return originalPublishGoalsUpdate(deviceId, targets);
        };
        services = readyServices;
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

  async function readTargets(): Promise<DailyTargets> {
    const res = await fetch(`${address}/api/device/session`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { dailyTargets: DailyTargets };
    return body.dailyTargets;
  }

  async function saveMealNumericProposalCard(input: {
    proposalId: string;
    expiresAt: string;
  }) {
    const assistant = await services.chatService.saveMessage(deviceId, "assistant", "請確認這組餐點修改提案。");
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId: input.proposalId,
      proposalKind: "meal_numeric",
      proposalLane: "meal_mutation",
      title: "請確認這組餐點修改提案。",
      details: {
        rows: [
          { label: "蛋白質", before: "30 g", after: "15 g" },
        ],
      },
      actions: {
        approveLabel: "套用修改",
        editLabel: "改成其他數字",
        rejectLabel: "取消提案",
      },
      expiresAt: input.expiresAt,
    });
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

  it("returns the committed goal receipt when goals_update publish throws after persistence", async () => {
    services.publisher.publishGoalsUpdate = () => {
      throw new Error("goals_update publish failed after commit");
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_success_publish_failure",
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
    mockLLM.queueChatResponse({ content: "模型不應改寫已提交結果。" });

    const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.reply, SUCCESS_RECEIPT);
    assert.deepEqual(body.dailyTargets, SUCCESS_TARGETS);
    assert.deepEqual(await readTargets(), SUCCESS_TARGETS);
    assert.deepEqual(publishCalls, []);
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("returns the committed goal receipt when post-commit summary lookup throws", async () => {
    services.summaryService.getDailySummary = async () => {
      throw new Error("goal summary lookup failed after commit");
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_success_summary_lookup_failure",
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
    mockLLM.queueChatResponse({ content: "模型不應改寫已提交結果。" });

    const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

    assert.equal(status, 200);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.reply, SUCCESS_RECEIPT);
    assert.deepEqual(body.dailyTargets, SUCCESS_TARGETS);
    assert.deepEqual(await readTargets(), SUCCESS_TARGETS);
    assert.deepEqual(publishCalls, [{ event: "goals_update" }]);
    assert.equal(mockLLM.chatCalls.length, 1);
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
    assert.equal(body.proposalCard?.proposalKind, "goal");
    assert.equal(body.proposalCard?.proposalLane, "goal");
    assert.equal(body.proposalCard?.status, "active");
    assert.equal(body.proposalCard?.isActionable, true);
    assert.deepEqual(body.proposalCard?.details.rows.map((row) => row.after), [
      "1400 kcal",
      "125 g",
      "130 g",
      "45 g",
    ]);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.deepEqual(publishCalls, []);

    const historyRes = await fetch(`${address}/api/chat/history`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(historyRes.status, 200);
    const history = await historyRes.json() as { messages: Array<{ proposalCard?: ChatBody["proposalCard"] }> };
    const assistantProposal = history.messages.find((message) => message.proposalCard);
    assert.equal(assistantProposal?.proposalCard?.proposalId, body.proposalCard?.proposalId);
    assert.equal(assistantProposal?.proposalCard?.isActionable, true);
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
    const activeProposal = await services.goalProposalService.getLatest(defaultSessionKey());
    assert.ok(activeProposal);

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
    assert.equal(confirmed.body.reply, "已選擇套用目標");
    assert.deepEqual(confirmed.body.dailyTargets, PROPOSAL_TARGETS);
    assert.equal(confirmed.body.proposalCard?.status, "approved");
    assert.equal(confirmed.body.proposalActionEvent?.proposalId, activeProposal.proposalId);
    assert.equal(confirmed.body.proposalActionEvent?.proposalKind, "goal");
    assert.equal(confirmed.body.proposalActionEvent?.action, "approve");
    assert.equal(confirmed.body.proposalActionEvent?.transcriptCopy, "已選擇套用目標");
    assert.deepEqual(await readTargets(), PROPOSAL_TARGETS);
    assert.deepEqual(publishCalls, [{ event: "goals_update" }]);
    const confirmedTrace = traceRecorders.at(-1)?.build({ scenario: "goal-confirm-policy", status: "pass" });
    assert.ok(confirmedTrace);
    const confirmedToolResult = confirmedTrace.timeline.find((event) => event.type === "tool_result");
    assert.ok(confirmedToolResult);
    assert.equal(confirmedToolResult.policyClass, "confirm-first");
    assert.equal(confirmedToolResult.decision, "allowed");
    assert.equal(confirmedToolResult.ruleId, "typed_goal_approve");
    assert.equal(confirmedToolResult.proposalId, activeProposal.proposalId);
    assert.equal(typeof confirmedToolResult.turnId, "string");

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
    const replayedTrace = traceRecorders.at(-1)?.build({ scenario: "goal-replay-policy", status: "pass" });
    assert.ok(replayedTrace);
    const replayedToolResult = replayedTrace.timeline.find((event) => event.type === "tool_result");
    assert.ok(replayedToolResult);
    assert.equal(replayedToolResult.policyClass, "direct-execute");
    assert.equal(replayedToolResult.decision, "blocked");
    assert.equal(replayedToolResult.ruleId, "update_goals_latest_proposal_confirm_first");
    assert.equal("proposalId" in replayedToolResult, false);
    assert.equal(typeof replayedToolResult.turnId, "string");
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
      policyClass: "direct-execute",
      decision: "blocked",
      ruleId: "update_goals_latest_proposal_confirm_first",
      turnId: toolResult && "turnId" in toolResult ? toolResult.turnId : undefined,
    });
    assert.equal(typeof toolResult.turnId, "string");

    const traceJson = JSON.stringify(trace);
    for (const forbidden of [
      "好",
      renderGoalAuthorityFailureCopy(),
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
    assert.equal(cancelled.body.reply, "已取消目標提案");
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
      assert.equal(cancelled.body.reply, "已取消目標提案");
      assert.equal(cancelled.body.didLogMeal, false);
      assert.equal(cancelled.body.didMutateMeal, false);
      assert.equal(cancelled.body.dailyTargets, undefined);
      assert.doesNotMatch(cancelled.body.reply, SUCCESS_STYLE_COPY);
      assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
      assert.deepEqual(publishCalls, []);
      assert.equal(mockLLM.chatCalls.length, index + 1);
    }
  });

  it("fails closed for bare approval when goal and meal proposals coexist", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.goalProposalService.putLatest({ ...defaultSessionKey(), targets: PROPOSAL_TARGETS });
    await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    mockLLM.queueChatResponse({ content: "模型不應該選擇提案。" });

    const { status, body } = await postChat("好");

    assert.equal(status, 200);
    assert.equal(body.reply, renderProposalKindAmbiguityCopy());
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailyTargets, undefined);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.ok(await services.goalProposalService.getLatest(defaultSessionKey()));
    assert.ok(await services.mealNumericProposalService.getLatest(defaultSessionKey()));
    assert.equal(mockLLM.chatCalls.length, 0);
  });

  it("cancels goal and meal proposals together before the model runs", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.goalProposalService.putLatest({ ...defaultSessionKey(), targets: PROPOSAL_TARGETS });
    await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    mockLLM.queueChatResponse({ content: "模型不應該看到取消回合。" });

    const { status, body } = await postChat("取消");

    assert.equal(status, 200);
    assert.equal(body.reply, renderProposalKindAmbiguityCopy());
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailyTargets, undefined);
    assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.ok(await services.goalProposalService.getLatest(defaultSessionKey()));
    assert.ok(await services.mealNumericProposalService.getLatest(defaultSessionKey()));
    assert.equal(mockLLM.chatCalls.length, 0);
  });

  it("applies a kind-specific meal proposal through the stored revision and clears only meal state", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.goalProposalService.putLatest({ ...defaultSessionKey(), targets: PROPOSAL_TARGETS });
    const mealProposal = await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    await saveMealNumericProposalCard({
      proposalId: mealProposal.proposalId,
      expiresAt: mealProposal.expiresAt,
    });

    const { status, body } = await postChat("套用餐點修改");

    assert.equal(status, 200);
    assert.equal(body.reply, "已選擇套用餐點修改");
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.dailyTargets, undefined);
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalActionEvent?.proposalId, mealProposal.proposalId);
    assert.equal(body.proposalActionEvent?.proposalKind, "meal_numeric");
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
    assert.ok(await services.goalProposalService.getLatest(defaultSessionKey()));
    assert.equal(await services.mealNumericProposalService.getLatest(defaultSessionKey()), undefined);
    assert.equal(mockLLM.chatCalls.length, 0);
  });

  it("leaves meal proposal untouched when kind-specific goal approval uses the existing goal path", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.goalProposalService.putLatest({ ...defaultSessionKey(), targets: PROPOSAL_TARGETS });
    const staleProposal = await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    await saveMealNumericProposalCard({
      proposalId: staleProposal.proposalId,
      expiresAt: staleProposal.expiresAt,
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_kind_specific_latest",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "latest_proposal" }),
        },
      }],
    });

    const { status, body } = await postChat("套用目標更新");

    assert.equal(status, 200);
    assert.equal(body.reply, PROPOSAL_SUCCESS_RECEIPT);
    assert.deepEqual(body.dailyTargets, PROPOSAL_TARGETS);
    assert.deepEqual(await readTargets(), PROPOSAL_TARGETS);
    assert.equal(await services.goalProposalService.getLatest(defaultSessionKey()), undefined);
    assert.ok(await services.mealNumericProposalService.getLatest(defaultSessionKey()));
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("rejects stale meal proposal approval through the existing meal revision precondition", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await services.mealNumericProposalService.putLatest({
      ...defaultSessionKey(),
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    const externalUpdate = await services.foodLoggingService.updateMeal(deviceId, meal.id, {
      expectedMealRevisionId: meal.mealRevisionId,
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
    assert.equal(body.didMutateMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
    assert.doesNotMatch(body.reply, /已更新|蛋白質 15 g/);
    const meals = await services.foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
    const current = meals.find((candidate) => candidate.id === meal.id);
    assert.equal(current?.mealRevisionId, externalUpdate.mealRevisionId);
    assert.equal(current?.protein, 31);
    assert.ok(await services.mealNumericProposalService.getLatest(defaultSessionKey()));
    assert.equal(mockLLM.chatCalls.length, 0);
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
