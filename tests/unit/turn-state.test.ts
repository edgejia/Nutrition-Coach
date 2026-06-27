process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  createRecentMealLogStateService,
  RECENT_MEAL_LOG_KIND,
  createTurnStateService,
  type RecentMealLogPayload,
} from "../../server/services/turn-state.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-05-17T08:30:00+08:00");
const KIND = "goal_proposal";
const SESSION_A = "session-a";
const SESSION_B = "session-b";

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

describe("turn state service", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let service: ReturnType<typeof createTurnStateService>;

  beforeEach(async () => {
    globalThis.Date = FixedDate as DateConstructor;
    db = createDb(":memory:");
    deviceId = (await createDeviceService(db).createDevice("fat_loss")).deviceId;
    service = createTurnStateService(db);
  });

  afterEach(() => {
    globalThis.Date = REAL_DATE;
    db.$client.close();
  });

  it("does not expose a pending state to another session", async () => {
    const payload = { proposalId: "proposal-a", calories: 1400 };

    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload,
      ttlMs: 60_000,
    });

    assert.equal(await service.getState({ deviceId, sessionId: SESSION_B, kind: KIND }), undefined);
    assert.deepEqual(await service.getState<typeof payload>({ deviceId, sessionId: SESSION_A, kind: KIND }), payload);
  });

  it("keeps same-kind states in different sessions side by side", async () => {
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload: { proposalId: "proposal-a" },
      ttlMs: 60_000,
    });
    await service.putState({
      deviceId,
      sessionId: SESSION_B,
      kind: KIND,
      payload: { proposalId: "proposal-b" },
      ttlMs: 60_000,
    });

    assert.deepEqual(
      db.$client
        .prepare(
          `SELECT session_id AS sessionId
           FROM turn_states
           WHERE device_id = ? AND kind = ?
           ORDER BY session_id`,
        )
        .all(deviceId, KIND),
      [{ sessionId: SESSION_A }, { sessionId: SESSION_B }],
    );
    assert.deepEqual(await service.getState({ deviceId, sessionId: SESSION_A, kind: KIND }), {
      proposalId: "proposal-a",
    });
    assert.deepEqual(await service.getState({ deviceId, sessionId: SESSION_B, kind: KIND }), {
      proposalId: "proposal-b",
    });
  });

  it("clears only the matching session state", async () => {
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload: { proposalId: "proposal-a" },
      ttlMs: 60_000,
    });
    await service.putState({
      deviceId,
      sessionId: SESSION_B,
      kind: KIND,
      payload: { proposalId: "proposal-b" },
      ttlMs: 60_000,
    });

    await service.clearState({ deviceId, sessionId: SESSION_A, kind: KIND });

    assert.equal(await service.getState({ deviceId, sessionId: SESSION_A, kind: KIND }), undefined);
    assert.deepEqual(await service.getState({ deviceId, sessionId: SESSION_B, kind: KIND }), {
      proposalId: "proposal-b",
    });
  });

  it("expires and removes only the matching session row", async () => {
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload: { proposalId: "proposal-a" },
      ttlMs: 60_000,
    });
    await service.putState({
      deviceId,
      sessionId: SESSION_B,
      kind: KIND,
      payload: { proposalId: "proposal-b" },
      ttlMs: 60_000,
    });

    db.$client
      .prepare(
        `UPDATE turn_states
         SET expires_at = ?
         WHERE device_id = ? AND session_id = ? AND kind = ?`,
      )
      .run("2026-05-16T00:00:00.000Z", deviceId, SESSION_A, KIND);

    assert.equal(await service.getState({ deviceId, sessionId: SESSION_A, kind: KIND }), undefined);
    assert.deepEqual(await service.getState({ deviceId, sessionId: SESSION_B, kind: KIND }), {
      proposalId: "proposal-b",
    });
    assert.deepEqual(
      db.$client
        .prepare(
          `SELECT session_id AS sessionId
           FROM turn_states
           WHERE device_id = ? AND kind = ?
           ORDER BY session_id`,
        )
        .all(deviceId, KIND),
      [{ sessionId: SESSION_B }],
    );
  });

  it("upserts the same session state without adding a second row", async () => {
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload: { proposalId: "proposal-a" },
      ttlMs: 60_000,
    });
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload: { proposalId: "proposal-a-replacement" },
      ttlMs: 120_000,
    });

    assert.deepEqual(await service.getState({ deviceId, sessionId: SESSION_A, kind: KIND }), {
      proposalId: "proposal-a-replacement",
    });
    assert.deepEqual(
      db.$client
        .prepare(
          `SELECT COUNT(*) AS count
           FROM turn_states
           WHERE device_id = ? AND session_id = ? AND kind = ?`,
        )
        .get(deviceId, SESSION_A, KIND),
      { count: 1 },
    );
  });

  it("consumes a matching active proposal once", async () => {
    const payload = {
      proposalId: "proposal-a",
      expectedMealRevisionId: "rev-a",
      calories: 1400,
    };
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload,
      ttlMs: 60_000,
    });

    assert.deepEqual(
      await service.consumeState<typeof payload>({
        deviceId,
        sessionId: SESSION_A,
        kind: KIND,
        proposalId: "proposal-a",
      }),
      payload,
    );
    assert.equal(
      await service.consumeState({
        deviceId,
        sessionId: SESSION_A,
        kind: KIND,
        proposalId: "proposal-a",
      }),
      undefined,
    );
    assert.equal(await service.getState({ deviceId, sessionId: SESSION_A, kind: KIND }), undefined);
  });

  it("does not expose another session when consuming by proposal id", async () => {
    const payload = { proposalId: "proposal-a", calories: 1400 };
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload,
      ttlMs: 60_000,
    });

    assert.equal(
      await service.consumeState({
        deviceId,
        sessionId: SESSION_B,
        kind: KIND,
        proposalId: "proposal-a",
      }),
      undefined,
    );
    assert.deepEqual(await service.getState<typeof payload>({ deviceId, sessionId: SESSION_A, kind: KIND }), payload);
  });

  it("returns undefined for the wrong proposal id without deleting the active row", async () => {
    const payload = { proposalId: "proposal-a", calories: 1400 };
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload,
      ttlMs: 60_000,
    });

    assert.equal(
      await service.consumeState({
        deviceId,
        sessionId: SESSION_A,
        kind: KIND,
        proposalId: "proposal-b",
      }),
      undefined,
    );
    assert.deepEqual(await service.getState<typeof payload>({ deviceId, sessionId: SESSION_A, kind: KIND }), payload);
  });

  it("requires the expected meal revision when provided", async () => {
    const payload = {
      proposalId: "proposal-a",
      expectedMealRevisionId: "rev-a",
      calories: 1400,
    };
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload,
      ttlMs: 60_000,
    });

    assert.equal(
      await service.consumeState({
        deviceId,
        sessionId: SESSION_A,
        kind: KIND,
        proposalId: "proposal-a",
        expectedMealRevisionId: "rev-b",
      }),
      undefined,
    );
    assert.deepEqual(
      await service.consumeState<typeof payload>({
        deviceId,
        sessionId: SESSION_A,
        kind: KIND,
        proposalId: "proposal-a",
        expectedMealRevisionId: "rev-a",
      }),
      payload,
    );
  });

  it("does not consume expired proposal state", async () => {
    const payload = { proposalId: "proposal-a", calories: 1400 };
    await service.putState({
      deviceId,
      sessionId: SESSION_A,
      kind: KIND,
      payload,
      ttlMs: 60_000,
    });
    db.$client
      .prepare(
        `UPDATE turn_states
         SET expires_at = ?
         WHERE device_id = ? AND session_id = ? AND kind = ?`,
      )
      .run("2026-05-16T00:00:00.000Z", deviceId, SESSION_A, KIND);

    assert.equal(
      await service.consumeState({
        deviceId,
        sessionId: SESSION_A,
        kind: KIND,
        proposalId: "proposal-a",
      }),
      undefined,
    );
    assert.equal(await service.getState({ deviceId, sessionId: SESSION_A, kind: KIND }), undefined);
  });

  describe("recent meal log marker", () => {
    const recentMealPayload: RecentMealLogPayload = {
      mealId: "meal-a",
      mealRevisionId: "revision-a",
      dateKey: "2026-05-17",
      foodName: "雞腿便當",
      itemNames: ["雞腿", "白飯", "青菜"],
      loggedAt: "2026-05-17T00:30:00.000Z",
    };

    it("stores and reads the latest marker for the same device and session", async () => {
      const recentMealService = createRecentMealLogStateService(db);

      await recentMealService.putLatest({
        deviceId,
        sessionId: SESSION_A,
        payload: recentMealPayload,
      });

      assert.deepEqual(
        await recentMealService.getLatest({ deviceId, sessionId: SESSION_A }),
        recentMealPayload,
      );
      assert.deepEqual(
        db.$client
          .prepare(
            `SELECT kind
             FROM turn_states
             WHERE device_id = ? AND session_id = ?`,
          )
          .all(deviceId, SESSION_A),
        [{ kind: RECENT_MEAL_LOG_KIND }],
      );
    });

    it("does not expose a recent meal marker to another session", async () => {
      const recentMealService = createRecentMealLogStateService(db);

      await recentMealService.putLatest({
        deviceId,
        sessionId: SESSION_A,
        payload: recentMealPayload,
      });

      assert.equal(
        await recentMealService.getLatest({ deviceId, sessionId: SESSION_B }),
        undefined,
      );
      assert.deepEqual(
        await recentMealService.getLatest({ deviceId, sessionId: SESSION_A }),
        recentMealPayload,
      );
    });

    it("replaces the marker for the same device and session without adding a row", async () => {
      const recentMealService = createRecentMealLogStateService(db);
      const replacementPayload: RecentMealLogPayload = {
        ...recentMealPayload,
        mealId: "meal-b",
        mealRevisionId: "revision-b",
        foodName: "鮭魚飯",
        itemNames: ["鮭魚", "飯"],
      };

      await recentMealService.putLatest({
        deviceId,
        sessionId: SESSION_A,
        payload: recentMealPayload,
      });
      await recentMealService.putLatest({
        deviceId,
        sessionId: SESSION_A,
        payload: replacementPayload,
      });

      assert.deepEqual(
        await recentMealService.getLatest({ deviceId, sessionId: SESSION_A }),
        replacementPayload,
      );
      assert.deepEqual(
        db.$client
          .prepare(
            `SELECT COUNT(*) AS count
             FROM turn_states
             WHERE device_id = ? AND session_id = ? AND kind = ?`,
          )
          .get(deviceId, SESSION_A, RECENT_MEAL_LOG_KIND),
        { count: 1 },
      );
    });

    it("returns undefined and clears the row when the marker is expired", async () => {
      const recentMealService = createRecentMealLogStateService(db);

      await recentMealService.putLatest({
        deviceId,
        sessionId: SESSION_A,
        payload: recentMealPayload,
      });
      db.$client
        .prepare(
          `UPDATE turn_states
           SET expires_at = ?
           WHERE device_id = ? AND session_id = ? AND kind = ?`,
        )
        .run("2026-05-16T00:00:00.000Z", deviceId, SESSION_A, RECENT_MEAL_LOG_KIND);

      assert.equal(
        await recentMealService.getLatest({ deviceId, sessionId: SESSION_A }),
        undefined,
      );
      assert.deepEqual(
        db.$client
          .prepare(
            `SELECT COUNT(*) AS count
             FROM turn_states
             WHERE device_id = ? AND session_id = ? AND kind = ?`,
          )
          .get(deviceId, SESSION_A, RECENT_MEAL_LOG_KIND),
        { count: 0 },
      );
    });
  });
});
