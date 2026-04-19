import type { AppDatabase } from "../db/client.js";

interface TurnStateRow {
  id: string;
  deviceId: string;
  kind: string;
  payload: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export function createTurnStateService(db: AppDatabase) {
  return {
    async putState<T>(
      deviceId: string,
      kind: string,
      payload: T,
      ttlMs: number,
    ): Promise<void> {
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
              kind,
              payload,
              expires_at,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, kind) DO UPDATE SET
              payload = excluded.payload,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          `${deviceId}:${kind}`,
          deviceId,
          kind,
          JSON.stringify(payload),
          expiresAt,
          createdAt,
          updatedAt,
        );
    },

    async getState<T>(deviceId: string, kind: string): Promise<T | undefined> {
      const row = db.$client
        .prepare(
          `
            SELECT
              id,
              device_id AS deviceId,
              kind,
              payload,
              expires_at AS expiresAt,
              created_at AS createdAt,
              updated_at AS updatedAt
            FROM turn_states
            WHERE device_id = ? AND kind = ?
            LIMIT 1
          `,
        )
        .get(deviceId, kind) as TurnStateRow | undefined;

      if (!row) {
        return undefined;
      }

      if (new Date(row.expiresAt).getTime() <= Date.now()) {
        await this.clearState(deviceId, kind);
        return undefined;
      }

      return JSON.parse(row.payload) as T;
    },

    async clearState(deviceId: string, kind: string): Promise<void> {
      db.$client
        .prepare("DELETE FROM turn_states WHERE device_id = ? AND kind = ?")
        .run(deviceId, kind);
    },
  };
}
