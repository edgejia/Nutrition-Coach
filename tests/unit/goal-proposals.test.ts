process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import {
  GOAL_PROPOSAL_KIND,
  createGoalProposalService,
} from "../../server/services/goal-proposals.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-05-17T08:30:00+08:00");

class FixedDate extends REAL_DATE {
  constructor(...args: any[]) {
    if (args.length === 0) {
      super(FIXED_NOW);
      return;
    }
    super(...(args as [any]));
  }

  static now(): number {
    return FIXED_NOW.getTime();
  }
}

describe("goal proposal service", () => {
  let db: ReturnType<typeof createDb>;
  let service: ReturnType<typeof createGoalProposalService>;

  beforeEach(() => {
    globalThis.Date = FixedDate as DateConstructor;
    db = createDb(":memory:");
    service = createGoalProposalService(db);
  });

  afterEach(() => {
    globalThis.Date = REAL_DATE;
  });

  it("creates a pending proposal with generated id, targets, and createdAt", async () => {
    const proposal = await service.putLatest("device-goal-1", {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });

    assert.match(proposal.proposalId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(proposal.targets, {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });
    assert.equal(proposal.createdAt, FIXED_NOW.toISOString());
    assert.deepEqual(await service.getLatest("device-goal-1"), proposal);
  });

  it("overwrites the earlier proposal for the same device", async () => {
    const first = await service.putLatest("device-goal-1", {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });
    const second = await service.putLatest("device-goal-1", {
      calories: 1500,
      protein: 130,
      carbs: 140,
      fat: 50,
    });

    assert.notEqual(second.proposalId, first.proposalId);
    assert.deepEqual(await service.getLatest("device-goal-1"), second);

    const count = db.$client
      .prepare("SELECT COUNT(*) AS count FROM turn_states WHERE device_id = ? AND kind = ?")
      .get("device-goal-1", GOAL_PROPOSAL_KIND) as { count: number };
    assert.equal(count.count, 1);
  });

  it("returns undefined after the row expires", async () => {
    await service.putLatest("device-goal-1", {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });

    db.$client
      .prepare("UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND kind = ?")
      .run("2026-05-16T00:00:00.000Z", "device-goal-1", GOAL_PROPOSAL_KIND);

    assert.equal(await service.getLatest("device-goal-1"), undefined);
  });

  it("clears the active proposal", async () => {
    await service.putLatest("device-goal-1", {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });

    await service.clear("device-goal-1");

    assert.equal(await service.getLatest("device-goal-1"), undefined);
  });
});
