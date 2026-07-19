process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { goalProposalTargetSignature } from "../../server/services/goal-proposals.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";
import { readPublishedArtifact, writeScenarioArtifacts } from "../harness/artifacts.js";
import { assertPolicyEvidenceHasNoForbiddenFields } from "../harness/policy-assertions.js";
import policySideEffectScenario from "../harness/scenarios/policy-side-effect-gate.js";

function cookieHeader(raw: string | string[] | undefined): string {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

async function createGoalCard(services: AppServices, deviceId: string, proposalId?: string) {
  const targets = { calories: 1900, protein: 120, carbs: 210, fat: 60 };
  const proposal = proposalId === undefined
    ? await services.goalProposalService.putLatest({ deviceId, sessionId: DEFAULT_SESSION_ID, targets })
    : undefined;
  const assistant = await services.chatService.saveMessage(deviceId, "assistant", "請確認目標提案。");
  await services.proposalCardService.saveAssistantProposalCard({
    deviceId,
    assistantMessageId: assistant.id,
    proposalId: proposalId ?? proposal!.proposalId,
    proposalKind: "goal",
    proposalLane: "goal",
    title: "請確認目標提案。",
    details: { rows: [{ label: "卡路里", after: `${targets.calories} kcal` }], targetSignature: goalProposalTargetSignature(targets) },
    actions: { approveLabel: "套用", editLabel: "調整", rejectLabel: "取消" },
  });
  return proposalId ?? proposal!.proposalId;
}

function countRows(services: AppServices, table: string, deviceId: string): number {
  const row = services.db.$client.prepare(`SELECT count(*) AS count FROM ${table} WHERE device_id = ?`).get(deviceId) as { count: number };
  return row.count;
}

function targetSnapshot(services: AppServices, deviceId: string): Record<string, number> {
  return services.db.$client.prepare(
    "SELECT daily_calories AS calories, daily_protein AS protein, daily_carbs AS carbs, daily_fat AS fat FROM devices WHERE id = ?",
  ).get(deviceId) as Record<string, number>;
}

function effectSnapshot(services: AppServices, deviceId: string, publishCounts: { daily: number; goals: number }) {
  return {
    targets: targetSnapshot(services, deviceId),
    proposalCards: countRows(services, "chat_proposal_cards", deviceId),
    actionEvents: countRows(services, "chat_proposal_action_events", deviceId),
    mutationOutcomes: countRows(services, "chat_mutation_outcomes", deviceId),
    dailyPublishes: publishCounts.daily,
    goalsPublishes: publishCounts.goals,
  };
}

test("Phase 128 policy proof binds action authority to the backend card and makes approved replay zero-mutation", async () => {
  let services!: AppServices;
  const publishCounts = { daily: 0, goals: 0 };
  const app = await buildApp({
    dbPath: ":memory:",
    llmProvider: new MockLLMProvider(),
    onServicesReady: (ready) => {
      services = ready;
      const originalDaily = ready.publisher.publishDailySummary.bind(ready.publisher);
      ready.publisher.publishDailySummary = (...args) => {
        publishCounts.daily += 1;
        return originalDaily(...args);
      };
      const originalGoals = ready.publisher.publishGoalsUpdate.bind(ready.publisher);
      ready.publisher.publishGoalsUpdate = (...args) => {
        publishCounts.goals += 1;
        return originalGoals(...args);
      };
    },
  });
  try {
    const device = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    const deviceId = device.json().deviceId as string;
    const cookie = cookieHeader(device.headers["set-cookie"]);
    const proposalId = await createGoalCard(services, deviceId);
    const beforeApproval = effectSnapshot(services, deviceId, publishCounts);
    const first = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie },
      payload: { proposalId, kind: "goal", action: "approve" },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().status, "approved");

    const afterApproval = effectSnapshot(services, deviceId, publishCounts);
    assert.equal(afterApproval.actionEvents, beforeApproval.actionEvents + 1);
    assert.equal(afterApproval.proposalCards, beforeApproval.proposalCards);
    assert.equal(afterApproval.mutationOutcomes, beforeApproval.mutationOutcomes + 1);
    assert.notDeepEqual(afterApproval.targets, beforeApproval.targets);
    assert.equal(afterApproval.goalsPublishes, beforeApproval.goalsPublishes + 1);

    const countsBefore = effectSnapshot(services, deviceId, publishCounts);
    const replay = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie },
      payload: { proposalId, kind: "goal", action: "approve" },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().status, "idempotent");
    const countsAfter = effectSnapshot(services, deviceId, publishCounts);
    assert.deepEqual(countsAfter, countsBefore);
    assert.equal(replay.json().didMutateMeal, false);

    const card = services.db.$client.prepare(
      "SELECT proposal_kind AS kind, proposal_id AS proposalId, status FROM chat_proposal_cards WHERE device_id = ? AND proposal_id = ?",
    ).get(deviceId, proposalId) as { kind: string; proposalId: string; status: string };
    assert.deepEqual(card, { kind: "goal", proposalId, status: "approved" });

    const wrongKind = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie },
      payload: { proposalId, kind: "meal_numeric", action: "approve" },
    });
    assert.equal(wrongKind.statusCode, 200);
    assert.equal(wrongKind.json().status, "stale");
    assert.equal(wrongKind.json().proposalCard, undefined);
  } finally {
    await app.close();
  }
});

test("Phase 128 policy proof rejects direct numeric mutation fields before domain effects", async () => {
  const app = await buildApp({ dbPath: ":memory:", llmProvider: new MockLLMProvider() });
  try {
    const device = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    const response = await app.inject({
      method: "POST",
      url: "/api/proposals/actions",
      headers: { cookie: cookieHeader(device.headers["set-cookie"]) },
      payload: { proposalId: "missing", kind: "meal_numeric", action: "approve", updateInput: { protein: 1 } },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("Phase 128 policy evidence rejects raw arguments and keeps stale/idempotent facts distinct", () => {
  assert.throws(
    () => assertPolicyEvidenceHasNoForbiddenFields({ policyClass: "confirm-first", arguments: { protein: 1 } }),
    /forbidden field arguments/,
  );
  assert.doesNotThrow(() => assertPolicyEvidenceHasNoForbiddenFields({
    status: "stale",
    didMutate: false,
    duplicateReplay: true,
  }));
});

test("Phase 128 policy scenario records backend proposal-card identity invariants", async () => {
  const result = await policySideEffectScenario.run({} as never);
  assert.equal(result.ok, true);
  const approval = result.metadata?.policyDbInvariants?.find(
    (entry) => entry.step === "confirm-first_propose_approve_meal_numeric",
  );
  assert.ok(approval);
  assert.deepEqual(
    {
      proposalCardPresent: approval.proposalCardPresent,
      proposalCardKindMatches: approval.proposalCardKindMatches,
      proposalCardProposalIdMatches: approval.proposalCardProposalIdMatches,
    },
    {
      proposalCardPresent: true,
      proposalCardKindMatches: true,
      proposalCardProposalIdMatches: true,
    },
  );
});

test("Phase 128 policy disk snapshot preserves backend proposal-card identity booleans", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase-128-policy-disk-"));
  const previous = process.env.HARNESS_ARTIFACTS_DIR;
  process.env.HARNESS_ARTIFACTS_DIR = root;
  try {
    const result = await policySideEffectScenario.run({} as never);
    await writeScenarioArtifacts("phase-128-policy-disk", result);
    const snapshots = JSON.parse(readPublishedArtifact("phase-128-policy-disk", "snapshots.json")) as {
      policyDbInvariants?: Array<Record<string, unknown>>;
    };
    const approval = snapshots.policyDbInvariants?.find(
      (entry) => entry.step === "confirm-first_propose_approve_meal_numeric",
    );
    assert.deepEqual(
      {
        proposalCardPresent: approval?.proposalCardPresent,
        proposalCardKindMatches: approval?.proposalCardKindMatches,
        proposalCardProposalIdMatches: approval?.proposalCardProposalIdMatches,
      },
      {
        proposalCardPresent: true,
        proposalCardKindMatches: true,
        proposalCardProposalIdMatches: true,
      },
    );
    assert.equal(fs.existsSync(path.join(root, "phase-128-policy-disk", "latest", "snapshots.json")), true);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
