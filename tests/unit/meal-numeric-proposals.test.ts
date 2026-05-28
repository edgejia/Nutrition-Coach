process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  GOAL_PROPOSAL_KIND,
  createGoalProposalService,
} from "../../server/services/goal-proposals.js";
import {
  MEAL_NUMERIC_PROPOSAL_KIND,
  createMealNumericProposalService,
} from "../../server/services/meal-numeric-proposals.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-05-17T08:30:00+08:00");

class FixedDate extends REAL_DATE {
  constructor(...args: any[]) {
    switch (args.length) {
      case 0:
        super(FIXED_NOW);
        break;
      case 1:
        super(args[0]);
        break;
      case 2:
        super(args[0], args[1]);
        break;
      case 3:
        super(args[0], args[1], args[2]);
        break;
      case 4:
        super(args[0], args[1], args[2], args[3]);
        break;
      case 5:
        super(args[0], args[1], args[2], args[3], args[4]);
        break;
      case 6:
        super(args[0], args[1], args[2], args[3], args[4], args[5]);
        break;
      default:
        super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    }
  }

  static now(): number {
    return FIXED_NOW.getTime();
  }
}

describe("meal numeric proposal service", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let service: ReturnType<typeof createMealNumericProposalService>;

  beforeEach(async () => {
    globalThis.Date = FixedDate as DateConstructor;
    db = createDb(":memory:");
    deviceId = (await createDeviceService(db).createDevice("fat_loss")).deviceId;
    service = createMealNumericProposalService(db);
  });

  afterEach(() => {
    globalThis.Date = REAL_DATE;
  });

  it("stores and reads the active backend-computed patch proposal", async () => {
    const proposal = await service.putLatest(deviceId, {
      mealId: "meal-1",
      expectedMealRevisionId: "rev-1",
      updateInput: { protein: 20 },
      affectedFields: [{ field: "protein", before: 40, after: 20 }],
      sourceOperator: "half",
    });

    assert.match(proposal.proposalId, /^[0-9a-f-]{36}$/);
    assert.equal(proposal.mealId, "meal-1");
    assert.equal(proposal.expectedMealRevisionId, "rev-1");
    assert.deepEqual(proposal.updateInput, { protein: 20 });
    assert.equal(proposal.items, undefined);
    assert.deepEqual(proposal.affectedFields, [{ field: "protein", before: 40, after: 20 }]);
    assert.equal(proposal.sourceOperator, "half");
    assert.equal(proposal.createdAt, FIXED_NOW.toISOString());
    assert.equal(proposal.expiresAt, new REAL_DATE(FIXED_NOW.getTime() + 30 * 60 * 1000).toISOString());
    assert.deepEqual(await service.getLatest(deviceId), proposal);
  });

  it("stores and reads a backend-computed grouped items proposal", async () => {
    const proposal = await service.putLatest(deviceId, {
      mealId: "meal-1",
      expectedMealRevisionId: "rev-1",
      items: [
        { foodName: "雞腿", calories: 300, protein: 25, carbs: 0, fat: 18 },
        { foodName: "白飯", calories: 220, protein: 5, carbs: 48, fat: 1 },
      ],
      affectedFields: [{ field: "calories", before: 700, after: 520 }],
      sourceOperator: "subtract",
    });

    assert.deepEqual(proposal.items, [
      { foodName: "雞腿", calories: 300, protein: 25, carbs: 0, fat: 18 },
      { foodName: "白飯", calories: 220, protein: 5, carbs: 48, fat: 1 },
    ]);
    assert.equal(proposal.updateInput, undefined);
    assert.deepEqual(await service.getLatest(deviceId), proposal);
  });

  it("replaces only the same meal proposal kind for the device", async () => {
    const goalProposal = await createGoalProposalService(db).putLatest(deviceId, {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });
    const first = await service.putLatest(deviceId, {
      mealId: "meal-1",
      expectedMealRevisionId: "rev-1",
      updateInput: { protein: 20 },
      affectedFields: [{ field: "protein", before: 40, after: 20 }],
      sourceOperator: "half",
    });
    const second = await service.putLatest(deviceId, {
      mealId: "meal-2",
      expectedMealRevisionId: "rev-2",
      updateInput: { calories: 450 },
      affectedFields: [{ field: "calories", before: 500, after: 450 }],
      sourceOperator: "subtract",
    });

    assert.notEqual(second.proposalId, first.proposalId);
    assert.deepEqual(await service.getLatest(deviceId), second);
    assert.deepEqual(await createGoalProposalService(db).getLatest(deviceId), goalProposal);

    const rows = db.$client
      .prepare("SELECT kind, COUNT(*) AS count FROM turn_states WHERE device_id = ? GROUP BY kind")
      .all(deviceId) as Array<{ kind: string; count: number }>;
    assert.deepEqual(
      rows.sort((a, b) => a.kind.localeCompare(b.kind)),
      [
        { kind: GOAL_PROPOSAL_KIND, count: 1 },
        { kind: MEAL_NUMERIC_PROPOSAL_KIND, count: 1 },
      ],
    );
  });

  it("returns undefined after the row expires", async () => {
    await service.putLatest(deviceId, {
      mealId: "meal-1",
      expectedMealRevisionId: "rev-1",
      updateInput: { protein: 20 },
      affectedFields: [{ field: "protein", before: 40, after: 20 }],
      sourceOperator: "half",
    });

    db.$client
      .prepare("UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND kind = ?")
      .run("2026-05-16T00:00:00.000Z", deviceId, MEAL_NUMERIC_PROPOSAL_KIND);

    assert.equal(await service.getLatest(deviceId), undefined);
  });

  it("clears the active meal proposal", async () => {
    await service.putLatest(deviceId, {
      mealId: "meal-1",
      expectedMealRevisionId: "rev-1",
      updateInput: { protein: 20 },
      affectedFields: [{ field: "protein", before: 40, after: 20 }],
      sourceOperator: "half",
    });

    await service.clear(deviceId);

    assert.equal(await service.getLatest(deviceId), undefined);
  });
});
