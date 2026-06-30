import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService, type DailyTargets } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import {
  GOAL_PROPOSAL_KIND,
  createGoalProposalService,
} from "../../server/services/goal-proposals.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  executeTool,
  toolRegistry,
  type ToolDeps,
} from "../../server/orchestrator/tools.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";
import {
  isGoalProposalCancel,
  isGoalProposalConsent,
} from "../../server/orchestrator/source-text-guard.js";
import {
  renderGoalAuthorityFailureCopy,
  renderGoalCancelCopy,
  renderGoalProposalCopy,
  renderUnsafeCalorieFloorCopy,
  renderGoalValidationFailureCopy,
} from "../../server/orchestrator/mutation-receipts.js";
import type { ToolCall } from "../../server/llm/types.js";

function updateGoalsCall(args: unknown): ToolCall {
  return {
    id: "call_update_goals",
    type: "function",
    function: {
      name: "update_goals",
      arguments: JSON.stringify(args),
    },
  };
}

function proposeGoalsCall(args: unknown): ToolCall {
  return {
    id: "call_propose_goals",
    type: "function",
    function: {
      name: "propose_goals",
      arguments: JSON.stringify(args),
    },
  };
}

async function readTargets(
  service: ReturnType<typeof createDeviceService>,
  id: string,
): Promise<DailyTargets> {
  const device = await service.getDevice(id);
  assert.ok(device);
  return {
    calories: device.dailyCalories,
    protein: device.dailyProtein,
    carbs: device.dailyCarbs,
    fat: device.dailyFat,
  };
}

describe("update_goals ToolContract", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let deviceService: ReturnType<typeof createDeviceService>;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let goalProposalService: ReturnType<typeof createGoalProposalService>;
  let summaryService: ReturnType<typeof createSummaryService>;
  let published: Array<{ deviceId: string; targets: DailyTargets }>;
  let deps: ToolDeps;

  beforeEach(async () => {
    db = createDb(":memory:");
    deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    goalProposalService = createGoalProposalService(db);
    summaryService = createSummaryService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    published = [];
    deps = {
      foodLoggingService,
      summaryService,
      deviceService,
      goalProposalService,
      publisher: {
        publishGoalsUpdate(id: string, targets: DailyTargets) {
          published.push({ deviceId: id, targets });
          return { sent: 1 };
        },
      },
    } as ToolDeps;
  });

  it("Test 1: registers propose_goals with a complete bounded target schema", () => {
    const contract = toolRegistry.get("propose_goals");
    assert.ok(contract, "propose_goals contract must be registered");

    assert.equal(contract.zodSchema.safeParse({
      calories: 1800,
      protein: 130,
      carbs: 160,
      fat: 55,
    }).success, true);
    assert.equal(contract.zodSchema.safeParse({ calories: 1800, protein: 130, carbs: 160 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ calories: 499, protein: 130, carbs: 160, fat: 55 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ calories: 1800, protein: 401, carbs: 160, fat: 55 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ calories: 1800, protein: 130, carbs: 1001, fat: 55 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ calories: 1800, protein: 130, carbs: 160, fat: 301 }).success, false);

    const required = contract.parameters.required as string[];
    assert.deepEqual(required, ["calories", "protein", "carbs", "fat"]);
  });

  it("Test 2: propose_goals persists proposal copy without mutating targets or publishing", async () => {
    const proposed = { calories: 1850, protein: 135, carbs: 165, fat: 60 };
    const before = await readTargets(deviceService, deviceId);
    const result = await executeTool(proposeGoalsCall(proposed), deviceId, deps, {
      currentUserMessage: "幫我調整目標",
    });

    assert.equal(result.success, true);
    assert.equal(result.executed, true);
    assert.equal(result.result, renderGoalProposalCopy(proposed));
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "goal_proposal",
      text: renderGoalProposalCopy(proposed),
    });
    assert.deepEqual(await readTargets(deviceService, deviceId), before);
    assert.deepEqual(
      (await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))?.targets,
      proposed,
    );
    assert.equal(published.length, 0);
  });

  it("Test 2b: unsafe propose_goals returns guard projection without proposal card or hidden pending state", async () => {
    let putLatestCalls = 0;
    const guardedGoalProposalService = {
      ...goalProposalService,
      async putLatest(params: Parameters<typeof goalProposalService.putLatest>[0]) {
        putLatestCalls += 1;
        return goalProposalService.putLatest(params);
      },
    } as typeof goalProposalService;
    const localDeps = {
      ...deps,
      goalProposalService: guardedGoalProposalService,
    } as ToolDeps;
    const unsafeTargets = {
      calories: 500,
      protein: 120,
      carbs: 150,
      fat: 50,
    };

    const result = await executeTool(proposeGoalsCall(unsafeTargets), deviceId, localDeps, {
      currentUserMessage: "幫我設成每天 500 kcal",
    });

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.equal(result.summary, "failureReason: guard");
    assert.equal(result.result, renderUnsafeCalorieFloorCopy());
    assert.equal(result.proposalCard, undefined);
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "unsafe_calorie_floor",
      text: renderUnsafeCalorieFloorCopy(),
    });
    assert.equal(putLatestCalls, 0);
    assert.equal(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);
  });

  it("Test 3: update_goals rejects empty args and any args without mode", async () => {
    for (const args of [{}, { calories: 1800, sugar: 20 }, { calories: 1800 }]) {
      const result = await executeTool(updateGoalsCall(args), deviceId, deps, {
        currentUserMessage: "卡路里 1800",
      });

      assert.equal(result.success, false);
      assert.equal(result.executed, false);
      assert.equal(result.failureReason, "validation");
      assert.equal(result.result, renderGoalAuthorityFailureCopy());
      assert.deepEqual(result.controlledReply, {
        source: "renderer",
        reason: "goal_authority_failure",
        text: renderGoalAuthorityFailureCopy(),
      });
      assert.deepEqual(await readTargets(deviceService, deviceId), {
        calories: 1500,
        protein: 120,
        carbs: 150,
        fat: 50,
      });
      assert.equal(published.length, 0);
    }
  });

  it("Test 4: current_turn_values uses only current-user numeric fields, clears proposals, and publishes once", async () => {
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: { calories: 1900, protein: 140, carbs: 170, fat: 65 },
    });
    const result = await executeTool(
      updateGoalsCall({ mode: "current_turn_values", calories: 1800, protein: 130 }),
      deviceId,
      deps,
      {
        currentUserMessage: "卡路里改 1800，蛋白質 130 克",
        previousAssistantMessage: "我建議卡路里 1900，蛋白質 140",
      },
    );

    assert.equal(result.success, true);
    assert.equal(result.executed, true);
    assert.equal(result.result, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.deepEqual(result.updatedFields, ["calories", "protein"]);
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1800,
      protein: 130,
      carbs: 150,
      fat: 50,
    });
    assert.equal(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], {
      deviceId,
      targets: { calories: 1800, protein: 130, carbs: 150, fat: 50 },
    });
  });

  it("Test 5: current_turn_values rejects numbers sourced only from previous assistant prose", async () => {
    const result = await executeTool(
      updateGoalsCall({ mode: "current_turn_values", calories: 1800 }),
      deviceId,
      deps,
      {
        currentUserMessage: "好",
        previousAssistantMessage: "我建議卡路里 1800",
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "goal_authority_failure",
      text: renderGoalAuthorityFailureCopy(),
    });
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);
  });

  it("Test 5b: current_turn_values rejects unsafe calories before device goal mutation", async () => {
    let updateGoalsCalls = 0;
    const guardedDeviceService = {
      ...deviceService,
      async updateGoals(id: string, patch: Partial<DailyTargets>) {
        updateGoalsCalls += 1;
        return deviceService.updateGoals(id, patch);
      },
    } as typeof deviceService;
    const localDeps = {
      ...deps,
      deviceService: guardedDeviceService,
    } as ToolDeps;

    const result = await executeTool(
      updateGoalsCall({ mode: "current_turn_values", calories: 500 }),
      deviceId,
      localDeps,
      {
        currentUserMessage: "卡路里改成 500",
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.equal(result.summary, "failureReason: guard");
    assert.equal(result.result, renderUnsafeCalorieFloorCopy());
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "unsafe_calorie_floor",
      text: renderUnsafeCalorieFloorCopy(),
    });
    assert.deepEqual(result.updatedFields, ["calories"]);
    assert.equal(updateGoalsCalls, 0);
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);
  });

  it("Test 6: latest_proposal requires backend consent and active proposal without consuming retryable state", async () => {
    const proposed = { calories: 1850, protein: 135, carbs: 165, fat: 60 };
    await goalProposalService.putLatest({ deviceId, sessionId: DEFAULT_SESSION_ID, targets: proposed });

    const missingConsent = await executeTool(updateGoalsCall({ mode: "latest_proposal" }), deviceId, deps, {
      currentUserMessage: "我再想想",
    });
    assert.equal(missingConsent.success, false);
    assert.equal(missingConsent.executed, false);
    assert.equal(missingConsent.result, renderGoalAuthorityFailureCopy());
    assert.deepEqual(missingConsent.controlledReply, {
      source: "renderer",
      reason: "goal_authority_failure",
      text: renderGoalAuthorityFailureCopy(),
    });
    assert.deepEqual(
      (await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))?.targets,
      proposed,
    );
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);

    const otherDeviceId = (await deviceService.createDevice("maintain")).deviceId;
    const noProposal = await executeTool(updateGoalsCall({ mode: "latest_proposal" }), otherDeviceId, deps, {
      currentUserMessage: "好",
    });
    assert.equal(noProposal.success, false);
    assert.equal(noProposal.executed, false);
    assert.equal(noProposal.result, renderGoalAuthorityFailureCopy());
    assert.equal(published.length, 0);
  });

  it("Test 7: expired proposals fail closed without mutation or publish", async () => {
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: { calories: 1850, protein: 135, carbs: 165, fat: 60 },
    });
    db.$client
      .prepare("UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND session_id = ? AND kind = ?")
      .run("2000-01-01T00:00:00.000Z", deviceId, DEFAULT_SESSION_ID, GOAL_PROPOSAL_KIND);

    const result = await executeTool(updateGoalsCall({ mode: "latest_proposal" }), deviceId, deps, {
      currentUserMessage: "好",
    });

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.result, renderGoalAuthorityFailureCopy());
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "goal_authority_failure",
      text: renderGoalAuthorityFailureCopy(),
    });
    assert.equal(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);
  });

  it("Test 8: stale or mismatched proposal identifiers fail closed without selecting replaced proposals", async () => {
    const first = await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1850,
        protein: 135,
        carbs: 165,
        fat: 60,
      },
    });
    const replacement = await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1650,
        protein: 125,
        carbs: 145,
        fat: 50,
      },
    });

    const staleIdResult = await executeTool(
      updateGoalsCall({ mode: "latest_proposal", proposal_id: first.proposalId }),
      deviceId,
      deps,
      { currentUserMessage: "好" },
    );
    const mismatchedIdResult = await executeTool(
      updateGoalsCall({ mode: "latest_proposal", proposal_id: "not-the-active-proposal" }),
      deviceId,
      deps,
      { currentUserMessage: "好" },
    );

    for (const result of [staleIdResult, mismatchedIdResult]) {
      assert.equal(result.success, false);
      assert.equal(result.executed, false);
      assert.equal(result.failureReason, "validation");
      assert.equal(result.result, renderGoalAuthorityFailureCopy());
      assert.deepEqual(result.controlledReply, {
        source: "renderer",
        reason: "goal_authority_failure",
        text: renderGoalAuthorityFailureCopy(),
      });
    }
    assert.deepEqual(
      (await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))?.targets,
      replacement.targets,
    );
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);
  });

  it("Test 9: latest_proposal applies active proposal with current-turn numeric overrides then clears state", async () => {
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: { calories: 1850, protein: 135, carbs: 165, fat: 60 },
    });

    const result = await executeTool(
      updateGoalsCall({ mode: "latest_proposal", protein: 130 }),
      deviceId,
      deps,
      {
        currentUserMessage: "好，但蛋白質 130",
        previousAssistantMessage: "我可以建議蛋白質 135",
      },
    );

    assert.equal(result.success, true);
    assert.equal(result.executed, true);
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1850,
      protein: 130,
      carbs: 165,
      fat: 60,
    });
    assert.equal(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], {
      deviceId,
      targets: { calories: 1850, protein: 130, carbs: 165, fat: 60 },
    });
  });

  it("Test 9b: latest_proposal consumes active backend proposal before goal mutation", async () => {
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: { calories: 1850, protein: 135, carbs: 165, fat: 60 },
    });
    const order: string[] = [];
    const policyGoalProposalService = {
      ...goalProposalService,
      async getLatest(params: Parameters<typeof goalProposalService.getLatest>[0]) {
        order.push("getLatest");
        return goalProposalService.getLatest(params);
      },
      async consumeLatest(params: Parameters<typeof goalProposalService.consumeLatest>[0]) {
        order.push("consumeLatest");
        return goalProposalService.consumeLatest(params);
      },
      async clear(params: Parameters<typeof goalProposalService.clear>[0]) {
        order.push("clear");
        return goalProposalService.clear(params);
      },
    } as typeof goalProposalService;
    const policyDeviceService = {
      ...deviceService,
      async updateGoals(id: string, patch: Partial<DailyTargets>) {
        order.push("updateGoals");
        assert.equal(
          await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }),
          undefined,
          "proposal must be consumed before device goals mutate",
        );
        return deviceService.updateGoals(id, patch);
      },
    } as typeof deviceService;
    const localDeps = {
      ...deps,
      deviceService: policyDeviceService,
      goalProposalService: policyGoalProposalService,
    } as ToolDeps;

    const result = await executeTool(updateGoalsCall({ mode: "latest_proposal" }), deviceId, localDeps, {
      currentUserMessage: "好",
    });

    assert.equal(result.success, true);
    assert.equal(result.executed, true);
    assert.deepEqual(order, ["getLatest", "consumeLatest", "updateGoals"]);
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1850,
      protein: 135,
      carbs: 165,
      fat: 60,
    });
    assert.equal(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
  });

  it("Test 9c: latest_proposal keeps pending proposal retryable when override source guard fails before consume", async () => {
    const proposed = { calories: 1850, protein: 135, carbs: 165, fat: 60 };
    const pending = await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: proposed,
    });
    let getLatestCalls = 0;
    let consumeCalls = 0;
    let updateGoalsCalls = 0;
    const guardedGoalProposalService = {
      ...goalProposalService,
      async getLatest(params: Parameters<typeof goalProposalService.getLatest>[0]) {
        getLatestCalls += 1;
        return goalProposalService.getLatest(params);
      },
      async consumeLatest(params: Parameters<typeof goalProposalService.consumeLatest>[0]) {
        consumeCalls += 1;
        return goalProposalService.consumeLatest(params);
      },
    } as typeof goalProposalService;
    const guardedDeviceService = {
      ...deviceService,
      async updateGoals(id: string, patch: Partial<DailyTargets>) {
        updateGoalsCalls += 1;
        return deviceService.updateGoals(id, patch);
      },
    } as typeof deviceService;
    const localDeps = {
      ...deps,
      deviceService: guardedDeviceService,
      goalProposalService: guardedGoalProposalService,
    } as ToolDeps;

    const result = await executeTool(
      updateGoalsCall({ mode: "latest_proposal", protein: 130 }),
      deviceId,
      localDeps,
      {
        currentUserMessage: "好",
        previousAssistantMessage: "我建議蛋白質 130",
      },
    );

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.equal(result.result, renderGoalAuthorityFailureCopy());
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "goal_authority_failure",
      text: renderGoalAuthorityFailureCopy(),
    });
    assert.equal(getLatestCalls, 0);
    assert.equal(consumeCalls, 0);
    assert.equal(updateGoalsCalls, 0);
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);
    const retryableProposal = await goalProposalService.getLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
    });
    assert.equal(retryableProposal?.proposalId, pending.proposalId);
    assert.deepEqual(retryableProposal?.targets, proposed);
  });

  it("Test 10: cancel terms clear proposal without mutating or publishing and never count as consent", async () => {
    for (const term of ["不要", "取消", "先不用", "不好", "不可以", "不行", "no"]) {
      await goalProposalService.putLatest({
        deviceId,
        sessionId: DEFAULT_SESSION_ID,
        targets: { calories: 1850, protein: 135, carbs: 165, fat: 60 },
      });
      published = [];

      assert.equal(isGoalProposalCancel(term), true);
      assert.equal(isGoalProposalConsent(term), false);

      const result = await executeTool(updateGoalsCall({ mode: "latest_proposal" }), deviceId, deps, {
        currentUserMessage: term,
      });
      assert.equal(result.success, false);
      assert.equal(result.executed, false);
      assert.equal(result.result, renderGoalCancelCopy());
      assert.deepEqual(result.controlledReply, {
        source: "renderer",
        reason: "goal_cancel",
        text: renderGoalCancelCopy(),
      });
      assert.equal(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
      assert.deepEqual(await readTargets(deviceService, deviceId), {
        calories: 1500,
        protein: 120,
        carbs: 150,
        fat: 50,
      });
      assert.equal(published.length, 0);
    }
  });

  it("Test 11: validation range failure returns field copy without mutation publish or proposal consumption", async () => {
    const proposed = { calories: 1850, protein: 135, carbs: 165, fat: 60 };
    await goalProposalService.putLatest({ deviceId, sessionId: DEFAULT_SESSION_ID, targets: proposed });

    const result = await executeTool(
      updateGoalsCall({ mode: "latest_proposal", protein: 401 }),
      deviceId,
      deps,
      { currentUserMessage: "好，但蛋白質 401" },
    );

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "validation");
    assert.equal(result.result, renderGoalValidationFailureCopy(["protein"]));
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "goal_validation_failure",
      text: renderGoalValidationFailureCopy(["protein"]),
    });
    assert.deepEqual(
      (await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }))?.targets,
      proposed,
    );
    assert.deepEqual(await readTargets(deviceService, deviceId), {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(published.length, 0);
  });

  it("Test 12: schemas preserve target ranges and explicit update_goals modes", async () => {
    const contract = toolRegistry.get("update_goals");
    assert.ok(contract, "update_goals contract must be registered");

    assert.equal(contract.zodSchema.safeParse({ mode: "current_turn_values", calories: 500 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "current_turn_values", calories: 8000 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "current_turn_values", calories: 499 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "current_turn_values", calories: 8001 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", protein: 0 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", protein: 400 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", protein: -1 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", protein: 401 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", carbs: 0 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", carbs: 1000 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", carbs: -1 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", carbs: 1001 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", fat: 0 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", fat: 300 }).success, true);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", fat: -1 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal", fat: 301 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ calories: 1800 }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "current_turn_values" }).success, false);
    assert.equal(contract.zodSchema.safeParse({ mode: "latest_proposal" }).success, true);

    const properties = contract.parameters.properties as Record<string, any>;
    assert.deepEqual((properties.mode as { enum: string[] }).enum, ["current_turn_values", "latest_proposal"]);
    assert.equal(properties.calories.minimum, 500);
    assert.equal(properties.calories.maximum, 8000);
    assert.equal(properties.protein.minimum, 0);
    assert.equal(properties.protein.maximum, 400);
    assert.equal(properties.carbs.minimum, 0);
    assert.equal(properties.carbs.maximum, 1000);
    assert.equal(properties.fat.minimum, 0);
    assert.equal(properties.fat.maximum, 300);
  });

  it("Test 13: successful execute publishes goals_update and does not call summaryService.getDailySummary", async () => {
    let getSummaryCalls = 0;
    const summarySpy = {
      getDailySummary: async (...args: Parameters<typeof summaryService.getDailySummary>) => {
        getSummaryCalls += 1;
        return summaryService.getDailySummary(...args);
      },
    } as typeof summaryService;
    const localDeps = { ...deps, summaryService: summarySpy } as ToolDeps;

    await executeTool(updateGoalsCall({ mode: "current_turn_values", calories: 1800 }), deviceId, localDeps, {
      currentUserMessage: "卡路里 1800",
    });

    assert.equal(getSummaryCalls, 0, "summaryService.getDailySummary must not be called");
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], {
      deviceId,
      targets: { calories: 1800, protein: 120, carbs: 150, fat: 50 },
    });
  });

  it("Test 14: summaries expose only tool names modes fields statuses and event names", async () => {
    const proposeContract = toolRegistry.get("propose_goals");
    const updateContract = toolRegistry.get("update_goals");
    assert.ok(proposeContract);
    assert.ok(updateContract);

    const proposeSummary = JSON.stringify(proposeContract.logSummary({
      calories: 1850,
      protein: 135,
      carbs: 165,
      fat: 60,
    }));
    assert.match(proposeSummary, /propose_goals/);
    assert.match(proposeSummary, /calories/);
    assert.doesNotMatch(proposeSummary, /1850|135|165|60|proposalId|raw|好/);

    const result = await executeTool(updateGoalsCall({ mode: "current_turn_values", calories: 1800, protein: 130 }), deviceId, deps, {
      currentUserMessage: "卡路里 1800 蛋白質 130",
    });

    assert.deepEqual(result.updatedFields, ["calories", "protein"]);
    assert.deepEqual(result.publishedEvents, ["goals_update"]);
    const serializedMetadata = JSON.stringify({
      summary: result.summary,
      updatedFields: result.updatedFields,
      publishedEvents: result.publishedEvents,
    });
    assert.doesNotMatch(serializedMetadata, /1800/);
    assert.doesNotMatch(serializedMetadata, /130/);

    const updateSummary = JSON.stringify(updateContract.logSummary({
      mode: "latest_proposal",
      protein: 130,
    }));
    assert.match(updateSummary, /update_goals/);
    assert.match(updateSummary, /latest_proposal/);
    assert.match(updateSummary, /protein/);
    assert.doesNotMatch(updateSummary, /130|proposalId|好|卡路里/);
  });
});
