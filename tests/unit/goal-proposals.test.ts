process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  GOAL_PROPOSAL_KIND,
  createGoalProposalService,
} from "../../server/services/goal-proposals.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";

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

describe("goal proposal service", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let service: ReturnType<typeof createGoalProposalService>;

  beforeEach(async () => {
    globalThis.Date = FixedDate as DateConstructor;
    db = createDb(":memory:");
    deviceId = (await createDeviceService(db).createDevice("fat_loss")).deviceId;
    service = createGoalProposalService(db);
  });

  afterEach(() => {
    globalThis.Date = REAL_DATE;
  });

  it("creates a pending proposal with generated id, targets, and createdAt", async () => {
    const proposal = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1400,
        protein: 120,
        carbs: 130,
        fat: 45,
      },
    });

    assert.match(proposal.proposalId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(proposal.targets, {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    });
    assert.equal(proposal.createdAt, FIXED_NOW.toISOString());
    assert.deepEqual(await service.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), proposal);
  });

  it("overwrites the earlier proposal for the same device", async () => {
    const first = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1400,
        protein: 120,
        carbs: 130,
        fat: 45,
      },
    });
    const second = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1500,
        protein: 130,
        carbs: 140,
        fat: 50,
      },
    });

    assert.notEqual(second.proposalId, first.proposalId);
    assert.deepEqual(await service.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), second);

    const count = db.$client
      .prepare(
        "SELECT COUNT(*) AS count FROM turn_states WHERE device_id = ? AND session_id = ? AND kind = ?",
      )
      .get(deviceId, DEFAULT_SESSION_ID, GOAL_PROPOSAL_KIND) as { count: number };
    assert.equal(count.count, 1);
  });

  it("returns undefined after the row expires", async () => {
    await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1400,
        protein: 120,
        carbs: 130,
        fat: 45,
      },
    });

    db.$client
      .prepare(
        "UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND session_id = ? AND kind = ?",
      )
      .run("2026-05-16T00:00:00.000Z", deviceId, DEFAULT_SESSION_ID, GOAL_PROPOSAL_KIND);

    assert.equal(await service.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
  });

  it("clears the active proposal", async () => {
    await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1400,
        protein: 120,
        carbs: 130,
        fat: 45,
      },
    });

    await service.clear({ deviceId, sessionId: DEFAULT_SESSION_ID });

    assert.equal(await service.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
  });

  it("treats a pending proposal as missing from a different session", async () => {
    const targets = {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    };
    const proposal = await service.putLatest({
      deviceId,
      sessionId: "session-a",
      targets,
    });

    assert.equal(await service.getLatest({ deviceId, sessionId: "session-b" }), undefined);
    assert.deepEqual(await service.getLatest({ deviceId, sessionId: "session-a" }), proposal);
  });

  it("isolates same-kind pendings across sessions (coexist, clear does not leak)", async () => {
    const targetsA = {
      calories: 1400,
      protein: 120,
      carbs: 130,
      fat: 45,
    };
    const targetsB = {
      calories: 1800,
      protein: 150,
      carbs: 170,
      fat: 60,
    };
    await service.putLatest({ deviceId, sessionId: "session-a", targets: targetsA });
    const sessionBProposal = await service.putLatest({
      deviceId,
      sessionId: "session-b",
      targets: targetsB,
    });

    await service.clear({ deviceId, sessionId: "session-a" });

    assert.equal(await service.getLatest({ deviceId, sessionId: "session-a" }), undefined);
    assert.deepEqual(
      await service.getLatest({ deviceId, sessionId: "session-b" }),
      sessionBProposal,
    );
  });
});
