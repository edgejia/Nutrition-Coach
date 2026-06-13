process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  MEAL_DELETE_PROPOSAL_KIND,
  createMealDeleteProposalService,
  type MealDeleteProposalInput,
} from "../../server/services/meal-delete-proposals.js";
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

const BASE_INPUT: MealDeleteProposalInput = {
  mealId: "meal-1",
  expectedMealRevisionId: "rev-1",
  snapshot: {
    mealId: "meal-1",
    expectedMealRevisionId: "rev-1",
    mealLabel: "雞腿便當",
    calories: 720,
    protein: 42,
    carbs: 78,
    fat: 24,
    dateKey: "2026-05-17",
    loggedAt: "2026-05-17T12:05:00.000+08:00",
    mealPeriod: "lunch",
    items: [
      {
        foodName: "雞腿",
        calories: 360,
        protein: 30,
        carbs: 6,
        fat: 20,
      },
      {
        foodName: "白飯",
        calories: 360,
        protein: 12,
        carbs: 72,
        fat: 4,
      },
    ],
  },
};

function cloneInput(input: MealDeleteProposalInput = BASE_INPUT): MealDeleteProposalInput {
  return structuredClone(input);
}

function countMealRows(db: ReturnType<typeof createDb>): number {
  const mealTransactions = db.$client
    .prepare("SELECT COUNT(*) AS count FROM meal_transactions")
    .get() as { count: number };
  const mealRevisions = db.$client
    .prepare("SELECT COUNT(*) AS count FROM meal_revisions")
    .get() as { count: number };
  const mealRevisionItems = db.$client
    .prepare("SELECT COUNT(*) AS count FROM meal_revision_items")
    .get() as { count: number };
  return mealTransactions.count + mealRevisions.count + mealRevisionItems.count;
}

describe("meal delete proposal service", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let service: ReturnType<typeof createMealDeleteProposalService>;

  beforeEach(async () => {
    globalThis.Date = FixedDate as DateConstructor;
    db = createDb(":memory:");
    deviceId = (await createDeviceService(db).createDevice("fat_loss")).deviceId;
    service = createMealDeleteProposalService(db);
  });

  afterEach(() => {
    globalThis.Date = REAL_DATE;
  });

  it("stores and reads a session-scoped delete proposal payload", async () => {
    const proposal = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: cloneInput(),
    });

    assert.match(proposal.proposalId, /^[0-9a-f-]{36}$/);
    assert.equal(proposal.mealId, "meal-1");
    assert.equal(proposal.expectedMealRevisionId, "rev-1");
    assert.deepEqual(proposal.snapshot, BASE_INPUT.snapshot);
    assert.equal(proposal.createdAt, FIXED_NOW.toISOString());
    assert.equal(proposal.expiresAt, new REAL_DATE(FIXED_NOW.getTime() + 30 * 60 * 1000).toISOString());
    assert.deepEqual(await service.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), proposal);
  });

  it("preserves old-value summary fields in the persisted snapshot", async () => {
    const proposal = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: cloneInput({
        mealId: "meal-2",
        expectedMealRevisionId: "rev-2",
        snapshot: {
          mealId: "meal-2",
          expectedMealRevisionId: "rev-2",
          mealLabel: "早餐燕麥",
          calories: 410,
          protein: 24,
          carbs: 48,
          fat: 12,
          dateKey: "2026-05-16",
          loggedAt: "2026-05-16T08:10:00.000+08:00",
          mealPeriod: "breakfast",
        },
      }),
    });

    assert.deepEqual(proposal.snapshot, {
      mealId: "meal-2",
      expectedMealRevisionId: "rev-2",
      mealLabel: "早餐燕麥",
      calories: 410,
      protein: 24,
      carbs: 48,
      fat: 12,
      dateKey: "2026-05-16",
      loggedAt: "2026-05-16T08:10:00.000+08:00",
      mealPeriod: "breakfast",
    });
  });

  it("preserves grouped item lines while totals stay on the snapshot", async () => {
    const proposal = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: cloneInput(),
    });

    assert.deepEqual(proposal.snapshot.items, BASE_INPUT.snapshot.items);
    assert.equal(proposal.snapshot.calories, 720);
    assert.equal(proposal.snapshot.protein, 42);
    assert.equal(proposal.snapshot.carbs, 78);
    assert.equal(proposal.snapshot.fat, 24);
  });

  it("supersedes only the same delete proposal kind in one session", async () => {
    const first = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: cloneInput(),
    });
    const second = await service.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: cloneInput({
        mealId: "meal-2",
        expectedMealRevisionId: "rev-2",
        snapshot: {
          ...BASE_INPUT.snapshot,
          mealId: "meal-2",
          expectedMealRevisionId: "rev-2",
          mealLabel: "晚餐鮭魚",
          mealPeriod: "dinner",
        },
      }),
    });

    assert.notEqual(second.proposalId, first.proposalId);
    assert.deepEqual(await service.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), second);

    const rows = db.$client
      .prepare("SELECT kind, COUNT(*) AS count FROM turn_states WHERE device_id = ? AND session_id = ? GROUP BY kind")
      .all(deviceId, DEFAULT_SESSION_ID) as Array<{ kind: string; count: number }>;
    assert.deepEqual(rows, [{ kind: MEAL_DELETE_PROPOSAL_KIND, count: 1 }]);
  });

  it("fails closed for expiry, mismatches, clear, and one-shot consume without mutating meals", async () => {
    const startingMealRows = countMealRows(db);
    const proposal = await service.putLatest({
      deviceId,
      sessionId: "session-a",
      input: cloneInput(),
    });

    assert.equal(
      await service.consumeLatest({
        deviceId,
        sessionId: "session-a",
        proposalId: "wrong-proposal",
        expectedMealRevisionId: "rev-1",
      }),
      undefined,
    );
    assert.equal(
      await service.consumeLatest({
        deviceId,
        sessionId: "session-b",
        proposalId: proposal.proposalId,
        expectedMealRevisionId: "rev-1",
      }),
      undefined,
    );
    assert.equal(
      await service.consumeLatest({
        deviceId,
        sessionId: "session-a",
        proposalId: proposal.proposalId,
        expectedMealRevisionId: "rev-2",
      }),
      undefined,
    );
    assert.deepEqual(await service.getLatest({ deviceId, sessionId: "session-a" }), proposal);

    assert.deepEqual(
      await service.consumeLatest({
        deviceId,
        sessionId: "session-a",
        proposalId: proposal.proposalId,
        expectedMealRevisionId: "rev-1",
      }),
      proposal,
    );
    assert.equal(
      await service.consumeLatest({
        deviceId,
        sessionId: "session-a",
        proposalId: proposal.proposalId,
        expectedMealRevisionId: "rev-1",
      }),
      undefined,
    );

    const clearProposal = await service.putLatest({
      deviceId,
      sessionId: "session-a",
      input: cloneInput(),
    });
    await service.clear({ deviceId, sessionId: "session-a" });
    assert.equal(await service.getLatest({ deviceId, sessionId: "session-a" }), undefined);
    assert.equal(
      await service.consumeLatest({
        deviceId,
        sessionId: "session-a",
        proposalId: clearProposal.proposalId,
        expectedMealRevisionId: "rev-1",
      }),
      undefined,
    );

    const expired = await service.putLatest({
      deviceId,
      sessionId: "session-a",
      input: cloneInput(),
    });
    db.$client
      .prepare(
        "UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND session_id = ? AND kind = ?",
      )
      .run("2026-05-16T00:00:00.000Z", deviceId, "session-a", MEAL_DELETE_PROPOSAL_KIND);
    assert.equal(await service.getLatest({ deviceId, sessionId: "session-a" }), undefined);
    assert.equal(
      await service.consumeLatest({
        deviceId,
        sessionId: "session-a",
        proposalId: expired.proposalId,
        expectedMealRevisionId: "rev-1",
      }),
      undefined,
    );
    assert.equal(countMealRows(db), startingMealRows);
  });
});
