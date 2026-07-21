import type { AppDatabase } from "../db/client.js";

interface TurnStateRow {
  id: string;
  deviceId: string;
  sessionId: string;
  kind: string;
  payload: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SESSION_ID = "__default__";
export const RECENT_MEAL_LOG_KIND = "recent_meal_log";
export const RECENT_MEAL_LOG_TTL_MS = 5 * 60 * 1000;

export type SyncTransactionClient = AppDatabase["$client"];

export interface TurnStateKey {
  deviceId: string;
  sessionId: string;
  kind: string;
}

export interface RecentMealLogPayload {
  mealId: string;
  mealRevisionId: string;
  dateKey: string;
  foodName: string;
  itemNames: string[];
  loggedAt: string;
}

export interface ConsumeTurnStateParams extends TurnStateKey {
  proposalId: string;
  expectedMealRevisionId?: string;
}

export type RuntimeTurnState = "active" | "stopped" | "disconnected" | "completed";

export interface RuntimeTurnLifecycle {
  readonly turnId: string;
  readonly controller: AbortController;
  readonly state: RuntimeTurnState;
  requestStop(): boolean;
  disconnect(): boolean;
  markCompleted(): boolean;
  cleanupOnce(cleanup: () => void): boolean;
  isStopped(): boolean;
  isDisconnected(): boolean;
}

export function createRuntimeTurnLifecycle(turnId: string): RuntimeTurnLifecycle {
  const controller = new AbortController();
  let currentState: RuntimeTurnState = "active";
  let cleanupCompleted = false;

  return {
    turnId,
    controller,
    get state() {
      return currentState;
    },
    requestStop() {
      if (currentState !== "active") return false;
      currentState = "stopped";
      controller.abort();
      return true;
    },
    disconnect() {
      if (currentState !== "active") return false;
      currentState = "disconnected";
      controller.abort();
      return true;
    },
    markCompleted() {
      if (currentState === "disconnected" || currentState === "completed") return false;
      currentState = "completed";
      return true;
    },
    cleanupOnce(cleanup) {
      if (cleanupCompleted) return false;
      cleanupCompleted = true;
      cleanup();
      return true;
    },
    isStopped() {
      return currentState === "stopped";
    },
    isDisconnected() {
      return currentState === "disconnected";
    },
  };
}

export function createTurnStateService(db: AppDatabase) {
  function clearStateSync(
    { deviceId, sessionId, kind }: TurnStateKey,
    client: SyncTransactionClient = db.$client,
  ): void {
    client
      .prepare("DELETE FROM turn_states WHERE device_id = ? AND session_id = ? AND kind = ?")
      .run(deviceId, sessionId, kind);
  }

  function getStateSync<T>({ deviceId, sessionId, kind }: TurnStateKey, client: SyncTransactionClient = db.$client): T | undefined {
    const row = client
      .prepare(
        `
          SELECT payload, expires_at AS expiresAt
          FROM turn_states
          WHERE device_id = ? AND session_id = ? AND kind = ?
          LIMIT 1
        `,
      )
      .get(deviceId, sessionId, kind) as Pick<TurnStateRow, "payload" | "expiresAt"> | undefined;

    if (!row) return undefined;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      clearStateSync({ deviceId, sessionId, kind }, client);
      return undefined;
    }
    return JSON.parse(row.payload) as T;
  }

  function consumeStateSync<T>({
    deviceId,
    sessionId,
    kind,
    proposalId,
    expectedMealRevisionId,
  }: ConsumeTurnStateParams, client: SyncTransactionClient = db.$client): T | undefined {
    const row = client
      .prepare(
        `
          DELETE FROM turn_states
          WHERE device_id = ?
            AND session_id = ?
            AND kind = ?
            AND expires_at > ?
            AND json_extract(payload, '$.proposalId') = ?
            AND (? IS NULL OR json_extract(payload, '$.expectedMealRevisionId') = ?)
          RETURNING payload
        `,
      )
      .get(
        deviceId,
        sessionId,
        kind,
        new Date().toISOString(),
        proposalId,
        expectedMealRevisionId ?? null,
        expectedMealRevisionId ?? null,
      ) as Pick<TurnStateRow, "payload"> | undefined;

    return row ? JSON.parse(row.payload) as T : undefined;
  }

  async function clearState({ deviceId, sessionId, kind }: TurnStateKey): Promise<void> {
    clearStateSync({ deviceId, sessionId, kind });
  }

  return {
    async putState<T>({
      deviceId,
      sessionId,
      kind,
      payload,
      ttlMs,
    }: TurnStateKey & { payload: T; ttlMs: number }): Promise<void> {
      const now = new Date();
      const createdAt = now.toISOString();
      const updatedAt = createdAt;
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

      db.$client
        .prepare(
          `
            INSERT INTO turn_states (
              id,
              device_id,
              session_id,
              kind,
              payload,
              expires_at,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, session_id, kind) DO UPDATE SET
              payload = excluded.payload,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          `${deviceId}:${sessionId}:${kind}`,
          deviceId,
          sessionId,
          kind,
          JSON.stringify(payload),
          expiresAt,
          createdAt,
          updatedAt,
        );
    },

    async getState<T>({ deviceId, sessionId, kind }: TurnStateKey): Promise<T | undefined> {
      return getStateSync({ deviceId, sessionId, kind });
    },

    getStateSync,

    clearState,
    clearStateSync,

    async consumeState<T>({
      deviceId,
      sessionId,
      kind,
      proposalId,
      expectedMealRevisionId,
    }: ConsumeTurnStateParams): Promise<T | undefined> {
      return consumeStateSync({
        deviceId,
        sessionId,
        kind,
        proposalId,
        expectedMealRevisionId,
      });
    },

    consumeStateSync,
  };
}

export function createRecentMealLogStateService(db: AppDatabase) {
  const turnStateService = createTurnStateService(db);

  return {
    async putLatest({
      deviceId,
      sessionId,
      payload,
    }: {
      deviceId: string;
      sessionId: string;
      payload: RecentMealLogPayload;
    }): Promise<void> {
      await turnStateService.putState({
        deviceId,
        sessionId,
        kind: RECENT_MEAL_LOG_KIND,
        payload,
        ttlMs: RECENT_MEAL_LOG_TTL_MS,
      });
    },

    async getLatest({
      deviceId,
      sessionId,
    }: {
      deviceId: string;
      sessionId: string;
    }): Promise<RecentMealLogPayload | undefined> {
      return turnStateService.getState<RecentMealLogPayload>({
        deviceId,
        sessionId,
        kind: RECENT_MEAL_LOG_KIND,
      });
    },

    async clear({
      deviceId,
      sessionId,
    }: {
      deviceId: string;
      sessionId: string;
    }): Promise<void> {
      await turnStateService.clearState({
        deviceId,
        sessionId,
        kind: RECENT_MEAL_LOG_KIND,
      });
    },
  };
}
