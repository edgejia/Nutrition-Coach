process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { goalProposalTargetSignature } from "../../server/services/goal-proposals.js";
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
  status?: string;
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
const RECOVERABLE_COPY = "這次沒有完成套用，資料沒有變更。請再試一次，或取消這個提案。";
const IDEMPOTENT_COPY = "這個提案已經處理過，不需要再確認一次。";
const STALE_LAPSE_COPY = "這個估值修改提案已超過 30 分鐘，請重新提出修改。";

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
    await services.proposalCardService.markSupersededInLane({
      deviceId,
      proposalLane: "goal",
      replacementProposalId: proposal.proposalId,
      supersededByKind: "goal",
      lapseCopy: "這個目標提案已被新的目標提案取代。",
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
        targetSignature: goalProposalTargetSignature(targets),
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

  async function postChatWithForcedProposalActionResult(
    message: string,
    result: unknown,
  ): Promise<ChatActionBody> {
    const originalHandleAction = services.proposalActionService.handleAction;
    services.proposalActionService.handleAction = async () =>
      result as Awaited<ReturnType<typeof originalHandleAction>>;
    try {
      return await postChat(message);
    } finally {
      services.proposalActionService.handleAction = originalHandleAction;
    }
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

  function assertHistoryActionThenSingleAssistantReply(input: {
    history: HistoryMessage[];
    proposalId: string;
    reply: string;
  }) {
    const actionIndex = input.history.findIndex((message) =>
      message.role === "user" && message.proposalActionEvent?.proposalId === input.proposalId
    );
    assert.ok(actionIndex >= 0, "expected persisted typed proposal action event");

    const assistantReplies = input.history
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === "assistant" && message.content === input.reply);
    assert.equal(
      assistantReplies.length,
      1,
      "typed proposal action must persist exactly one assistant completion reply",
    );
    assert.ok(
      assistantReplies[0]!.index > actionIndex,
      "assistant completion reply should reload after the structured action event",
    );
    assert.equal(assistantReplies[0]!.message.proposalActionEvent, undefined);
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
    assert.equal(
      body.reply,
      "已更新每日目標：\n• 卡路里 1400 kcal\n• 蛋白質 125 g\n• 碳水 130 g\n• 脂肪 45 g",
    );
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
    assertHistoryActionThenSingleAssistantReply({
      history,
      proposalId: proposal.proposalId,
      reply: body.reply,
    });
    const card = history.find((message) => message.proposalCard?.proposalId === proposal.proposalId)?.proposalCard;
    assert.equal(card?.status, "approved");
    assert.equal(card?.isActionable, false);
  });

  it("typed approval applies the same newest goal target set shown on the active proposal card", async () => {
    const olderTargets = { calories: 1500, protein: 130, carbs: 150, fat: 45 };
    const newerTargets = { calories: 2200, protein: 165, carbs: 240, fat: 70 };
    const olderProposal = await createGoalCard(olderTargets);
    const newerProposal = await createGoalCard(newerTargets);

    const active = await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID });
    assert.equal(active?.proposalId, newerProposal.proposalId);
    assert.deepEqual(active?.targets, newerTargets);
    assert.equal(active?.targetSignature, goalProposalTargetSignature(newerTargets));

    const body = await postChat("好");

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.deepEqual(body.dailyTargets, newerTargets);
    assert.equal(body.proposalCard?.proposalId, newerProposal.proposalId);
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalId, newerProposal.proposalId);
    assert.equal(body.proposalActionEvent?.proposalKind, "goal");
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.deepEqual(await readTargets(), newerTargets);

    const history = await getHistory();
    assert.equal(
      history.find((message) => message.proposalCard?.proposalId === newerProposal.proposalId)?.proposalCard?.status,
      "approved",
    );
    assert.equal(
      history.find((message) => message.proposalCard?.proposalId === olderProposal.proposalId)?.proposalCard?.status,
      "superseded",
    );
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

  it("preserves retryable non-ok actionResult.reply through typed meal confirmation", async () => {
    const { proposal } = await createMealEstimateCard();

    const body = await postChatWithForcedProposalActionResult("套用餐點修改", {
      ok: false,
      status: "retryable",
      didMutateMeal: false,
      reply: RECOVERABLE_COPY,
      proposalCard: {
        proposalId: proposal.proposalId,
        proposalKind: "meal_estimate",
        proposalLane: "meal_mutation",
        status: "active",
        isActionable: true,
        title: "請確認這組估值修改提案。",
        details: { rows: [{ label: "卡路里", before: "680 kcal", after: "610 kcal" }] },
        actions: {
          approveLabel: "套用修改",
          editLabel: "改成其他數字",
          rejectLabel: "取消提案",
        },
        expiresAt: proposal.expiresAt,
        lapseCopy: STALE_LAPSE_COPY,
        supersededByKind: null,
      },
    });

    assert.equal(body.reply, RECOVERABLE_COPY);
    assert.notEqual(body.reply, STALE_LAPSE_COPY);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard?.proposalId, proposal.proposalId);
    assert.equal(body.proposalCard?.status, "active");
    assert.equal(body.proposalCard?.isActionable, true);
    assert.equal(body.proposalActionEvent, undefined);
    assert.equal(body.dailyTargets, undefined);
  });

  it("preserves idempotent non-ok actionResult.reply through typed meal confirmation", async () => {
    const { proposal } = await createMealEstimateCard();

    const body = await postChatWithForcedProposalActionResult("套用餐點修改", {
      ok: false,
      status: "idempotent",
      didMutateMeal: false,
      reply: IDEMPOTENT_COPY,
      proposalCard: {
        proposalId: proposal.proposalId,
        proposalKind: "meal_estimate",
        proposalLane: "meal_mutation",
        status: "approved",
        isActionable: false,
        title: "請確認這組估值修改提案。",
        details: { rows: [{ label: "卡路里", before: "680 kcal", after: "610 kcal" }] },
        actions: {
          approveLabel: "套用修改",
          editLabel: "改成其他數字",
          rejectLabel: "取消提案",
        },
        expiresAt: proposal.expiresAt,
        lapseCopy: STALE_LAPSE_COPY,
        supersededByKind: null,
      },
    });

    assert.equal(body.reply, IDEMPOTENT_COPY);
    assert.notEqual(body.reply, STALE_LAPSE_COPY);
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard?.proposalId, proposal.proposalId);
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent, undefined);
    assert.equal(body.dailyTargets, undefined);
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
