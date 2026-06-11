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

export interface TurnStateKey {
  deviceId: string;
  sessionId: string;
  kind: string;
}

export interface ConsumeTurnStateParams extends TurnStateKey {
  proposalId: string;
  expectedMealRevisionId?: string;
}

export function createTurnStateService(db: AppDatabase) {
  async function clearState({ deviceId, sessionId, kind }: TurnStateKey): Promise<void> {
    db.$client
      .prepare("DELETE FROM turn_states WHERE device_id = ? AND session_id = ? AND kind = ?")
      .run(deviceId, sessionId, kind);
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
      const row = db.$client
        .prepare(
          `
            SELECT
              id,
              device_id AS deviceId,
              session_id AS sessionId,
              kind,
              payload,
              expires_at AS expiresAt,
              created_at AS createdAt,
              updated_at AS updatedAt
            FROM turn_states
            WHERE device_id = ? AND session_id = ? AND kind = ?
            LIMIT 1
          `,
        )
        .get(deviceId, sessionId, kind) as TurnStateRow | undefined;

      if (!row) {
        return undefined;
      }

      if (new Date(row.expiresAt).getTime() <= Date.now()) {
        await clearState({ deviceId, sessionId, kind });
        return undefined;
      }

      return JSON.parse(row.payload) as T;
    },

    clearState,

    async consumeState<T>({
      deviceId,
      sessionId,
      kind,
      proposalId,
      expectedMealRevisionId,
    }: ConsumeTurnStateParams): Promise<T | undefined> {
      const row = db.$client
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

      if (!row) {
        return undefined;
      }

      return JSON.parse(row.payload) as T;
    },
  };
}
