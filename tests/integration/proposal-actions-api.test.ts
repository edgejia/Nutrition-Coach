process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { ProposalActionTestHooks } from "../../server/services/proposal-actions.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface PublishRecord {
  args: unknown[];
  actionEventCount: number;
}

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

describe("proposal action API", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let deviceId: string;
  let sessionCookieHeader: string;
  let proposalActionTestHooks: ProposalActionTestHooks;
  let publishedGoalUpdates: PublishRecord[];
  let publishedDailySummaries: PublishRecord[];

  beforeEach(async () => {
    proposalActionTestHooks = {};
    publishedGoalUpdates = [];
    publishedDailySummaries = [];
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      proposalActionTestHooks,
      onServicesReady: (ready) => {
        services = ready;
        const countActionEvents = () => {
          const row = ready.db.$client
            .prepare("SELECT count(*) AS count FROM chat_proposal_action_events")
            .get() as { count: number };
          return row.count;
        };
        const originalPublishGoalsUpdate = ready.publisher.publishGoalsUpdate.bind(ready.publisher);
        ready.publisher.publishGoalsUpdate = (...args) => {
          publishedGoalUpdates.push({ args, actionEventCount: countActionEvents() });
          return originalPublishGoalsUpdate(...args);
        };
        const originalPublishDailySummary = ready.publisher.publishDailySummary.bind(ready.publisher);
        ready.publisher.publishDailySummary = (...args) => {
          publishedDailySummaries.push({ args, actionEventCount: countActionEvents() });
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

  async function createGoalCard(targets: DailyTargets, proposalId?: string) {
    const proposal = proposalId
      ? undefined
      : await services.goalProposalService.putLatest({
          deviceId,
          sessionId: DEFAULT_SESSION_ID,
          targets,
        });
    const assistant = await services.chatService.saveMessage(deviceId, "assistant", "請確認這組每日目標提案。");
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId: proposalId ?? proposal!.proposalId,
      proposalKind: "goal",
      proposalLane: "goal",
      title: "請確認這組每日目標提案。",
      details: {
        rows: [
          { label: "卡路里", after: `${targets.calories} kcal` },
          { label: "蛋白質", after: `${targets.protein} g` },
        ],
      },
      actions: {
        approveLabel: "套用目標",
        editLabel: "調整目標",
        rejectLabel: "取消提案",
      },
    });
    return { proposalId: proposalId ?? proposal!.proposalId, assistantMessageId: assistant.id };
  }

  async function createDeleteCard() {
    const item = { foodName: "豆腐雞肉飯", calories: 520, protein: 38, carbs: 54, fat: 16 };
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      mealPeriod: "lunch",
      items: [item],
    });
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
          mealPeriod: meal.mealPeriod ?? "lunch",
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

  async function readTargets(): Promise<DailyTargets> {
    const response = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(response.statusCode, 200);
    return response.json().dailyTargets as DailyTargets;
  }

  async function readMealsFor(meal: { loggedAt: string }) {
    return services.foodLoggingService.getMealsByDate(deviceId, new Date(meal.loggedAt));
  }

  async function historyHasActionEvent(proposalId: string) {
    const history = await app.inject({
      method: "GET",
      url: "/api/chat/history",
      headers: { cookie: sessionCookieHeader },
    });
    const historyBody = history.json() as {
      messages: Array<{ proposalActionEvent?: { proposalId: string } }>;
    };
    return historyBody.messages.some((message) => message.proposalActionEvent?.proposalId === proposalId);
  }

  async function assertHistoryActionReply(input: {
    proposalId: string;
    action: string;
    transcriptCopy: string;
    reply: string;
  }) {
    const history = await app.inject({
      method: "GET",
      url: "/api/chat/history",
      headers: { cookie: sessionCookieHeader },
    });
    const historyBody = history.json() as {
      messages: Array<{
        role: string;
        content: string;
        proposalActionEvent?: { proposalId: string; action: string; transcriptCopy: string };
        proposalCard?: unknown;
      }>;
    };
    const actionIndex = historyBody.messages.findIndex((message) =>
      message.role === "user"
        && message.content === input.transcriptCopy
        && message.proposalActionEvent?.proposalId === input.proposalId
        && message.proposalActionEvent.action === input.action
        && message.proposalActionEvent.transcriptCopy === input.transcriptCopy
    );
    assert.ok(actionIndex >= 0, "expected persisted proposal action event in chat history");
    const replyMessage = historyBody.messages[actionIndex + 1];
    assert.equal(replyMessage?.role, "assistant");
    assert.equal(replyMessage.content, input.reply);
    assert.equal(replyMessage.proposalActionEvent, undefined);
    assert.equal(replyMessage.proposalCard, undefined);
  }

  it("requires cookie-backed ownership and rejects client-supplied ownership fields", async () => {
    const missingSession = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { "x-device-id": deviceId },
      payload: {
        proposalId: "proposal-1",
        kind: "goal",
        action: "approve",
        deviceId,
      },
    });
    assert.equal(missingSession.statusCode, 401);

    const extraField = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: {
        proposalId: "proposal-1",
        kind: "goal",
        action: "approve",
        deviceId,
      },
    });
    assert.equal(extraField.statusCode, 400);
  });

  it("approves an active goal proposal, updates targets, and records a transcript action event", async () => {
    const targets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(targets);

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      reply?: string;
      dailyTargets?: DailyTargets;
      proposalCard?: { status: string; isActionable: boolean; proposalId: string };
      proposalActionEvent?: { proposalId: string; proposalKind: string; action: string; transcriptCopy: string };
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "approved");
    assert.equal(body.didMutateMeal, false);
    assert.equal(
      body.reply,
      "已更新每日目標：\n• 卡路里 1400 kcal\n• 蛋白質 125 g\n• 碳水 130 g\n• 脂肪 45 g",
    );
    assert.deepEqual(body.dailyTargets, targets);
    assert.deepEqual(await readTargets(), targets);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalId, proposalId);
    assert.equal(body.proposalActionEvent?.proposalKind, "goal");
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已選擇套用目標");
    assert.equal(publishedGoalUpdates.length, 1);
    assert.equal(publishedGoalUpdates[0]?.actionEventCount, 1);

    await assertHistoryActionReply({
      proposalId,
      action: "approve",
      transcriptCopy: "已選擇套用目標",
      reply: body.reply,
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });
    const replayBody = replay.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      proposalCard?: { status: string; isActionable: boolean };
    };
    assert.equal(replay.statusCode, 200);
    assert.equal(replayBody.ok, false);
    assert.equal(replayBody.status, "stale");
    assert.equal(replayBody.didMutateMeal, false);
    assert.equal(replayBody.proposalCard?.status, "approved");
    assert.equal(replayBody.proposalCard?.isActionable, false);
    assert.deepEqual(await readTargets(), targets);
  });

  it("rejects an active goal proposal with deterministic assistant reply copy", async () => {
    const defaults = await readTargets();
    const targets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(targets);

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "reject" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      reply?: string;
      proposalCard?: { proposalId: string; status: string; isActionable: boolean };
      proposalActionEvent?: { proposalId: string; proposalKind: string; action: string; transcriptCopy: string };
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "rejected");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, "已取消這組目標提案，沒有套用任何更新。之後可以直接提供新的目標數字，或再請我產生一組建議。");
    assert.deepEqual(await readTargets(), defaults);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.status, "rejected");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalId, proposalId);
    assert.equal(body.proposalActionEvent?.proposalKind, "goal");
    assert.equal(body.proposalActionEvent?.action, "reject");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已取消目標提案");
    assert.equal(publishedGoalUpdates.length, 0);
    await assertHistoryActionReply({
      proposalId,
      action: "reject",
      transcriptCopy: "已取消目標提案",
      reply: body.reply,
    });
  });

  it("rolls back goal approval when the decision boundary fails before action metadata is durable", async () => {
    const defaults = await readTargets();
    const targets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(targets);
    proposalActionTestHooks.afterDomainMutation = () => {
      throw new Error("injected proposal action failure");
    };

    const failed = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(failed.statusCode, 500);
    assert.deepEqual(await readTargets(), defaults);
    assert.equal(publishedGoalUpdates.length, 0);
    assert.equal(await historyHasActionEvent(proposalId), false);
    assert.equal((await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId,
    }))?.status, "active");

    proposalActionTestHooks.afterDomainMutation = undefined;
    const recovered = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.json().ok, true);
    assert.deepEqual(await readTargets(), targets);
    assert.equal(publishedGoalUpdates.length, 1);
    assert.equal(publishedGoalUpdates[0]?.actionEventCount, 1);
    assert.equal(await historyHasActionEvent(proposalId), true);
  });

  it("rolls back meal delete approval when the decision boundary fails before action metadata is durable", async () => {
    const { meal, proposalId } = await createDeleteCard();
    proposalActionTestHooks.afterDomainMutation = () => {
      throw new Error("injected proposal action failure");
    };

    const failed = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "meal_delete", action: "approve" },
    });

    assert.equal(failed.statusCode, 500);
    assert.ok((await readMealsFor(meal)).some((row) => row.id === meal.id));
    assert.equal(publishedDailySummaries.length, 0);
    assert.equal(await historyHasActionEvent(proposalId), false);
    assert.equal((await services.mealDeleteProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId,
    }))?.status, "active");

    proposalActionTestHooks.afterDomainMutation = undefined;
    const recovered = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "meal_delete", action: "approve" },
    });

    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.json().ok, true);
    assert.equal((await readMealsFor(meal)).some((row) => row.id === meal.id), false);
    assert.equal(publishedDailySummaries.length, 1);
    assert.equal(publishedDailySummaries[0]?.actionEventCount, 1);
    assert.equal(await historyHasActionEvent(proposalId), true);
  });

  it("fails closed for stale proposal actions without mutating targets or creating action events", async () => {
    const defaults = await readTargets();
    const { proposalId } = await createGoalCard(
      { calories: 1400, protein: 125, carbs: 130, fat: 45 },
      "stale-goal-proposal",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      proposalCard?: { status: string; isActionable: boolean; lapseCopy?: string };
    };
    assert.equal(body.ok, false);
    assert.equal(body.status, "stale");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard?.status, "stale");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalCard?.lapseCopy, "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。");
    assert.deepEqual(await readTargets(), defaults);

    const history = await app.inject({
      method: "GET",
      url: "/api/chat/history",
      headers: { cookie: sessionCookieHeader },
    });
    const historyBody = history.json() as { messages: Array<{ proposalActionEvent?: unknown }> };
    assert.equal(historyBody.messages.some((message) => message.proposalActionEvent), false);
  });

  it("marks an older same-kind card stale without clearing the newer backend proposal", async () => {
    const defaults = await readTargets();
    const olderTargets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const newerTargets = { calories: 1600, protein: 135, carbs: 150, fat: 55 };
    const { proposalId: olderProposalId } = await createGoalCard(olderTargets);
    const newerProposal = await services.goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: newerTargets,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId: olderProposalId, kind: "goal", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      proposalCard?: { proposalId: string; status: string; isActionable: boolean };
    };
    assert.equal(body.ok, false);
    assert.equal(body.status, "stale");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard?.proposalId, olderProposalId);
    assert.equal(body.proposalCard?.status, "stale");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.deepEqual(await readTargets(), defaults);
    assert.equal((await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, newerProposal.proposalId);
    assert.equal(await historyHasActionEvent(olderProposalId), false);
  });

  it("fails closed for mismatched action kind without deactivating the active card", async () => {
    const defaults = await readTargets();
    const targets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(targets);

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "meal_delete", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      proposalCard?: {
        status: string;
        isActionable: boolean;
        proposalKind: string;
        proposalId: string;
      };
    };
    assert.equal(body.ok, false);
    assert.equal(body.status, "stale");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.proposalKind, "goal");
    assert.equal(body.proposalCard?.status, "active");
    assert.equal(body.proposalCard?.isActionable, true);
    assert.deepEqual(await readTargets(), defaults);
    assert.equal(await historyHasActionEvent(proposalId), false);

    const storedCard = await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId,
    });
    assert.equal(storedCard?.status, "active");
    assert.equal((await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
  });

  it("returns committed goal action metadata when goals_update publish fails after commit", async () => {
    const targets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(targets);
    services.publisher.publishGoalsUpdate = () => {
      throw new Error("goals_update publish failed after commit");
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      dailyTargets?: DailyTargets;
      proposalCard?: { proposalId: string; status: string; isActionable: boolean };
      proposalActionEvent?: { proposalId: string; action: string; transcriptCopy: string };
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "approved");
    assert.equal(body.didMutateMeal, false);
    assert.deepEqual(body.dailyTargets, targets);
    assert.deepEqual(await readTargets(), targets);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalId, proposalId);
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已選擇套用目標");
    assert.equal(await historyHasActionEvent(proposalId), true);
  });

  it("returns committed delete action metadata when daily_summary publish fails after commit", async () => {
    const { meal, proposalId } = await createDeleteCard();
    services.publisher.publishDailySummary = () => {
      throw new Error("daily_summary publish failed after commit");
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "meal_delete", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      deletedMealId?: string;
      affectedDate?: string;
      dailySummary?: unknown;
      proposalCard?: { proposalId: string; status: string; isActionable: boolean };
      proposalActionEvent?: { proposalId: string; action: string; transcriptCopy: string };
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "approved");
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.deletedMealId, meal.id);
    assert.equal(body.affectedDate, "2026-03-25");
    assert.ok(body.dailySummary);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalId, proposalId);
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已選擇確認刪除");
    assert.equal((await readMealsFor(meal)).some((row) => row.id === meal.id), false);
    assert.equal(await historyHasActionEvent(proposalId), true);
  });
});
