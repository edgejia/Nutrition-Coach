process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type {
  ProposalActionRequestAction,
  ProposalActionRequestKind,
  ProposalActionTestHooks,
} from "../../server/services/proposal-actions.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";

const RECOVERABLE_COPY = "這次沒有完成套用，資料沒有變更。請再試一次，或取消這個提案。";

interface MealSnapshot {
  id: string;
  mealRevisionId: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
  mealPeriod: string | null;
}

interface ProposalActionResponse {
  ok: boolean;
  status: string;
  didMutateMeal: boolean;
  reply?: string;
  proposalCard?: {
    proposalId: string;
    proposalKind: string;
    status: string;
    isActionable: boolean;
    lapseCopy?: string;
  };
}

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

describe("proposal action retryable recovery", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let deviceId: string;
  let sessionCookieHeader: string;
  let proposalActionTestHooks: ProposalActionTestHooks;
  let publishedDailySummaries: unknown[];

  beforeEach(async () => {
    proposalActionTestHooks = {};
    publishedDailySummaries = [];
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      proposalActionTestHooks,
      onServicesReady: (ready) => {
        services = ready;
        const originalPublishDailySummary = ready.publisher.publishDailySummary.bind(ready.publisher);
        ready.publisher.publishDailySummary = (...args) => {
          publishedDailySummaries.push(args);
          return originalPublishDailySummary(...args);
        };
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = res.json().deviceId;
    sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
  });

  afterEach(async () => {
    await app.close();
  });

  async function createMealNumericCard(kind: Extract<ProposalActionRequestKind, "meal_numeric" | "meal_estimate">) {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      mealPeriod: "lunch",
      items: [
        { foodName: "雞胸便當", calories: 640, protein: 42, carbs: 70, fat: 18 },
      ],
    }) as MealSnapshot;
    const proposalInput = {
      mealId: meal.id,
      expectedMealRevisionId: meal.mealRevisionId,
      items: [
        { foodName: "雞胸便當", calories: 590, protein: 45, carbs: 58, fat: 16 },
      ],
      affectedFields: [
        { field: "calories" as const, before: 640, after: 590 },
        { field: "protein" as const, before: 42, after: 45 },
      ],
      sourceOperator: kind === "meal_estimate" ? "estimate" : "set",
      ...(kind === "meal_estimate" ? { provenance: "model_estimate" as const } : {}),
    };
    const proposal = await services.mealNumericProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: proposalInput,
    });
    const assistant = await services.chatService.saveMessage(
      deviceId,
      "assistant",
      kind === "meal_estimate" ? "請確認這組估值修改提案。" : "請確認這組餐點修改提案。",
    );
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId: proposal.proposalId,
      proposalKind: kind,
      proposalLane: "meal_mutation",
      title: kind === "meal_estimate" ? "請確認這組估值修改提案。" : "請確認這組餐點修改提案。",
      details: {
        rows: [
          { label: "卡路里", before: "640 kcal", after: "590 kcal" },
          { label: "蛋白質", before: "42 g", after: "45 g" },
        ],
      },
      actions: {
        approveLabel: "套用修改",
        editLabel: "改成其他數字",
        rejectLabel: "取消提案",
      },
      expiresAt: proposal.expiresAt,
    });
    return { meal, proposalId: proposal.proposalId };
  }

  async function createMealDeleteCard() {
    const item = { foodName: "豆腐雞肉飯", calories: 520, protein: 38, carbs: 54, fat: 16 };
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      mealPeriod: "lunch",
      items: [item],
    }) as MealSnapshot;
    const proposal = await services.mealDeleteProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        snapshot: {
          mealId: meal.id,
          expectedMealRevisionId: meal.mealRevisionId,
          mealLabel: meal.foodName,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          dateKey: "2026-03-25",
          loggedAt: meal.loggedAt,
          mealPeriod: meal.mealPeriod === "breakfast" || meal.mealPeriod === "lunch" || meal.mealPeriod === "dinner" || meal.mealPeriod === "late_night"
            ? meal.mealPeriod
            : "lunch",
          items: [item],
        },
      },
    });
    const assistant = await services.chatService.saveMessage(deviceId, "assistant", "請確認是否刪除這筆餐點。");
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId: proposal.proposalId,
      proposalKind: "meal_delete",
      proposalLane: "meal_mutation",
      title: "請確認是否刪除這筆餐點。",
      details: {
        rows: [
          { label: "餐點", value: meal.foodName },
          { label: "熱量", value: `${meal.calories} kcal` },
        ],
      },
      actions: {
        approveLabel: "確認刪除",
        editLabel: "改用文字調整",
        rejectLabel: "取消提案",
      },
      expiresAt: proposal.expiresAt,
    });
    return { meal, proposalId: proposal.proposalId };
  }

  async function createGoalCard(proposalId = "stale-goal-proposal") {
    const assistant = await services.chatService.saveMessage(deviceId, "assistant", "請確認這組每日目標提案。");
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId,
      proposalKind: "goal",
      proposalLane: "goal",
      title: "請確認這組每日目標提案。",
      details: {
        rows: [
          { label: "卡路里", after: "1400 kcal" },
          { label: "蛋白質", after: "125 g" },
        ],
      },
      actions: {
        approveLabel: "套用目標",
        editLabel: "調整目標",
        rejectLabel: "取消提案",
      },
    });
    return proposalId;
  }

  async function approveProposal(proposalId: string, kind: ProposalActionRequestKind) {
    return app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind, action: "approve" },
    });
  }

  async function actOnProposal(proposalId: string, kind: ProposalActionRequestKind, action: ProposalActionRequestAction) {
    return app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind, action },
    });
  }

  async function readMealsFor(meal: MealSnapshot) {
    return services.foodLoggingService.getMealsByDate(deviceId, new Date(meal.loggedAt));
  }

  async function latestMeal(meal: MealSnapshot) {
    return (await readMealsFor(meal)).find((row) => row.id === meal.id);
  }

  async function assertMealUnchanged(meal: MealSnapshot) {
    const current = await latestMeal(meal);
    assert.ok(current, "expected original meal to remain visible");
    assert.equal(current.mealRevisionId, meal.mealRevisionId);
    assert.equal(current.foodName, meal.foodName);
    assert.equal(current.calories, meal.calories);
    assert.equal(current.protein, meal.protein);
    assert.equal(current.carbs, meal.carbs);
    assert.equal(current.fat, meal.fat);
    assert.equal(current.loggedAt, meal.loggedAt);
    assert.equal(current.mealPeriod, meal.mealPeriod);
  }

  async function historyMessages() {
    const history = await app.inject({
      method: "GET",
      url: "/api/chat/history",
      headers: { cookie: sessionCookieHeader },
    });
    return (history.json() as {
      messages: Array<{
        role: string;
        content: string;
        proposalActionEvent?: { proposalId: string };
      }>;
    }).messages;
  }

  async function assertNoActionArtifacts(proposalId: string, forbiddenReply: string) {
    const messages = await historyMessages();
    assert.equal(messages.some((message) => message.proposalActionEvent?.proposalId === proposalId), false);
    assert.equal(messages.some((message) => message.role === "assistant" && message.content === forbiddenReply), false);
  }

  async function assertRetryableResponse(response: Awaited<ReturnType<typeof app.inject>>, proposalId: string) {
    assert.equal(response.statusCode, 200);
    const body = response.json() as ProposalActionResponse;
    assert.equal(body.ok, false);
    assert.equal(body.status, "retryable");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, RECOVERABLE_COPY);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.status, "active");
    assert.equal(body.proposalCard?.isActionable, true);
  }

  it("keeps meal_estimate approval retryable after a non-precondition post-write failure", async () => {
    const { meal, proposalId } = await createMealNumericCard("meal_estimate");
    let postWriteHookCalls = 0;
    proposalActionTestHooks.afterDomainMutation = () => {
      postWriteHookCalls += 1;
      throw new Error("injected post-write meal estimate failure");
    };

    const failed = await approveProposal(proposalId, "meal_estimate");

    await assertRetryableResponse(failed, proposalId);
    assert.equal(postWriteHookCalls, 1, "expected fault hook to run after the real update path");
    await assertMealUnchanged(meal);
    assert.equal(publishedDailySummaries.length, 0);
    assert.equal((await services.mealNumericProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId,
    }))?.status, "active");
    await assertNoActionArtifacts(proposalId, "已更新3/25 雞胸便當，590 kcal，蛋白質 45 g。");

    proposalActionTestHooks.afterDomainMutation = undefined;
    const retried = await approveProposal(proposalId, "meal_estimate");
    assert.equal(retried.statusCode, 200);
    const retryBody = retried.json() as ProposalActionResponse;
    assert.equal(retryBody.ok, true);
    assert.equal(retryBody.status, "approved");
    assert.equal(retryBody.didMutateMeal, true);
  });

  it("keeps meal_delete approval retryable after a non-precondition post-write failure", async () => {
    const { meal, proposalId } = await createMealDeleteCard();
    let postWriteHookCalls = 0;
    proposalActionTestHooks.afterDomainMutation = () => {
      postWriteHookCalls += 1;
      throw new Error("injected post-write delete failure");
    };

    const failed = await approveProposal(proposalId, "meal_delete");

    await assertRetryableResponse(failed, proposalId);
    assert.equal(postWriteHookCalls, 1, "expected fault hook to run after the real delete path");
    await assertMealUnchanged(meal);
    assert.equal(publishedDailySummaries.length, 0);
    assert.equal((await services.mealDeleteProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId,
    }))?.status, "active");
    await assertNoActionArtifacts(proposalId, "已刪除3/25 豆腐雞肉飯，已從當日紀錄移除。");

    proposalActionTestHooks.afterDomainMutation = undefined;
    const retried = await approveProposal(proposalId, "meal_delete");
    assert.equal(retried.statusCode, 200);
    const retryBody = retried.json() as ProposalActionResponse;
    assert.equal(retryBody.ok, true);
    assert.equal(retryBody.status, "approved");
    assert.equal(retryBody.didMutateMeal, true);
    assert.equal(await latestMeal(meal), undefined);
  });

  it("proves post-write-then-throw leaves no durable partial meal or proposal state", async () => {
    const { meal, proposalId } = await createMealNumericCard("meal_numeric");
    let postWriteHookCalls = 0;
    proposalActionTestHooks.afterDomainMutation = () => {
      postWriteHookCalls += 1;
      throw new Error("injected post-write meal numeric failure");
    };

    const failed = await approveProposal(proposalId, "meal_numeric");

    await assertRetryableResponse(failed, proposalId);
    assert.equal(postWriteHookCalls, 1);
    await assertMealUnchanged(meal);
    assert.equal((await services.mealNumericProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId,
    }))?.status, "active");
    await assertNoActionArtifacts(proposalId, "已更新3/25 雞胸便當，590 kcal，蛋白質 45 g。");
    assert.equal(publishedDailySummaries.length, 0);
  });

  it("keeps MealRevisionPreconditionError stale and non-actionable instead of retryable", async () => {
    const { meal, proposalId } = await createMealNumericCard("meal_numeric");
    await services.mealCorrectionService.updateMeal(deviceId, meal.id, {
      items: [
        { foodName: "雞胸便當", calories: 650, protein: 43, carbs: 70, fat: 18 },
      ],
    }, meal.mealRevisionId);

    const response = await approveProposal(proposalId, "meal_numeric");

    assert.equal(response.statusCode, 200);
    const body = response.json() as ProposalActionResponse;
    assert.equal(body.ok, false);
    assert.equal(body.status, "stale");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, undefined);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.status, "stale");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.notEqual(body.proposalCard?.status, "retryable");
    assert.equal((await services.mealNumericProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    })), undefined);
  });

  it("does not convert goal approve, reject, or stale/no-card failures into retryable", async () => {
    const staleGoalProposalId = await createGoalCard();
    const staleGoal = await approveProposal(staleGoalProposalId, "goal");
    assert.equal(staleGoal.statusCode, 200);
    assert.equal((staleGoal.json() as ProposalActionResponse).status, "stale");

    const { proposalId: rejectProposalId } = await createMealNumericCard("meal_numeric");
    const rejected = await actOnProposal(rejectProposalId, "meal_numeric", "reject");
    assert.equal(rejected.statusCode, 200);
    assert.equal((rejected.json() as ProposalActionResponse).status, "rejected");

    const rejectReplay = await actOnProposal(rejectProposalId, "meal_numeric", "reject");
    assert.equal(rejectReplay.statusCode, 200);
    assert.equal((rejectReplay.json() as ProposalActionResponse).status, "stale");

    const noCard = await approveProposal("missing-proposal", "meal_delete");
    assert.equal(noCard.statusCode, 200);
    assert.equal((noCard.json() as ProposalActionResponse).status, "stale");

    assert.notEqual((staleGoal.json() as ProposalActionResponse).status, "retryable");
    assert.notEqual((rejected.json() as ProposalActionResponse).status, "retryable");
    assert.notEqual((rejectReplay.json() as ProposalActionResponse).status, "retryable");
    assert.notEqual((noCard.json() as ProposalActionResponse).status, "retryable");
  });

  it("keeps consumeLatest before meal mutation and retryable outside the durable callback", () => {
    const source = readFileSync("server/services/proposal-actions.ts", "utf8");
    assert.ok(
      source.indexOf("const consumed = await deps.mealNumericProposalService.consumeLatest") <
        source.indexOf("const updated = await deps.mealCorrectionService.updateMeal"),
      "meal numeric approvals must consume before updateMeal",
    );
    assert.ok(
      source.indexOf("const consumed = await deps.mealDeleteProposalService.consumeLatest") <
        source.indexOf("const deleted = await deps.mealCorrectionService.deleteMeal"),
      "meal delete approvals must consume before deleteMeal",
    );
    const durableCallbackStart = source.indexOf("decision = await runDurableDecision(async () => {");
    const durableCallbackEnd = source.indexOf("if (isMealApprovalRecoveryCandidate(input))", durableCallbackStart);
    const durableCallback = source.slice(durableCallbackStart, durableCallbackEnd);
    assert.notEqual(durableCallbackStart, -1);
    assert.notEqual(durableCallbackEnd, -1);
    assert.doesNotMatch(durableCallback, /status:\s*"retryable"/);
    assert.match(durableCallback, /MealRevisionPreconditionError[\s\S]*markStale\(input\)/);
  });
});
