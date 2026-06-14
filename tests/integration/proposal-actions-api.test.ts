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

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

describe("proposal action API", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let deviceId: string;
  let sessionCookieHeader: string;

  beforeEach(async () => {
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      onServicesReady: (ready) => {
        services = ready;
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

  async function readTargets(): Promise<DailyTargets> {
    const response = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(response.statusCode, 200);
    return response.json().dailyTargets as DailyTargets;
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
      dailyTargets?: DailyTargets;
      proposalCard?: { status: string; isActionable: boolean; proposalId: string };
      proposalActionEvent?: { proposalId: string; proposalKind: string; action: string; transcriptCopy: string };
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
    assert.equal(body.proposalActionEvent?.proposalKind, "goal");
    assert.equal(body.proposalActionEvent?.action, "approve");
    assert.equal(body.proposalActionEvent?.transcriptCopy, "已選擇套用目標");

    const history = await app.inject({
      method: "GET",
      url: "/api/chat/history",
      headers: { cookie: sessionCookieHeader },
    });
    const historyBody = history.json() as {
      messages: Array<{ role: string; proposalActionEvent?: { proposalId: string; action: string } }>;
    };
    assert.ok(historyBody.messages.some((message) =>
      message.role === "user"
        && message.proposalActionEvent?.proposalId === proposalId
        && message.proposalActionEvent.action === "approve",
    ));

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
});
