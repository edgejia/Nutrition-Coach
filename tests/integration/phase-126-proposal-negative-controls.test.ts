process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import {
  goalProposalTargetSignature,
  type GoalProposalPayload,
} from "../../server/services/goal-proposals.js";
import type {
  ProposalActionRequestAction,
  ProposalActionTestHooks,
} from "../../server/services/proposal-actions.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";

type ExtendedProposalActionTestHooks = ProposalActionTestHooks & {
  beforeDecision?: (input: {
    action: ProposalActionRequestAction;
  }) => void | Promise<void>;
};

type ProposalChatService = AppServices["chatService"] & {
  saveAssistantReplyWithReceiptSync?: (...args: never[]) => unknown;
};

function countRows(
  services: AppServices,
  table: "chat_messages" | "chat_proposal_action_events" | "chat_mutation_outcomes" | "chat_proposal_cards" | "turn_states",
  deviceId: string,
): number {
  const row = services.db.$client
    .prepare(`SELECT count(*) AS count FROM ${table} WHERE device_id = ?`)
    .get(deviceId) as { count: number };
  return row.count;
}

function countPublished(published: unknown[]): number {
  return published.length;
}

async function flushQueuedWrites(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("phase-126 proposal transaction negative controls", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let proposalActionTestHooks: ExtendedProposalActionTestHooks;
  let publishedGoalUpdates: unknown[];

  beforeEach(async () => {
    proposalActionTestHooks = {};
    publishedGoalUpdates = [];
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      proposalActionTestHooks,
      onServicesReady: (ready) => {
        services = ready;
        const originalPublish = ready.publisher.publishGoalsUpdate.bind(ready.publisher);
        ready.publisher.publishGoalsUpdate = (...args) => {
          publishedGoalUpdates.push(args);
          return originalPublish(...args);
        };
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createDevice() {
    const response = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    assert.equal(response.statusCode, 200);
    return (response.json() as { deviceId: string }).deviceId;
  }

  function readDevice(deviceId: string) {
    return services.db.$client
      .prepare(`
        SELECT
          daily_calories AS dailyCalories,
          daily_protein AS dailyProtein,
          daily_carbs AS dailyCarbs,
          daily_fat AS dailyFat,
          session_version AS sessionVersion
        FROM devices
        WHERE id = ?
      `)
      .get(deviceId) as {
        dailyCalories: number;
        dailyProtein: number;
        dailyCarbs: number;
        dailyFat: number;
        sessionVersion: number;
      } | undefined;
  }

  async function createGoalProposal(deviceId: string): Promise<GoalProposalPayload> {
    const targets = {
      calories: 1400,
      protein: 125,
      carbs: 130,
      fat: 45,
    };
    const proposal = await services.goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets,
    });
    const assistant = await services.chatService.saveMessage(deviceId, "assistant", "proposal");
    await services.proposalCardService.saveAssistantProposalCard({
      deviceId,
      assistantMessageId: assistant.id,
      proposalId: proposal.proposalId,
      proposalKind: "goal",
      proposalLane: "goal",
      title: "proposal",
      details: {
        rows: [{ label: "target", after: "target" }],
        targetSignature: goalProposalTargetSignature(targets),
      },
      actions: {
        approveLabel: "approve",
        editLabel: "edit",
        rejectLabel: "reject",
      },
    });
    return proposal;
  }

  function act(
    deviceId: string,
    proposalId: string,
    action: ProposalActionRequestAction,
  ) {
    return services.proposalActionService.handleAction({
      deviceId,
      proposalId,
      kind: "goal",
      action,
    });
  }

  function installDecisionBarrier(
    releaseWhenEntered = 2,
  ): { entered: () => number } {
    let entered = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    proposalActionTestHooks.beforeDecision = async () => {
      entered += 1;
      if (entered === releaseWhenEntered) {
        release();
      }
      await released;
    };

    return { entered: () => entered };
  }

  it("keeps an unrelated device write after a forced proposal rollback", async () => {
    const deviceId = await createDevice();
    const unrelatedDeviceId = await createDevice();
    const proposal = await createGoalProposal(deviceId);
    const initialDevice = readDevice(deviceId);
    const initialUnrelated = readDevice(unrelatedDeviceId);
    assert.ok(initialDevice);
    assert.ok(initialUnrelated);

    const initialMessageCount = countRows(services, "chat_messages", deviceId);
    const initialActionEventCount = countRows(services, "chat_proposal_action_events", deviceId);
    const initialOutcomeCount = countRows(services, "chat_mutation_outcomes", deviceId);
    const initialSessionVersion = initialUnrelated.sessionVersion;
    let queuedWriteRan = false;
    let queuedWriteDuringTransaction = false;
    const originalReply = (services.chatService as ProposalChatService).saveAssistantReplyWithReceiptSync;
    (services.chatService as ProposalChatService).saveAssistantReplyWithReceiptSync = () => {
      throw new Error("forced decision rollback");
    };
    proposalActionTestHooks.afterDomainMutation = () => {
      queueMicrotask(() => {
        queuedWriteRan = true;
        queuedWriteDuringTransaction = services.db.$client.inTransaction;
        services.db.$client
          .prepare("UPDATE devices SET session_version = session_version + 1 WHERE id = ?")
          .run(unrelatedDeviceId);
      });
    };

    await assert.rejects(
      () => act(deviceId, proposal.proposalId, "approve"),
      /forced decision rollback/,
    );
    await flushQueuedWrites();
    (services.chatService as ProposalChatService).saveAssistantReplyWithReceiptSync = originalReply;

    const finalDevice = readDevice(deviceId);
    const finalUnrelated = readDevice(unrelatedDeviceId);
    const retainedProposal = await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    });
    const card = await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId: proposal.proposalId,
    });

    assert.ok(finalDevice);
    assert.ok(finalUnrelated);
    assert.ok(retainedProposal);
    assert.ok(card);
    assert.deepEqual(
      [finalDevice.dailyCalories, finalDevice.dailyProtein, finalDevice.dailyCarbs, finalDevice.dailyFat],
      [initialDevice.dailyCalories, initialDevice.dailyProtein, initialDevice.dailyCarbs, initialDevice.dailyFat],
    );
    assert.equal(finalUnrelated.sessionVersion, initialSessionVersion + 1);
    assert.equal(queuedWriteRan, true);
    assert.equal(queuedWriteDuringTransaction, false);
    assert.equal(retainedProposal.proposalId, proposal.proposalId);
    assert.equal(card.status, "active");
    assert.equal(countRows(services, "chat_messages", deviceId), initialMessageCount);
    assert.equal(countRows(services, "chat_proposal_action_events", deviceId), initialActionEventCount);
    assert.equal(countRows(services, "chat_mutation_outcomes", deviceId), initialOutcomeCount);
    assert.equal(countPublished(publishedGoalUpdates), 0);
  });

  it("gives overlapping approvals one durable owner and a non-error loser", async () => {
    const deviceId = await createDevice();
    const proposal = await createGoalProposal(deviceId);
    const initialMessageCount = countRows(services, "chat_messages", deviceId);
    const barrier = installDecisionBarrier();

    const [first, second] = await Promise.all([
      act(deviceId, proposal.proposalId, "approve"),
      act(deviceId, proposal.proposalId, "approve"),
    ]);

    assert.equal(barrier.entered(), 2);
    const results = [first, second];
    assert.equal(results.filter((result) => result.ok && result.status === "approved").length, 1);
    assert.equal(results.filter((result) => !result.ok && (result.status === "idempotent" || result.status === "stale")).length, 1);
    assert.equal(countRows(services, "chat_proposal_action_events", deviceId), 1);
    assert.equal(countRows(services, "chat_mutation_outcomes", deviceId), 1);
    assert.equal(countRows(services, "chat_messages", deviceId), initialMessageCount + 2);
    assert.equal(countPublished(publishedGoalUpdates), 1);
    const approvedDevice = readDevice(deviceId);
    assert.deepEqual(
      [approvedDevice?.dailyCalories, approvedDevice?.dailyProtein, approvedDevice?.dailyCarbs, approvedDevice?.dailyFat],
      [1400, 125, 130, 45],
    );
    const messageRoles = services.db.$client
      .prepare("SELECT role FROM chat_messages WHERE device_id = ? ORDER BY rowid")
      .all(deviceId) as Array<{ role: string }>;
    assert.equal(messageRoles.filter((row) => row.role === "user").length, 1);
    assert.equal(messageRoles.filter((row) => row.role === "assistant").length, initialMessageCount + 1);
    assert.equal((await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    })), undefined);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId: proposal.proposalId,
    }))?.status, "approved");
  });

  it("gives overlapping approve/reject one approval owner and a non-error loser", async () => {
    const deviceId = await createDevice();
    const proposal = await createGoalProposal(deviceId);
    const initialMessageCount = countRows(services, "chat_messages", deviceId);
    let approvalStarted!: () => void;
    const approvalEntered = new Promise<void>((resolve) => {
      approvalStarted = resolve;
    });
    proposalActionTestHooks.beforeDecision = async ({ action }) => {
      if (action === "approve") {
        approvalStarted();
        return;
      }
      await approvalEntered;
    };

    const [approved, rejected] = await Promise.all([
      act(deviceId, proposal.proposalId, "approve"),
      act(deviceId, proposal.proposalId, "reject"),
    ]);

    assert.equal(approved.ok, true);
    assert.equal(approved.status, "approved");
    assert.equal(rejected.ok, false);
    assert.ok(rejected.status === "idempotent" || rejected.status === "stale");
    assert.equal(countRows(services, "chat_proposal_action_events", deviceId), 1);
    assert.equal(countRows(services, "chat_mutation_outcomes", deviceId), 1);
    assert.equal(countRows(services, "chat_messages", deviceId), initialMessageCount + 2);
    assert.equal(countPublished(publishedGoalUpdates), 1);
    const approvedDevice = readDevice(deviceId);
    assert.deepEqual(
      [approvedDevice?.dailyCalories, approvedDevice?.dailyProtein, approvedDevice?.dailyCarbs, approvedDevice?.dailyFat],
      [1400, 125, 130, 45],
    );
    assert.equal((await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    })), undefined);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId: proposal.proposalId,
    }))?.status, "approved");
  });

  it("gives overlapping reject/approve one reject owner and a deterministic loser", async () => {
    const deviceId = await createDevice();
    const proposal = await createGoalProposal(deviceId);
    const initialDevice = readDevice(deviceId);
    const initialMessageCount = countRows(services, "chat_messages", deviceId);
    let entered = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    proposalActionTestHooks.beforeDecision = async () => {
      entered += 1;
      if (entered === 2) release();
      await released;
    };

    const [rejected, approved] = await Promise.all([
      act(deviceId, proposal.proposalId, "reject"),
      act(deviceId, proposal.proposalId, "approve"),
    ]);

    assert.equal(entered, 2);
    assert.equal(rejected.ok, true);
    assert.equal(rejected.status, "rejected");
    assert.equal(approved.ok, false);
    assert.ok(approved.status === "stale" || approved.status === "idempotent");
    assert.equal(countRows(services, "chat_proposal_action_events", deviceId), 1);
    assert.equal(countRows(services, "chat_mutation_outcomes", deviceId), 0);
    assert.equal(countRows(services, "chat_messages", deviceId), initialMessageCount + 2);
    assert.equal(countPublished(publishedGoalUpdates), 0);
    const finalDevice = readDevice(deviceId);
    assert.deepEqual(finalDevice, initialDevice);
    assert.equal((await services.goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    })), undefined);
    assert.equal((await services.proposalCardService.getLatestCardForProposal({
      deviceId,
      proposalId: proposal.proposalId,
    }))?.status, "rejected");
  });
});
