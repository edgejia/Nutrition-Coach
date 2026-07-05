process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { renderGoalUpdateReceipt, renderUnsafeCalorieFloorCopy } from "../../server/orchestrator/mutation-receipts.js";
import { goalProposalTargetSignature } from "../../server/services/goal-proposals.js";
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

const RECOVERABLE_PROPOSAL_ACTION_COPY = "這次沒有完成套用，資料沒有變更。請再試一次，或取消這個提案。";
const IDEMPOTENT_PROPOSAL_ACTION_COPY = "這個提案已經處理過，不需要再確認一次。";
const GOAL_PROPOSAL_EXPIRED_COPY = "這個目標提案已超過 30 分鐘，請重新提出目標調整。";

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function createLogCapture() {
  const logLines: string[] = [];
  const stream = new Writable({
    write(chunk, _, cb) {
      chunk.toString().split("\n").filter(Boolean).forEach((line: string) => logLines.push(line));
      cb();
    },
  });

  return { logLines, stream };
}

function parseJsonLogLines(logLines: string[]) {
  return logLines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function observabilityEvents(logLines: string[], eventName: string) {
  return parseJsonLogLines(logLines).filter((record) => record.event === eventName);
}

function assertLogEventApplicationKeys(event: Record<string, unknown>, allowedKeys: readonly string[]) {
  const pinoKeys = new Set(["level", "time", "pid", "hostname", "msg", "reqId"]);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(event)) {
    assert.ok(pinoKeys.has(key) || allowed.has(key), `expected ${event.event} event to exclude metadata key ${key}`);
  }
}

function assertLogEventsExclude(events: readonly Record<string, unknown>[], forbiddenValues: readonly string[]) {
  const serialized = events.map((event) => JSON.stringify(event)).join("\n");
  for (const value of forbiddenValues) {
    assert.ok(!serialized.includes(value), `expected logs to exclude ${value}`);
  }
}

describe("proposal action API", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let deviceId: string;
  let sessionCookieHeader: string;
  let proposalActionTestHooks: ProposalActionTestHooks;
  let publishedGoalUpdates: PublishRecord[];
  let publishedDailySummaries: PublishRecord[];
  let logCapture: ReturnType<typeof createLogCapture>;

  beforeEach(async () => {
    proposalActionTestHooks = {};
    publishedGoalUpdates = [];
    publishedDailySummaries = [];
    logCapture = createLogCapture();
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logCapture.stream },
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
        targetSignature: goalProposalTargetSignature(targets),
      },
      actions: {
        approveLabel: "套用目標",
        editLabel: "調整目標",
        rejectLabel: "取消提案",
      },
      lapseCopy: GOAL_PROPOSAL_EXPIRED_COPY,
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

  async function readTargets(cookieHeader = sessionCookieHeader): Promise<DailyTargets> {
    const response = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: cookieHeader },
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

  async function historyHasAssistantReply(reply: string) {
    const history = await app.inject({
      method: "GET",
      url: "/api/chat/history",
      headers: { cookie: sessionCookieHeader },
    });
    const historyBody = history.json() as {
      messages: Array<{ role: string; content: string }>;
    };
    return historyBody.messages.some((message) =>
      message.role === "assistant" && message.content === reply
    );
  }

  function mutationOutcomeRows() {
    return services.db.$client
      .prepare(`
        SELECT
          assistant_message_id AS assistantMessageId,
          action,
          affected_date AS affectedDate,
          food_name AS foodName,
          calories,
          protein,
          carbs,
          fat,
          goal_calories AS goalCalories,
          goal_protein AS goalProtein,
          goal_carbs AS goalCarbs,
          goal_fat AS goalFat,
          updated_goal_fields AS updatedGoalFields
        FROM chat_mutation_outcomes
        ORDER BY rowid
      `)
      .all() as Array<{
        assistantMessageId: string;
        action: string;
        affectedDate: string;
        foodName: string | null;
        calories: number | null;
        protein: number | null;
        carbs: number | null;
        fat: number | null;
        goalCalories: number | null;
        goalProtein: number | null;
        goalCarbs: number | null;
        goalFat: number | null;
        updatedGoalFields: string | null;
      }>;
  }

  function proposalCardRow(proposalId: string) {
    return services.db.$client
      .prepare(`
        SELECT
          status,
          lapse_copy AS lapseCopy
        FROM chat_proposal_cards
        WHERE proposal_id = ?
      `)
      .get(proposalId) as { status: string; lapseCopy: string | null } | undefined;
  }

  async function compressedHistoryContent() {
    const compressed = await services.chatService.getCompressedHistory(deviceId, 10);
    return compressed.map((message) => message.content).join("\n");
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

  it("routes proposal action mutation replies through the guarded receipt wrapper", () => {
    const source = readFileSync("server/services/proposal-actions.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    assert.match(source, /renderGuardedMutationReceipt/);
    assert.doesNotMatch(source, /renderMutationReceipt/);
    assert.match(source, /input\.mutation\?\.effects[\s\S]*renderGuardedMutationReceipt/);
  });

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

  it("rejects raw ownership selectors without mutating owner or foreign proposal state", async () => {
    const foreignDevice = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });
    const foreignDeviceId = foreignDevice.json().deviceId as string;
    const foreignCookieHeader = toCookieHeader(foreignDevice.headers["set-cookie"]);
    const originalOwnerTargets = await readTargets();
    const originalForeignTargets = await readTargets(foreignCookieHeader);
    const targets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(targets);

    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/actions?deviceId=${encodeURIComponent(foreignDeviceId)}`,
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "Raw device selector is not allowed" });
    assert.deepEqual(await readTargets(), originalOwnerTargets);
    assert.deepEqual(await readTargets(foreignCookieHeader), originalForeignTargets);
    assert.equal(await historyHasActionEvent(proposalId), false);

    const events = observabilityEvents(logCapture.logLines, "ownership_bypass_blocked");
    assert.equal(events.length, 1);
    assert.equal(typeof events[0]!.requestId, "string");
    assert.deepEqual(
      {
        event: events[0]!.event,
        reason: events[0]!.reason,
        route: events[0]!.route,
        operation: events[0]!.operation,
      },
      {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: "api_proposals_actions",
        operation: "proposal_action",
      },
    );
    assertLogEventApplicationKeys(events[0]!, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude(
      [events[0]!],
      [
        deviceId,
        foreignDeviceId,
        "x-device-id",
        "deviceId",
        "guest_session",
        "cookie",
        JSON.stringify({ proposalId, kind: "goal", action: "approve" }),
      ],
    );

    const bodySelector = await app.inject({
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
    assert.equal(bodySelector.statusCode, 400);
    assert.deepEqual(bodySelector.json(), { error: "Raw device selector is not allowed" });
    assert.deepEqual(await readTargets(), originalOwnerTargets);
    assert.equal(await historyHasActionEvent(proposalId), false);
    const allEvents = observabilityEvents(logCapture.logLines, "ownership_bypass_blocked");
    assert.equal(allEvents.length, 2);
    assert.deepEqual(
      {
        event: allEvents.at(-1)!.event,
        reason: allEvents.at(-1)!.reason,
        route: allEvents.at(-1)!.route,
        operation: allEvents.at(-1)!.operation,
      },
      {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: "api_proposals_actions",
        operation: "proposal_action",
      },
    );
    assertLogEventApplicationKeys(allEvents.at(-1)!, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude([allEvents.at(-1)!], [
      deviceId,
      "deviceId",
      "guest_session",
      "cookie",
      JSON.stringify({
        proposalId: "proposal-1",
        kind: "goal",
        action: "approve",
        deviceId,
      }),
    ]);
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
      mutationOutcomeFact?: {
        action: string;
        affectedDate: string;
        updatedGoals: Array<{ label: string; value: number; unit: string }>;
      };
      proposalCard?: { status: string; isActionable: boolean; proposalId: string };
      proposalActionEvent?: { proposalId: string; proposalKind: string; action: string; transcriptCopy: string };
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "approved");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, renderGoalUpdateReceipt(targets));
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
    assert.equal(body.mutationOutcomeFact?.action, "update_goals");
    assert.deepEqual(
      body.mutationOutcomeFact?.updatedGoals,
      [
        { label: "卡路里", value: 1400, unit: "kcal" },
        { label: "蛋白質", value: 125, unit: "g" },
        { label: "碳水", value: 130, unit: "g" },
        { label: "脂肪", value: 45, unit: "g" },
      ],
    );

    const outcomes = mutationOutcomeRows();
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.action, "update_goals");
    assert.equal(outcomes[0]?.affectedDate, body.mutationOutcomeFact?.affectedDate);
    assert.equal(outcomes[0]?.goalCalories, 1400);
    assert.equal(outcomes[0]?.goalProtein, 125);
    assert.equal(outcomes[0]?.goalCarbs, 130);
    assert.equal(outcomes[0]?.goalFat, 45);
    assert.deepEqual(JSON.parse(outcomes[0]?.updatedGoalFields ?? "[]"), ["卡路里", "蛋白質", "碳水", "脂肪"]);
    assert.deepEqual(proposalCardRow(proposalId), { status: "approved", lapseCopy: null });
    assert.ok(
      (await compressedHistoryContent()).includes(
        `[系統已更新目標：${outcomes[0]?.affectedDate} 卡路里 1400 kcal、蛋白質 125 g、碳水 130 g、脂肪 45 g]`,
      ),
      "expected compressed history to include structured goal outcome summary",
    );

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
      reply: string;
      proposalCard?: { status: string; isActionable: boolean };
    };
    assert.equal(replay.statusCode, 200);
    assert.equal(replayBody.ok, false);
    assert.equal(replayBody.status, "idempotent");
    assert.equal(replayBody.didMutateMeal, false);
    assert.equal(replayBody.reply, IDEMPOTENT_PROPOSAL_ACTION_COPY);
    assert.equal(replayBody.proposalCard?.status, "approved");
    assert.equal(replayBody.proposalCard?.isActionable, false);
    assert.deepEqual(await readTargets(), targets);
  });

  it("blocks unsafe goal proposal approval before mutating targets or publishing updates", async () => {
    const defaults = await readTargets();
    const unsafeTargets = { calories: 500, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(unsafeTargets);

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
      mutationOutcomeFact?: unknown;
      proposalCard?: {
        proposalId: string;
        status: string;
        isActionable: boolean;
        lapseCopy?: string;
      };
      proposalActionEvent?: unknown;
    };
    assert.equal(body.ok, false);
    assert.equal(body.status, "stale");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, renderUnsafeCalorieFloorCopy());
    assert.equal(body.dailyTargets, undefined);
    assert.equal(body.mutationOutcomeFact, undefined);
    assert.equal(body.proposalActionEvent, undefined);
    assert.equal(body.proposalCard?.proposalId, proposalId);
    assert.equal(body.proposalCard?.status, "stale");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalCard?.lapseCopy, renderUnsafeCalorieFloorCopy());
    assert.deepEqual(await readTargets(), defaults);
    assert.equal(await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }), undefined);
    assert.equal(await historyHasActionEvent(proposalId), false);
    assert.equal(mutationOutcomeRows().length, 0);
    assert.equal(publishedGoalUpdates.length, 0);
  });

  it("treats older same-lane goal proposal approval as stale after a newer target set exists", async () => {
    const defaults = await readTargets();
    const olderTargets = { calories: 1500, protein: 130, carbs: 150, fat: 45 };
    const newerTargets = { calories: 2200, protein: 165, carbs: 240, fat: 70 };
    const older = await createGoalCard(olderTargets);
    const newer = await createGoalCard(newerTargets);

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId: older.proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      dailyTargets?: DailyTargets;
      proposalCard?: { proposalId: string; status: string; isActionable: boolean };
      proposalActionEvent?: unknown;
    };
    assert.equal(body.ok, false);
    assert.equal(body.status, "stale");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailyTargets, undefined);
    assert.equal(body.proposalCard?.proposalId, older.proposalId);
    assert.equal(body.proposalCard?.status, "stale");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent, undefined);
    assert.deepEqual(await readTargets(), defaults);
    assert.deepEqual(
      await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }),
      {
        proposalId: newer.proposalId,
        targets: newerTargets,
        targetSignature: goalProposalTargetSignature(newerTargets),
        createdAt: (await services.goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))?.createdAt,
      },
    );
    assert.equal(mutationOutcomeRows().length, 0);
    assert.equal(publishedGoalUpdates.length, 0);
  });

  it("fails closed when the active goal proposal and persisted card target signatures disagree", async () => {
    const defaults = await readTargets();
    const visibleTargets = { calories: 2200, protein: 165, carbs: 240, fat: 70 };
    const staleTargets = { calories: 1500, protein: 130, carbs: 150, fat: 45 };
    const proposal = await services.goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: visibleTargets,
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
          { label: "卡路里", after: `${visibleTargets.calories} kcal` },
          { label: "蛋白質", after: `${visibleTargets.protein} g` },
        ],
        targetSignature: goalProposalTargetSignature(staleTargets),
      },
      actions: {
        approveLabel: "套用目標",
        editLabel: "調整目標",
        rejectLabel: "取消提案",
      },
    });
    let mutated = false;
    proposalActionTestHooks.afterDomainMutation = () => {
      mutated = true;
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId: proposal.proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      dailyTargets?: DailyTargets;
      proposalCard?: { status: string; isActionable: boolean };
      proposalActionEvent?: unknown;
    };
    assert.equal(body.ok, false);
    assert.equal(body.status, "stale");
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailyTargets, undefined);
    assert.equal(body.proposalCard?.status, "stale");
    assert.equal(body.proposalCard?.isActionable, false);
    assert.equal(body.proposalActionEvent, undefined);
    assert.equal(mutated, false);
    assert.deepEqual(await readTargets(), defaults);
    assert.equal(mutationOutcomeRows().length, 0);
    assert.equal(publishedGoalUpdates.length, 0);
  });

  it("rolls back goal approval when structured outcome persistence fails", async () => {
    const defaults = await readTargets();
    const targets = { calories: 1400, protein: 125, carbs: 130, fat: 45 };
    const { proposalId } = await createGoalCard(targets);
    const goalReply = renderGoalUpdateReceipt(targets);
    const originalSaveAssistantReplyWithReceipt = services.chatService.saveAssistantReplyWithReceipt;
    services.chatService.saveAssistantReplyWithReceipt = async () => {
      throw new Error("injected structured outcome persistence failure");
    };

    const failed = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(failed.statusCode, 500);
    assert.deepEqual(await readTargets(), defaults);
    assert.equal(await historyHasActionEvent(proposalId), false);
    assert.equal(await historyHasAssistantReply(goalReply), false);
    assert.equal(mutationOutcomeRows().length, 0);
    assert.equal((await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId,
    }))?.status, "active");

    services.chatService.saveAssistantReplyWithReceipt = originalSaveAssistantReplyWithReceipt;
    const recovered = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "goal", action: "approve" },
    });

    assert.equal(recovered.statusCode, 200);
    assert.deepEqual(await readTargets(), targets);
    assert.equal(mutationOutcomeRows().length, 1);
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
    assert.deepEqual(proposalCardRow(proposalId), { status: "rejected", lapseCopy: null });
    assert.equal(publishedGoalUpdates.length, 0);
    await assertHistoryActionReply({
      proposalId,
      action: "reject",
      transcriptCopy: "已取消目標提案",
      reply: body.reply,
    });
  });

  it("keeps superseded goal proposal rows with inactive lapse copy", async () => {
    const olderTargets = { calories: 1500, protein: 130, carbs: 150, fat: 45 };
    const newerTargets = { calories: 1600, protein: 135, carbs: 150, fat: 55 };
    const older = await createGoalCard(olderTargets);
    const newer = await createGoalCard(newerTargets);
    const supersededCopy = "這個目標提案已被新的目標提案取代。";

    const count = await services.proposalCardService.markSupersededInLane({
      deviceId,
      proposalLane: "goal",
      replacementProposalId: newer.proposalId,
      supersededByKind: "goal",
      lapseCopy: supersededCopy,
    });

    assert.equal(count, 1);
    assert.deepEqual(proposalCardRow(older.proposalId), {
      status: "superseded",
      lapseCopy: supersededCopy,
    });
    assert.deepEqual(proposalCardRow(newer.proposalId), {
      status: "active",
      lapseCopy: GOAL_PROPOSAL_EXPIRED_COPY,
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
    const goalReply = renderGoalUpdateReceipt(targets);
    assert.equal(await historyHasAssistantReply(goalReply), false);
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
    const recoveredBody = recovered.json() as {
      ok: boolean;
      reply: string;
    };
    assert.equal(recoveredBody.ok, true);
    assert.equal(recoveredBody.reply, goalReply);
    assert.deepEqual(await readTargets(), targets);
    assert.equal(publishedGoalUpdates.length, 1);
    assert.equal(publishedGoalUpdates[0]?.actionEventCount, 1);
    await assertHistoryActionReply({
      proposalId,
      action: "approve",
      transcriptCopy: "已選擇套用目標",
      reply: recoveredBody.reply,
    });
  });

  it("keeps meal delete approval retryable when the decision boundary fails before action metadata is durable", async () => {
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

    assert.equal(failed.statusCode, 200);
    const failedBody = failed.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      reply: string;
      proposalCard?: { proposalId: string; status: string; isActionable: boolean };
    };
    assert.equal(failedBody.ok, false);
    assert.equal(failedBody.status, "retryable");
    assert.equal(failedBody.didMutateMeal, false);
    assert.equal(failedBody.reply, RECOVERABLE_PROPOSAL_ACTION_COPY);
    assert.equal(failedBody.proposalCard?.proposalId, proposalId);
    assert.equal(failedBody.proposalCard?.status, "active");
    assert.equal(failedBody.proposalCard?.isActionable, true);
    assert.ok((await readMealsFor(meal)).some((row) => row.id === meal.id));
    assert.equal(publishedDailySummaries.length, 0);
    assert.equal(await historyHasActionEvent(proposalId), false);
    const deleteReply = "已刪除3/25 豆腐雞肉飯，已從當日紀錄移除。";
    assert.equal(await historyHasAssistantReply(deleteReply), false);
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
    const recoveredBody = recovered.json() as {
      ok: boolean;
      reply: string;
    };
    assert.equal(recoveredBody.ok, true);
    assert.equal(recoveredBody.reply, deleteReply);
    assert.equal((await readMealsFor(meal)).some((row) => row.id === meal.id), false);
    assert.equal(publishedDailySummaries.length, 1);
    assert.equal(publishedDailySummaries[0]?.actionEventCount, 1);
    await assertHistoryActionReply({
      proposalId,
      action: "approve",
      transcriptCopy: "已選擇確認刪除",
      reply: recoveredBody.reply,
    });
  });

  it("regression: delete approval failure after consume setup stores no deleted success claim", async () => {
    const { meal, proposalId } = await createDeleteCard();
    proposalActionTestHooks.afterDomainMutation = () => {
      throw new Error("injected delete failure after consume setup");
    };

    const failed = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: sessionCookieHeader },
      payload: { proposalId, kind: "meal_delete", action: "approve" },
    });

    assert.equal(failed.statusCode, 200);
    const failedBody = failed.json() as {
      ok: boolean;
      status: string;
      didMutateMeal: boolean;
      reply: string;
      proposalCard?: { proposalId: string; status: string; isActionable: boolean };
    };
    assert.equal(failedBody.ok, false);
    assert.equal(failedBody.status, "retryable");
    assert.equal(failedBody.didMutateMeal, false);
    assert.equal(failedBody.reply, RECOVERABLE_PROPOSAL_ACTION_COPY);
    assert.equal(failedBody.proposalCard?.proposalId, proposalId);
    assert.equal(failedBody.proposalCard?.status, "active");
    assert.equal(failedBody.proposalCard?.isActionable, true);
    assert.doesNotMatch(failed.body, /已刪除/);
    assert.equal(await historyHasAssistantReply("已刪除3/25 豆腐雞肉飯，已從當日紀錄移除。"), false);
    assert.equal((await readMealsFor(meal)).some((row) => row.id === meal.id), true);
    assert.equal((await services.mealDeleteProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }))?.proposalId, proposalId);
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
      reply?: string;
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
    assert.equal(body.reply, renderGoalUpdateReceipt(targets));
    await assertHistoryActionReply({
      proposalId,
      action: "approve",
      transcriptCopy: "已選擇套用目標",
      reply: body.reply,
    });
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
      reply?: string;
      deletedMealId?: string;
      affectedDate?: string;
      dailySummary?: unknown;
      mutationOutcomeFact?: {
        action: string;
        affectedDate: string;
        foodName: string;
        calories?: number;
        protein?: number;
      };
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
    assert.equal(body.reply, "已刪除3/25 豆腐雞肉飯，已從當日紀錄移除。");
    assert.deepEqual(body.mutationOutcomeFact, {
      action: "delete_meal",
      affectedDate: "2026-03-25",
      foodName: "豆腐雞肉飯",
      calories: 520,
      protein: 38,
    });

    const outcomes = mutationOutcomeRows();
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.action, "delete_meal");
    assert.equal(outcomes[0]?.affectedDate, "2026-03-25");
    assert.equal(outcomes[0]?.foodName, "豆腐雞肉飯");
    assert.equal(outcomes[0]?.calories, 520);
    assert.equal(outcomes[0]?.protein, 38);
    assert.ok(
      (await compressedHistoryContent()).includes(
        "[系統已刪除餐點：2026-03-25 豆腐雞肉飯，520 kcal、蛋白質 38 g]",
      ),
      "expected compressed history to include structured delete outcome summary",
    );
    await assertHistoryActionReply({
      proposalId,
      action: "approve",
      transcriptCopy: "已選擇確認刪除",
      reply: body.reply,
    });
  });
});
