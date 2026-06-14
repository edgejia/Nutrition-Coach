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

type MultipartPart =
  | { type: "field"; name: string; value: string }
  | { type: "file"; name: string; filename: string; contentType: string; value: Buffer };

const UPDATED_TARGETS: DailyTargets = {
  calories: 1400,
  protein: 125,
  carbs: 130,
  fat: 45,
};

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function multipartPayload(parts: MultipartPart[]) {
  const boundary = `----nutrition-chat-${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if (part.type === "field") {
      chunks.push(Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
        + `${part.value}\r\n`,
      ));
    } else {
      chunks.push(Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        + `Content-Type: ${part.contentType}\r\n\r\n`,
      ));
      chunks.push(part.value);
      chunks.push(Buffer.from("\r\n"));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function field(name: string, value: string): MultipartPart {
  return { type: "field", name, value };
}

function imagePart(): MultipartPart {
  return {
    type: "file",
    name: "image",
    filename: "tiny.png",
    contentType: "image/png",
    value: ONE_PIXEL_PNG,
  };
}

function proposalContext(input: {
  proposalId: string;
  kind: "goal" | "meal_numeric" | "meal_estimate" | "meal_delete";
}) {
  return JSON.stringify({
    proposalId: input.proposalId,
    kind: input.kind,
    action: "edit",
  });
}

describe("inline edit proposal context through /api/chat", () => {
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

  async function postMultipart(parts: MultipartPart[]) {
    const multipart = multipartPayload(parts);
    return app.inject({
      method: "POST",
      url: "/api/chat",
      headers: {
        cookie: sessionCookieHeader,
        "content-type": multipart.contentType,
      },
      payload: multipart.body,
    });
  }

  async function postInlineEdit(input: {
    message: string;
    proposalId: string;
    kind: "goal" | "meal_numeric" | "meal_estimate" | "meal_delete";
  }): Promise<ChatActionBody> {
    const response = await postMultipart([
      field("message", input.message),
      field("proposalContext", proposalContext(input)),
    ]);
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
        ],
      },
      actions: {
        approveLabel: "套用目標",
        editLabel: "調整目標",
        rejectLabel: "取消提案",
      },
      expiresAt: proposal.expiresAt,
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

  async function readMeal(mealId: string, loggedAt: string) {
    const meals = await services.foodLoggingService.getMealsByDate(deviceId, new Date(loggedAt));
    return meals.find((meal) => meal.id === mealId);
  }

  async function assertNoActionEvent() {
    const history = await getHistory();
    assert.equal(
      history.some((message) => message.proposalActionEvent),
      false,
      "invalid or unclear inline edit must not create a proposal action event",
    );
  }

  it("rejects only the selected delete proposal from generic inline edit wording", async () => {
    const goalProposal = await createGoalCard();
    const { meal, proposal: deleteProposal } = await createMealDeleteCard();

    const body = await postInlineEdit({
      message: "取消提案",
      proposalId: deleteProposal.proposalId,
      kind: "meal_delete",
    });

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard?.proposalId, deleteProposal.proposalId);
    assert.equal(body.proposalCard?.proposalKind, "meal_delete");
    assert.equal(body.proposalCard?.status, "rejected");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent?.proposalId, deleteProposal.proposalId);
    assert.equal(body.proposalActionEvent?.proposalKind, "meal_delete");
    assert.equal(body.proposalActionEvent?.action, "reject");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已取消刪除提案");
    assert.ok(await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.equal(
      (await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))?.proposalId,
      goalProposal.proposalId,
    );
    assert.equal(await services.mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    assert.ok(await readMeal(meal.id, meal.loggedAt));

    const history = await getHistory();
    assert.equal(
      history.find((message) => message.proposalCard?.proposalId === goalProposal.proposalId)?.proposalCard?.status,
      "active",
    );
    const deleteCard = history.find((message) => message.proposalCard?.proposalId === deleteProposal.proposalId)?.proposalCard;
    assert.equal(deleteCard?.status, "rejected");
    assert.equal(deleteCard?.isActionable, false);
    const actionMessage = history.find((message) =>
      message.role === "user" && message.proposalActionEvent?.proposalId === deleteProposal.proposalId
    );
    assert.equal(actionMessage?.content, "取消提案");
    assert.equal(actionMessage?.proposalActionEvent?.action, "reject");
  });

  it("approves the selected estimate proposal from generic inline edit confirmation", async () => {
    await createGoalCard();
    const { meal, proposal } = await createMealEstimateCard();

    const body = await postInlineEdit({
      message: "好",
      proposalId: proposal.proposalId,
      kind: "meal_estimate",
    });

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.proposalCard?.proposalId, proposal.proposalId);
    assert.equal(body.proposalCard?.proposalKind, "meal_estimate");
    assert.equal(body.proposalCard?.status, "approved");
    assert.equal(body.proposalActionEvent?.proposalId, proposal.proposalId);
    assert.equal(body.proposalActionEvent?.proposalKind, "meal_estimate");
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已選擇套用餐點修改");

    const updatedMeal = await readMeal(meal.id, meal.loggedAt);
    assert.equal(updatedMeal?.calories, 610);
    assert.equal(updatedMeal?.protein, 36);
  });

  it("rejects malformed inline edit context without mutation or action events", async () => {
    const goalProposal = await createGoalCard();
    const { meal, proposal: deleteProposal } = await createMealDeleteCard();

    const cases: Array<{ name: string; parts: MultipartPart[] }> = [
      {
        name: "invalid JSON",
        parts: [field("message", "好"), field("proposalContext", "{")],
      },
      {
        name: "unknown keys",
        parts: [
          field("message", "好"),
          field("proposalContext", JSON.stringify({
            proposalId: deleteProposal.proposalId,
            kind: "meal_delete",
            action: "edit",
            deviceId,
          })),
        ],
      },
      {
        name: "wrong action",
        parts: [
          field("message", "好"),
          field("proposalContext", JSON.stringify({
            proposalId: deleteProposal.proposalId,
            kind: "meal_delete",
            action: "approve",
          })),
        ],
      },
      {
        name: "unknown kind",
        parts: [
          field("message", "好"),
          field("proposalContext", JSON.stringify({
            proposalId: deleteProposal.proposalId,
            kind: "meal_unknown",
            action: "edit",
          })),
        ],
      },
      {
        name: "duplicate context",
        parts: [
          field("message", "好"),
          field("proposalContext", proposalContext({ proposalId: deleteProposal.proposalId, kind: "meal_delete" })),
          field("proposalContext", proposalContext({ proposalId: deleteProposal.proposalId, kind: "meal_delete" })),
        ],
      },
      {
        name: "context plus image",
        parts: [
          field("message", "好"),
          field("proposalContext", proposalContext({ proposalId: deleteProposal.proposalId, kind: "meal_delete" })),
          imagePart(),
        ],
      },
    ];

    for (const testCase of cases) {
      const response = await postMultipart(testCase.parts);
      assert.equal(response.statusCode, 400, testCase.name);
      assert.ok(await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), testCase.name);
      assert.ok(await services.mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), testCase.name);
      assert.ok(await readMeal(meal.id, meal.loggedAt), testCase.name);
      await assertNoActionEvent();
    }

    const mismatch = await postInlineEdit({
      message: "好",
      proposalId: `wrong-${deleteProposal.proposalId}`,
      kind: "meal_delete",
    });
    assert.equal(mismatch.didLogMeal, false);
    assert.equal(mismatch.didMutateMeal, false);
    assert.equal(mismatch.proposalActionEvent, undefined);
    assert.equal(mismatch.proposalCard?.status, "stale");
    assert.ok(await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.equal(
      (await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))?.proposalId,
      goalProposal.proposalId,
    );
    assert.ok(await services.mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.ok(await readMeal(meal.id, meal.loggedAt));
    await assertNoActionEvent();
  });

  it("keeps unclear inline edit text on the normal chat path without action authority", async () => {
    const goalProposal = await createGoalCard();

    const body = await postInlineEdit({
      message: "蛋白質再低一點",
      proposalId: goalProposal.proposalId,
      kind: "goal",
    });

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.proposalCard, undefined);
    assert.equal(body.proposalActionEvent, undefined);
    assert.ok(await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));

    const history = await getHistory();
    assert.equal(
      history.some((message) => message.role === "user" && message.content === "蛋白質再低一點"),
      true,
    );
    assert.equal(
      history.find((message) => message.proposalCard?.proposalId === goalProposal.proposalId)?.proposalCard?.status,
      "active",
    );
    await assertNoActionEvent();
  });
});
