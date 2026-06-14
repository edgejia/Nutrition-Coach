process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface ProposalActionEventBody {
  proposalId: string;
  proposalKind: string;
  action: string;
  transcriptCopy: string;
}

interface ProposalCardBody {
  proposalId: string;
  proposalKind: string;
  status: string;
  isActionable: boolean;
  lapseCopy?: string;
}

interface ChatActionBody {
  reply: string;
  didLogMeal: boolean;
  didMutateMeal?: boolean;
  dailyTargets?: DailyTargets;
  proposalCard?: ProposalCardBody;
  proposalActionEvent?: ProposalActionEventBody;
}

interface HistoryMessage {
  id: string;
  role: string;
  content: string;
  proposalCard?: ProposalCardBody;
  proposalActionEvent?: ProposalActionEventBody;
}

const UPDATED_TARGETS: DailyTargets = {
  calories: 1400,
  protein: 125,
  carbs: 130,
  fat: 45,
};

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function multipartPayload(fields: Record<string, string>) {
  const boundary = `----nutrition-chat-${crypto.randomUUID()}`;
  const chunks = Object.entries(fields).flatMap(([name, value]) => [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="${name}"\r\n\r\n`,
    `${value}\r\n`,
  ]);
  chunks.push(`--${boundary}--\r\n`);
  return {
    body: chunks.join(""),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("typed proposal actions through /api/chat", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let deviceId: string;
  let sessionCookieHeader: string;

  beforeEach(async () => {
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      onServicesReady(ready) {
        services = ready;
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    assert.equal(res.statusCode, 200);
    deviceId = (res.json() as { deviceId: string }).deviceId;
    sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
  });

  afterEach(async () => {
    await app.close();
  });

  async function postChat(message: string): Promise<ChatActionBody> {
    const multipart = multipartPayload({ message });
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: {
        cookie: sessionCookieHeader,
        "content-type": multipart.contentType,
      },
      payload: multipart.body,
    });
    assert.equal(response.statusCode, 200);
    return response.json() as ChatActionBody;
  }

  async function getHistory(): Promise<HistoryMessage[]> {
    const response = await app.inject({
      method: "GET",
      url: "/api/chat/history",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(response.statusCode, 200);
    return (response.json() as { messages: HistoryMessage[] }).messages;
  }

  async function createGoalCard(targets: DailyTargets = UPDATED_TARGETS) {
    const proposal = await services.goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets,
    });
    const assistant = await services.chatService.saveMessage(deviceId, "assistant", "請確認這組每日目標提案。");
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId: proposal.proposalId,
      proposalKind: "goal",
      proposalLane: "goal",
      title: "請確認這組每日目標提案。",
      details: {
        rows: [
          { label: "卡路里", after: `${targets.calories} kcal` },
          { label: "蛋白質", after: `${targets.protein} g` },
          { label: "碳水", after: `${targets.carbs} g` },
          { label: "脂肪", after: `${targets.fat} g` },
        ],
      },
      actions: {
        approveLabel: "套用目標",
        editLabel: "調整目標",
        rejectLabel: "取消提案",
      },
    });
    return proposal;
  }

  async function createMealDeleteCard() {
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
    return { meal, proposal };
  }

  async function createMealEstimateCard() {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T12:30:00.000Z",
      mealPeriod: "dinner",
      items: [
        { foodName: "鮭魚飯", calories: 680, protein: 34, carbs: 78, fat: 24 },
      ],
    });
    const proposal = await services.mealNumericProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        items: [
          { foodName: "鮭魚飯", calories: 610, protein: 36, carbs: 68, fat: 20 },
        ],
        affectedFields: [
          { field: "calories", before: 680, after: 610 },
          { field: "protein", before: 34, after: 36 },
        ],
        sourceOperator: "estimate",
        provenance: "model_estimate",
      },
    });
    const assistant = await services.chatService.saveMessage(deviceId, "assistant", "請確認這組估值修改提案。");
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId: proposal.proposalId,
      proposalKind: "meal_estimate",
      proposalLane: "meal_mutation",
      title: "請確認這組估值修改提案。",
      details: {
        rows: [
          { label: "卡路里", before: "680 kcal", after: "610 kcal" },
          { label: "蛋白質", before: "34 g", after: "36 g" },
        ],
      },
      actions: {
        approveLabel: "套用修改",
        editLabel: "改成其他數字",
        rejectLabel: "取消提案",
      },
      expiresAt: proposal.expiresAt,
    });
    return { meal, proposal };
  }

  async function readTargets(): Promise<DailyTargets> {
    const response = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(response.statusCode, 200);
    return (response.json() as { dailyTargets: DailyTargets }).dailyTargets;
  }

  async function readMeal(mealId: string, loggedAt: string) {
    const meals = await services.foodLoggingService.getMealsByDate(deviceId, new Date(loggedAt));
    return meals.find((meal) => meal.id === mealId);
  }

  function assertHistoryAction(input: {
    history: HistoryMessage[];
    proposalId: string;
    kind: string;
    action: string;
    transcriptCopy: string;
    typedText: string;
  }) {
    const actionMessages = input.history.filter((message) =>
      message.role === "user" && message.proposalActionEvent?.proposalId === input.proposalId
    );
    assert.equal(actionMessages.length, 1);
    assert.equal(actionMessages[0]?.content, input.typedText);
    assert.equal(actionMessages[0]?.proposalActionEvent?.proposalKind, input.kind);
    assert.equal(actionMessages[0]?.proposalActionEvent?.action, input.action);
    assert.equal(actionMessages[0]?.proposalActionEvent?.transcriptCopy, input.transcriptCopy);
    assert.equal(
      input.history.some((message) => message.role === "user" && message.content === input.transcriptCopy),
      false,
      "typed /api/chat action must not create an extra ordinary user action message",
    );
  }

  it("approves a goal proposal from typed chat text and reloads as a structured action event", async () => {
    const proposal = await createGoalCard();

    const body = await postChat("好");

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.deepEqual(body.dailyTargets, UPDATED_TARGETS);
    assert.equal(body.proposalCard?.proposalId, proposal.proposalId);
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalId, proposal.proposalId);
    assert.equal(body.proposalActionEvent?.proposalKind, "goal");
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已選擇套用目標");
    assert.deepEqual(await readTargets(), UPDATED_TARGETS);

    const history = await getHistory();
    assertHistoryAction({
      history,
      proposalId: proposal.proposalId,
      kind: "goal",
      action: "approve",
      transcriptCopy: "已選擇套用目標",
      typedText: "好",
    });
    const card = history.find((message) => message.proposalCard?.proposalId === proposal.proposalId)?.proposalCard;
    assert.equal(card?.status, "approved");
    assert.equal(card?.isActionable, false);
  });

  it("rejects a delete proposal from typed cancel text without deleting the meal", async () => {
    const { meal, proposal } = await createMealDeleteCard();

    const body = await postChat("取消刪除");

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard?.proposalId, proposal.proposalId);
    assert.equal(body.proposalCard?.status, "rejected");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalKind, "meal_delete");
    assert.equal(body.proposalActionEvent?.action, "reject");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已取消刪除提案");
    assert.ok(await readMeal(meal.id, meal.loggedAt));

    const history = await getHistory();
    assertHistoryAction({
      history,
      proposalId: proposal.proposalId,
      kind: "meal_delete",
      action: "reject",
      transcriptCopy: "已取消刪除提案",
      typedText: "取消刪除",
    });
    const card = history.find((message) => message.proposalCard?.proposalId === proposal.proposalId)?.proposalCard;
    assert.equal(card?.status, "rejected");
    assert.equal(card?.isActionable, false);
  });

  it("approves a model-estimate meal proposal from typed chat text without leaving a stale card", async () => {
    const { meal, proposal } = await createMealEstimateCard();

    const body = await postChat("套用餐點修改");

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.proposalCard?.proposalId, proposal.proposalId);
    assert.equal(body.proposalCard?.proposalKind, "meal_estimate");
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalKind, "meal_estimate");
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已選擇套用餐點修改");
    const updatedMeal = await readMeal(meal.id, meal.loggedAt);
    assert.equal(updatedMeal?.calories, 610);
    assert.equal(updatedMeal?.protein, 36);

    const history = await getHistory();
    assertHistoryAction({
      history,
      proposalId: proposal.proposalId,
      kind: "meal_estimate",
      action: "approve",
      transcriptCopy: "已選擇套用餐點修改",
      typedText: "套用餐點修改",
    });
    const card = history.find((message) => message.proposalCard?.proposalId === proposal.proposalId)?.proposalCard;
    assert.equal(card?.status, "approved");
    assert.equal(card?.isActionable, false);
    assert.equal(card?.lapseCopy ?? undefined, undefined);
  });

  it("fails closed for ambiguous bare approval when multiple proposal lanes are active", async () => {
    const goalProposal = await createGoalCard();
    const { meal, proposal: deleteProposal } = await createMealDeleteCard();

    const body = await postChat("好");

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard, undefined);
    assert.equal(body.proposalActionEvent, undefined);
    assert.ok(await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.ok(await services.mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.ok(await readMeal(meal.id, meal.loggedAt));

    const history = await getHistory();
    assert.equal(
      history.some((message) => message.proposalActionEvent),
      false,
      "ambiguous typed approval must not create an action event",
    );
    assert.equal(
      history.find((message) => message.proposalCard?.proposalId === goalProposal.proposalId)?.proposalCard?.status,
      "active",
    );
    assert.equal(
      history.find((message) => message.proposalCard?.proposalId === deleteProposal.proposalId)?.proposalCard?.status,
      "active",
    );
  });
});
