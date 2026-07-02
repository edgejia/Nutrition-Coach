process.env.TZ = "Asia/Taipei";

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { chatMessages } from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  createProposalCardService,
  type ProposalCardMetadata,
  type ProposalStatusProjection,
} from "../../server/services/proposal-cards.js";

function insertChatMessage(
  db: ReturnType<typeof createDb>,
  input: {
    id: string;
    deviceId: string;
    role: "user" | "assistant";
    content?: string;
    createdAt?: string;
  },
) {
  db.insert(chatMessages).values({
    id: input.id,
    deviceId: input.deviceId,
    role: input.role,
    content: input.content ?? `${input.role} content`,
    toolName: null,
    imagePath: null,
    createdAt: input.createdAt ?? "2026-06-14T08:00:00.000Z",
    status: "complete",
  }).run();
}

function expectProjected(
  projections: ProposalStatusProjection[],
  proposalId: string,
): ProposalStatusProjection {
  const projection = projections.find((item) => item.proposalId === proposalId);
  assert.ok(projection, `expected projection for ${proposalId}`);
  return projection;
}

describe("proposal card metadata service", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let service: ReturnType<typeof createProposalCardService>;

  beforeEach(async () => {
    db = createDb(":memory:");
    deviceId = (await createDeviceService(db).createDevice("fat_loss")).deviceId;
    service = createProposalCardService(db);
  });

  it("saves and reloads one assistant proposal card with backend-supplied metadata", async () => {
    insertChatMessage(db, { id: "assistant-goal", deviceId, role: "assistant" });

    const saved = await service.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: "assistant-goal",
      proposalId: "goal-proposal-1",
      proposalKind: "goal",
      proposalLane: "goal",
      status: "active",
      title: "每日目標提案",
      details: {
        rows: [
          { label: "卡路里", before: "1800 kcal", after: "1600 kcal" },
          { label: "蛋白質", value: "120 g" },
        ],
      },
      actions: {
        approveLabel: "套用目標",
        editLabel: "調整目標",
        rejectLabel: "取消提案",
      },
      expiresAt: "2026-06-14T08:30:00.000Z",
      lapseCopy: "這個目標提案已超過 30 分鐘，請重新提出目標調整。",
    });

    assert.equal(saved.proposalId, "goal-proposal-1");
    assert.equal(saved.proposalKind, "goal");
    assert.equal(saved.proposalLane, "goal");
    assert.equal(saved.status, "active");
    assert.equal(saved.title, "每日目標提案");
    assert.equal(saved.expiresAt, "2026-06-14T08:30:00.000Z");
    assert.equal(saved.lapseCopy, "這個目標提案已超過 30 分鐘，請重新提出目標調整。");
    assert.deepEqual(saved.details.rows, [
      { label: "卡路里", before: "1800 kcal", after: "1600 kcal" },
      { label: "蛋白質", value: "120 g" },
    ]);
    assert.deepEqual(saved.actions, {
      approveLabel: "套用目標",
      editLabel: "調整目標",
      rejectLabel: "取消提案",
    });

    const cards = await service.getCardsForAssistantMessages({
      deviceId,
      assistantMessageIds: ["assistant-goal"],
    });
    assert.deepEqual(cards.get("assistant-goal"), saved);
  });

  it("supersedes only previous cards in the same lane", async () => {
    insertChatMessage(db, { id: "assistant-goal", deviceId, role: "assistant" });
    insertChatMessage(db, { id: "assistant-meal-old", deviceId, role: "assistant" });
    insertChatMessage(db, { id: "assistant-meal-new", deviceId, role: "assistant" });

    await service.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: "assistant-goal",
      proposalId: "goal-proposal",
      proposalKind: "goal",
      proposalLane: "goal",
      status: "active",
      title: "每日目標提案",
      details: { rows: [{ label: "卡路里", after: "1600 kcal" }] },
      actions: { approveLabel: "套用目標", editLabel: "調整目標", rejectLabel: "取消提案" },
    });
    await service.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: "assistant-meal-old",
      proposalId: "meal-proposal-old",
      proposalKind: "meal_numeric",
      proposalLane: "meal_mutation",
      status: "active",
      title: "餐點修改提案",
      details: { rows: [{ label: "蛋白質", before: "40 g", after: "30 g" }] },
      actions: { approveLabel: "套用修改", editLabel: "改成其他數字", rejectLabel: "取消提案" },
    });
    await service.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: "assistant-meal-new",
      proposalId: "meal-proposal-new",
      proposalKind: "meal_delete",
      proposalLane: "meal_mutation",
      status: "active",
      title: "刪除確認",
      details: { rows: [{ label: "餐點", value: "牛肉麵" }] },
      actions: { approveLabel: "確認刪除", editLabel: "先不要刪，改問別的", rejectLabel: "取消刪除" },
    });

    const count = await service.markSupersededInLane({
      deviceId,
      proposalLane: "meal_mutation",
      replacementProposalId: "meal-proposal-new",
      supersededByKind: "meal_delete",
      lapseCopy: "這個提案已被新的刪除確認取代。",
    });

    assert.equal(count, 1);
    const cards = await service.getCardsForAssistantMessages({
      deviceId,
      assistantMessageIds: ["assistant-goal", "assistant-meal-old", "assistant-meal-new"],
    });
    assert.equal(cards.get("assistant-goal")?.status, "active");
    assert.equal(cards.get("assistant-meal-old")?.status, "superseded");
    assert.equal(cards.get("assistant-meal-old")?.supersededByKind, "meal_delete");
    assert.equal(cards.get("assistant-meal-old")?.lapseCopy, "這個提案已被新的刪除確認取代。");
    assert.equal(cards.get("assistant-meal-new")?.status, "active");
  });

  it("clears stored lapse copy on terminal status transitions unless explicitly supplied", async () => {
    insertChatMessage(db, { id: "assistant-approved", deviceId, role: "assistant" });
    insertChatMessage(db, { id: "assistant-rejected", deviceId, role: "assistant" });
    insertChatMessage(db, { id: "assistant-stale", deviceId, role: "assistant" });
    insertChatMessage(db, { id: "assistant-explicit", deviceId, role: "assistant" });
    const expiredCopy = "這個目標提案已超過 30 分鐘，請重新提出目標調整。";
    const staleCopy = "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。";
    const explicitTerminalCopy = "explicit terminal copy";
    const baseInput = {
      deviceId,
      proposalKind: "goal" as const,
      proposalLane: "goal" as const,
      title: "每日目標提案",
      details: { rows: [{ label: "卡路里", after: "1600 kcal" }] },
      actions: { approveLabel: "套用目標", editLabel: "調整目標", rejectLabel: "取消提案" },
      lapseCopy: expiredCopy,
    };

    await service.saveAssistantProposalCard({
      ...baseInput,
      assistantMessageId: "assistant-approved",
      proposalId: "goal-approved",
    });
    await service.saveAssistantProposalCard({
      ...baseInput,
      assistantMessageId: "assistant-rejected",
      proposalId: "goal-rejected",
    });
    await service.saveAssistantProposalCard({
      ...baseInput,
      assistantMessageId: "assistant-stale",
      proposalId: "goal-stale",
    });
    await service.saveAssistantProposalCard({
      ...baseInput,
      assistantMessageId: "assistant-explicit",
      proposalId: "goal-explicit",
    });

    await service.markProposalStatus({ deviceId, proposalId: "goal-approved", status: "approved" });
    await service.markProposalStatus({ deviceId, proposalId: "goal-rejected", status: "rejected" });
    await service.markProposalStatus({ deviceId, proposalId: "goal-stale", status: "stale" });
    await service.markProposalStatus({
      deviceId,
      proposalId: "goal-explicit",
      status: "approved",
      lapseCopy: explicitTerminalCopy,
    });

    const cards = await service.getCardsForAssistantMessages({
      deviceId,
      assistantMessageIds: [
        "assistant-approved",
        "assistant-rejected",
        "assistant-stale",
        "assistant-explicit",
      ],
    });

    assert.equal(cards.get("assistant-approved")?.status, "approved");
    assert.equal(cards.get("assistant-approved")?.lapseCopy, null);
    assert.equal(cards.get("assistant-rejected")?.status, "rejected");
    assert.equal(cards.get("assistant-rejected")?.lapseCopy, null);
    assert.equal(cards.get("assistant-stale")?.status, "stale");
    assert.equal(cards.get("assistant-stale")?.lapseCopy, expiredCopy);
    assert.equal(cards.get("assistant-explicit")?.status, "approved");
    assert.equal(cards.get("assistant-explicit")?.lapseCopy, explicitTerminalCopy);

    await service.markProposalStatus({
      deviceId,
      proposalId: "goal-stale",
      status: "stale",
      lapseCopy: staleCopy,
    });
    const updated = await service.getCardsForAssistantMessages({
      deviceId,
      assistantMessageIds: ["assistant-stale"],
    });
    assert.equal(updated.get("assistant-stale")?.lapseCopy, staleCopy);
  });

  it("projects status from persisted metadata plus active proposal authority", async () => {
    const activeCard: ProposalCardMetadata = {
      id: "card-active",
      deviceId,
      assistantMessageId: "assistant-active",
      proposalId: "meal-active",
      proposalKind: "meal_estimate",
      proposalLane: "meal_mutation",
      status: "active",
      title: "估值修改提案",
      details: { rows: [{ label: "熱量", before: "700 kcal", after: "520 kcal" }] },
      actions: { approveLabel: "套用修改", editLabel: "改成其他數字", rejectLabel: "取消提案" },
      expiresAt: "2026-06-14T08:30:00.000Z",
      lapseCopy: "這個估值修改提案已超過 30 分鐘，請重新提出修改。",
      supersededByKind: null,
      createdAt: "2026-06-14T08:00:00.000Z",
      updatedAt: "2026-06-14T08:00:00.000Z",
    };
    const staleCard: ProposalCardMetadata = {
      ...activeCard,
      id: "card-stale",
      assistantMessageId: "assistant-stale",
      proposalId: "meal-stale",
    };
    const supersededCard: ProposalCardMetadata = {
      ...activeCard,
      id: "card-superseded",
      assistantMessageId: "assistant-superseded",
      proposalId: "meal-superseded",
      status: "superseded",
      lapseCopy: "這個提案已被新的餐點修改取代。",
    };

    const projections = service.projectStatusForCards({
      deviceId,
      cards: [staleCard, supersededCard, activeCard],
      activeProposals: [
        {
          proposalId: "meal-active",
          proposalKind: "meal_estimate",
          proposalLane: "meal_mutation",
          expiresAt: "2026-06-14T08:30:00.000Z",
        },
      ],
      now: new Date("2026-06-14T08:10:00.000Z"),
    });

    assert.deepEqual(
      projections.map((projection) => projection.proposalId),
      ["meal-stale", "meal-superseded", "meal-active"],
    );
    assert.deepEqual(
      {
        status: expectProjected(projections, "meal-active").status,
        actionable: expectProjected(projections, "meal-active").isActionable,
      },
      { status: "active", actionable: true },
    );
    assert.deepEqual(
      {
        status: expectProjected(projections, "meal-stale").status,
        actionable: expectProjected(projections, "meal-stale").isActionable,
        copy: expectProjected(projections, "meal-stale").lapseCopy,
      },
      {
        status: "stale",
        actionable: false,
        copy: "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。",
      },
    );
    assert.deepEqual(
      {
        status: expectProjected(projections, "meal-superseded").status,
        actionable: expectProjected(projections, "meal-superseded").isActionable,
        copy: expectProjected(projections, "meal-superseded").lapseCopy,
      },
      { status: "superseded", actionable: false, copy: "這個提案已被新的餐點修改取代。" },
    );
  });

  it("suppresses stale lapse copy for approved and rejected terminal card projections", async () => {
    const approvedCard: ProposalCardMetadata = {
      id: "card-approved",
      deviceId,
      assistantMessageId: "assistant-approved",
      proposalId: "goal-approved",
      proposalKind: "goal",
      proposalLane: "goal",
      status: "approved",
      title: "每日目標提案",
      details: { rows: [{ label: "卡路里", after: "2200 kcal" }] },
      actions: { approveLabel: "套用目標", editLabel: "調整目標", rejectLabel: "取消提案" },
      expiresAt: "2026-06-14T08:30:00.000Z",
      lapseCopy: "這個目標提案已超過 30 分鐘，請重新提出目標調整。",
      supersededByKind: null,
      createdAt: "2026-06-14T08:00:00.000Z",
      updatedAt: "2026-06-14T08:00:00.000Z",
    };
    const rejectedCard: ProposalCardMetadata = {
      ...approvedCard,
      id: "card-rejected",
      assistantMessageId: "assistant-rejected",
      proposalId: "goal-rejected",
      status: "rejected",
      lapseCopy: "這個目標提案已被新的目標提案取代。",
    };

    const projections = service.projectStatusForCards({
      deviceId,
      cards: [approvedCard, rejectedCard],
      activeProposals: [],
      now: new Date("2026-06-14T09:00:00.000Z"),
    });

    assert.deepEqual(
      {
        status: expectProjected(projections, "goal-approved").status,
        actionable: expectProjected(projections, "goal-approved").isActionable,
        copy: expectProjected(projections, "goal-approved").lapseCopy,
      },
      { status: "approved", actionable: false, copy: null },
    );
    assert.deepEqual(
      {
        status: expectProjected(projections, "goal-rejected").status,
        actionable: expectProjected(projections, "goal-rejected").isActionable,
        copy: expectProjected(projections, "goal-rejected").lapseCopy,
      },
      { status: "rejected", actionable: false, copy: null },
    );
  });

  it("persists proposal action events as distinct user action metadata", async () => {
    insertChatMessage(db, { id: "assistant-delete", deviceId, role: "assistant" });
    insertChatMessage(db, { id: "action-delete", deviceId, role: "user", content: "" });

    const event = await service.saveProposalActionEvent({
      deviceId,
      actionMessageId: "action-delete",
      assistantMessageId: "assistant-delete",
      proposalId: "delete-proposal-1",
      proposalKind: "meal_delete",
      proposalLane: "meal_mutation",
      action: "approve",
      transcriptCopy: "已選擇確認刪除",
    });

    assert.equal(event.actionMessageId, "action-delete");
    assert.equal(event.assistantMessageId, "assistant-delete");
    assert.equal(event.proposalId, "delete-proposal-1");
    assert.equal(event.action, "approve");
    assert.equal(event.transcriptCopy, "已選擇確認刪除");

    const events = await service.getActionEventsForMessages({
      deviceId,
      messageIds: ["action-delete"],
    });
    assert.deepEqual(events.get("action-delete"), event);
  });
});
