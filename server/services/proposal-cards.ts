import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import {
  chatProposalActionEvents,
  chatProposalCards,
} from "../db/schema.js";
import type { SyncTransactionClient } from "./turn-state.js";

export const PROPOSAL_KINDS = ["goal", "meal_numeric", "meal_estimate", "meal_delete"] as const;
export const PROPOSAL_LANES = ["goal", "meal_mutation"] as const;
export const PROPOSAL_STATUSES = [
  "active",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "stale",
] as const;
export const PROPOSAL_ACTIONS = ["approve", "edit", "reject"] as const;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalLane = (typeof PROPOSAL_LANES)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export interface ProposalCardDetailRow {
  label: string;
  before?: string;
  after?: string;
  value?: string;
}

export interface ProposalCardDetails {
  rows: ProposalCardDetailRow[];
  [key: string]: unknown;
}

export interface ProposalCardActions {
  approveLabel: string;
  editLabel: string;
  rejectLabel: string;
}

export interface ProposalCardMetadata {
  id: string;
  deviceId: string;
  assistantMessageId: string;
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  status: ProposalStatus;
  title: string;
  details: ProposalCardDetails;
  actions: ProposalCardActions;
  expiresAt: string | null;
  lapseCopy: string | null;
  supersededByKind: ProposalKind | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalCardClientMetadata {
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  status: ProposalStatus;
  isActionable: boolean;
  title: string;
  details: ProposalCardDetails;
  actions: ProposalCardActions;
  expiresAt: string | null;
  lapseCopy: string | null;
  supersededByKind: ProposalKind | null;
}

export interface ProposalActionEventMetadata {
  id: string;
  deviceId: string;
  actionMessageId: string;
  assistantMessageId: string;
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  action: ProposalAction;
  transcriptCopy: string;
  createdAt: string;
}

export interface ProposalActionEventClientMetadata {
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  action: ProposalAction;
  transcriptCopy: string;
  createdAt: string;
}

export interface ProposalStatusProjection {
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  status: ProposalStatus;
  isActionable: boolean;
  expiresAt: string | null;
  lapseCopy: string | null;
}

export interface SaveProposalCardInput {
  deviceId: string;
  assistantMessageId: string;
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  status?: ProposalStatus;
  title: string;
  details: ProposalCardDetails;
  actions: ProposalCardActions;
  expiresAt?: string | null;
  lapseCopy?: string | null;
  supersededByKind?: ProposalKind | null;
}

export type PendingProposalCardInput = Omit<SaveProposalCardInput, "deviceId" | "assistantMessageId">;

export interface SaveProposalActionEventInput {
  deviceId: string;
  actionMessageId: string;
  assistantMessageId: string;
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  action: ProposalAction;
  transcriptCopy: string;
}

interface ActiveProposalSnapshot {
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: ProposalLane;
  expiresAt?: string | null;
}

const STALE_PROPOSAL_COPY = "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。";

function assertOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid proposal ${label}`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid proposal ${label}`);
  }
}

function assertDetails(details: ProposalCardDetails): ProposalCardDetails {
  if (!details || typeof details !== "object" || !Array.isArray(details.rows)) {
    throw new Error("Invalid proposal details");
  }

  for (const row of details.rows) {
    if (!row || typeof row !== "object") {
      throw new Error("Invalid proposal detail row");
    }
    assertNonEmptyString(row.label, "detail row label");
    if (row.before !== undefined && typeof row.before !== "string") {
      throw new Error("Invalid proposal detail before value");
    }
    if (row.after !== undefined && typeof row.after !== "string") {
      throw new Error("Invalid proposal detail after value");
    }
    if (row.value !== undefined && typeof row.value !== "string") {
      throw new Error("Invalid proposal detail value");
    }
  }

  return JSON.parse(JSON.stringify(details)) as ProposalCardDetails;
}

function assertActions(actions: ProposalCardActions): ProposalCardActions {
  assertNonEmptyString(actions.approveLabel, "approve label");
  assertNonEmptyString(actions.editLabel, "edit label");
  assertNonEmptyString(actions.rejectLabel, "reject label");
  return { ...actions };
}

function parseDetails(raw: string): ProposalCardDetails {
  const parsed = JSON.parse(raw) as ProposalCardDetails;
  return assertDetails(parsed);
}

function parseActions(raw: string): ProposalCardActions {
  const parsed = JSON.parse(raw) as ProposalCardActions;
  return assertActions(parsed);
}

function cardRowToMetadata(row: typeof chatProposalCards.$inferSelect): ProposalCardMetadata {
  assertOneOf(row.proposalKind, PROPOSAL_KINDS, "kind");
  assertOneOf(row.proposalLane, PROPOSAL_LANES, "lane");
  assertOneOf(row.status, PROPOSAL_STATUSES, "status");
  if (row.supersededByKind !== null) {
    assertOneOf(row.supersededByKind, PROPOSAL_KINDS, "superseded kind");
  }

  return {
    id: row.id,
    deviceId: row.deviceId,
    assistantMessageId: row.assistantMessageId,
    proposalId: row.proposalId,
    proposalKind: row.proposalKind,
    proposalLane: row.proposalLane,
    status: row.status,
    title: row.title,
    details: parseDetails(row.detailsJson),
    actions: parseActions(row.actionsJson),
    expiresAt: row.expiresAt,
    lapseCopy: row.lapseCopy,
    supersededByKind: row.supersededByKind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function actionEventRowToMetadata(
  row: typeof chatProposalActionEvents.$inferSelect,
): ProposalActionEventMetadata {
  assertOneOf(row.proposalKind, PROPOSAL_KINDS, "kind");
  assertOneOf(row.proposalLane, PROPOSAL_LANES, "lane");
  assertOneOf(row.action, PROPOSAL_ACTIONS, "action");

  return {
    id: row.id,
    deviceId: row.deviceId,
    actionMessageId: row.actionMessageId,
    assistantMessageId: row.assistantMessageId,
    proposalId: row.proposalId,
    proposalKind: row.proposalKind,
    proposalLane: row.proposalLane,
    action: row.action,
    transcriptCopy: row.transcriptCopy,
    createdAt: row.createdAt,
  };
}

function cardRawRowToMetadata(row: {
  id: string;
  deviceId: string;
  assistantMessageId: string;
  proposalId: string;
  proposalKind: string;
  proposalLane: string;
  status: string;
  title: string;
  detailsJson: string;
  actionsJson: string;
  expiresAt: string | null;
  lapseCopy: string | null;
  supersededByKind: string | null;
  createdAt: string;
  updatedAt: string;
}): ProposalCardMetadata {
  return cardRowToMetadata(row as typeof chatProposalCards.$inferSelect);
}

function isExpired(expiresAt: string | null | undefined, now: Date): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= now.getTime());
}

function activeProposalMatches(
  card: ProposalCardMetadata,
  active: ActiveProposalSnapshot,
): boolean {
  return active.proposalId === card.proposalId &&
    active.proposalKind === card.proposalKind &&
    active.proposalLane === card.proposalLane;
}

export function proposalKindToLane(proposalKind: ProposalKind): ProposalLane {
  return proposalKind === "goal" ? "goal" : "meal_mutation";
}

function projectDetailsForClient(details: ProposalCardDetails): ProposalCardDetails {
  const { targetSignature: _targetSignature, ...clientDetails } = details;
  return JSON.parse(JSON.stringify(clientDetails)) as ProposalCardDetails;
}

function projectLapseCopyForClient(
  status: ProposalStatus,
  lapseCopy: string | null,
): string | null {
  return status === "approved" || status === "rejected" ? null : lapseCopy;
}

function isTerminalStatus(status: ProposalStatus): boolean {
  return status === "approved" || status === "rejected";
}

export function projectProposalCardForClient(
  card: ProposalCardMetadata,
  projection?: ProposalStatusProjection,
): ProposalCardClientMetadata {
  const status = projection?.status ?? card.status;
  const lapseCopy = projection?.lapseCopy ?? card.lapseCopy;
  return {
    proposalId: card.proposalId,
    proposalKind: card.proposalKind,
    proposalLane: card.proposalLane,
    status,
    isActionable: status === "active" && (projection?.isActionable ?? card.status === "active"),
    title: card.title,
    details: projectDetailsForClient(card.details),
    actions: card.actions,
    expiresAt: projection?.expiresAt ?? card.expiresAt,
    lapseCopy: projectLapseCopyForClient(status, lapseCopy),
    supersededByKind: card.supersededByKind,
  };
}

export function projectProposalActionEventForClient(
  event: ProposalActionEventMetadata,
): ProposalActionEventClientMetadata {
  return {
    proposalId: event.proposalId,
    proposalKind: event.proposalKind,
    proposalLane: event.proposalLane,
    action: event.action,
    transcriptCopy: event.transcriptCopy,
    createdAt: event.createdAt,
  };
}

export function createProposalCardService(db: AppDatabase) {
  function getLatestCardForProposalSync({
    deviceId,
    proposalId,
    proposalKind,
  }: {
    deviceId: string;
    proposalId: string;
    proposalKind?: ProposalKind;
  }, client: SyncTransactionClient = db.$client): ProposalCardMetadata | undefined {
    const kindClause = proposalKind === undefined ? "" : " AND proposal_kind = ?";
    const row = client
      .prepare(
        `
          SELECT
            id,
            device_id AS deviceId,
            assistant_message_id AS assistantMessageId,
            proposal_id AS proposalId,
            proposal_kind AS proposalKind,
            proposal_lane AS proposalLane,
            status,
            title,
            details_json AS detailsJson,
            actions_json AS actionsJson,
            expires_at AS expiresAt,
            lapse_copy AS lapseCopy,
            superseded_by_kind AS supersededByKind,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM chat_proposal_cards
          WHERE device_id = ? AND proposal_id = ?${kindClause}
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get(...(proposalKind === undefined ? [deviceId, proposalId] : [deviceId, proposalId, proposalKind])) as Parameters<typeof cardRawRowToMetadata>[0] | undefined;
    return row ? cardRawRowToMetadata(row) : undefined;
  }

  function markProposalStatusSync({
    deviceId,
    proposalId,
    proposalKind,
    status,
    lapseCopy,
    supersededByKind,
  }: {
    deviceId: string;
    proposalId: string;
    proposalKind?: ProposalKind;
    status: ProposalStatus;
    lapseCopy?: string | null;
    supersededByKind?: ProposalKind | null;
  }, client: SyncTransactionClient = db.$client): number {
    assertOneOf(status, PROPOSAL_STATUSES, "status");
    if (supersededByKind !== undefined && supersededByKind !== null) {
      assertOneOf(supersededByKind, PROPOSAL_KINDS, "superseded kind");
    }

    const assignments = ["status = ?", "updated_at = ?"];
    const values: Array<string | null> = [status, new Date().toISOString()];
    if (lapseCopy !== undefined) {
      assignments.push("lapse_copy = ?");
      values.push(lapseCopy);
    } else if (isTerminalStatus(status)) {
      assignments.push("lapse_copy = NULL");
    }
    if (supersededByKind !== undefined) {
      assignments.push("superseded_by_kind = ?");
      values.push(supersededByKind);
    }
    values.push(deviceId, proposalId);
    const kindClause = proposalKind === undefined ? "" : " AND proposal_kind = ?";
    if (proposalKind !== undefined) values.push(proposalKind);
    const result = client
      .prepare(`UPDATE chat_proposal_cards SET ${assignments.join(", ")} WHERE device_id = ? AND proposal_id = ?${kindClause}`)
      .run(...values);
    return result.changes;
  }

  function saveProposalActionEventSync(input: SaveProposalActionEventInput, client: SyncTransactionClient = db.$client): ProposalActionEventMetadata {
    assertOneOf(input.proposalKind, PROPOSAL_KINDS, "kind");
    assertOneOf(input.proposalLane, PROPOSAL_LANES, "lane");
    assertOneOf(input.action, PROPOSAL_ACTIONS, "action");
    assertNonEmptyString(input.transcriptCopy, "transcript copy");
    const row = {
      id: crypto.randomUUID(),
      deviceId: input.deviceId,
      actionMessageId: input.actionMessageId,
      assistantMessageId: input.assistantMessageId,
      proposalId: input.proposalId,
      proposalKind: input.proposalKind,
      proposalLane: input.proposalLane,
      action: input.action,
      transcriptCopy: input.transcriptCopy,
      createdAt: new Date().toISOString(),
    } satisfies typeof chatProposalActionEvents.$inferInsert;
    client
      .prepare(
        `
          INSERT INTO chat_proposal_action_events (
            id, device_id, action_message_id, assistant_message_id,
            proposal_id, proposal_kind, proposal_lane, action,
            transcript_copy, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        row.id,
        row.deviceId,
        row.actionMessageId,
        row.assistantMessageId,
        row.proposalId,
        row.proposalKind,
        row.proposalLane,
        row.action,
        row.transcriptCopy,
        row.createdAt,
      );
    return actionEventRowToMetadata(row);
  }

  return {
    async saveAssistantProposalCard(
      input: SaveProposalCardInput,
    ): Promise<ProposalCardMetadata> {
      assertOneOf(input.proposalKind, PROPOSAL_KINDS, "kind");
      assertOneOf(input.proposalLane, PROPOSAL_LANES, "lane");
      const status = input.status ?? "active";
      assertOneOf(status, PROPOSAL_STATUSES, "status");
      if (input.supersededByKind !== undefined && input.supersededByKind !== null) {
        assertOneOf(input.supersededByKind, PROPOSAL_KINDS, "superseded kind");
      }
      assertNonEmptyString(input.title, "title");

      const now = new Date().toISOString();
      const row = {
        id: crypto.randomUUID(),
        deviceId: input.deviceId,
        assistantMessageId: input.assistantMessageId,
        proposalId: input.proposalId,
        proposalKind: input.proposalKind,
        proposalLane: input.proposalLane,
        status,
        title: input.title,
        detailsJson: JSON.stringify(assertDetails(input.details)),
        actionsJson: JSON.stringify(assertActions(input.actions)),
        expiresAt: input.expiresAt ?? null,
        lapseCopy: input.lapseCopy ?? null,
        supersededByKind: input.supersededByKind ?? null,
        createdAt: now,
        updatedAt: now,
      } satisfies typeof chatProposalCards.$inferInsert;

      await db.insert(chatProposalCards).values(row);
      return cardRowToMetadata(row);
    },

    async saveProposalActionEvent(
      input: SaveProposalActionEventInput,
    ): Promise<ProposalActionEventMetadata> {
      assertOneOf(input.proposalKind, PROPOSAL_KINDS, "kind");
      assertOneOf(input.proposalLane, PROPOSAL_LANES, "lane");
      assertOneOf(input.action, PROPOSAL_ACTIONS, "action");
      assertNonEmptyString(input.transcriptCopy, "transcript copy");

      const row = {
        id: crypto.randomUUID(),
        deviceId: input.deviceId,
        actionMessageId: input.actionMessageId,
        assistantMessageId: input.assistantMessageId,
        proposalId: input.proposalId,
        proposalKind: input.proposalKind,
        proposalLane: input.proposalLane,
        action: input.action,
        transcriptCopy: input.transcriptCopy,
        createdAt: new Date().toISOString(),
      } satisfies typeof chatProposalActionEvents.$inferInsert;

      await db.insert(chatProposalActionEvents).values(row);
      return actionEventRowToMetadata(row);
    },

    saveProposalActionEventSync,

    async getCardsForAssistantMessages({
      deviceId,
      assistantMessageIds,
    }: {
      deviceId: string;
      assistantMessageIds: string[];
    }): Promise<Map<string, ProposalCardMetadata>> {
      if (assistantMessageIds.length === 0) {
        return new Map();
      }

      const rows = await db
        .select()
        .from(chatProposalCards)
        .where(
          and(
            eq(chatProposalCards.deviceId, deviceId),
            inArray(chatProposalCards.assistantMessageId, assistantMessageIds),
          ),
        );
      return new Map(rows.map((row) => [row.assistantMessageId, cardRowToMetadata(row)]));
    },

    async getLatestCardForProposal({
      deviceId,
      proposalId,
      proposalKind,
    }: {
      deviceId: string;
      proposalId: string;
      proposalKind?: ProposalKind;
    }): Promise<ProposalCardMetadata | undefined> {
      const rows = await db
        .select()
        .from(chatProposalCards)
        .where(
          and(
            eq(chatProposalCards.deviceId, deviceId),
            eq(chatProposalCards.proposalId, proposalId),
            ...(proposalKind === undefined ? [] : [eq(chatProposalCards.proposalKind, proposalKind)]),
          ),
        )
        .orderBy(desc(chatProposalCards.createdAt))
        .limit(1);
      return rows[0] ? cardRowToMetadata(rows[0]) : undefined;
    },

    getLatestCardForProposalSync,

    async getActionEventsForMessages({
      deviceId,
      messageIds,
    }: {
      deviceId: string;
      messageIds: string[];
    }): Promise<Map<string, ProposalActionEventMetadata>> {
      if (messageIds.length === 0) {
        return new Map();
      }

      const rows = await db
        .select()
        .from(chatProposalActionEvents)
        .where(
          and(
            eq(chatProposalActionEvents.deviceId, deviceId),
            inArray(chatProposalActionEvents.actionMessageId, messageIds),
          ),
        );
      return new Map(rows.map((row) => [row.actionMessageId, actionEventRowToMetadata(row)]));
    },

    async markProposalStatus({
      deviceId,
      proposalId,
      proposalKind,
      status,
      lapseCopy,
      supersededByKind,
    }: {
      deviceId: string;
      proposalId: string;
      proposalKind?: ProposalKind;
      status: ProposalStatus;
      lapseCopy?: string | null;
      supersededByKind?: ProposalKind | null;
    }): Promise<number> {
      assertOneOf(status, PROPOSAL_STATUSES, "status");
      if (supersededByKind !== undefined && supersededByKind !== null) {
        assertOneOf(supersededByKind, PROPOSAL_KINDS, "superseded kind");
      }

      const result = await db
        .update(chatProposalCards)
        .set({
          status,
          ...(lapseCopy !== undefined ? { lapseCopy } : isTerminalStatus(status) ? { lapseCopy: null } : {}),
          ...(supersededByKind !== undefined ? { supersededByKind } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(chatProposalCards.deviceId, deviceId),
            eq(chatProposalCards.proposalId, proposalId),
            ...(proposalKind === undefined ? [] : [eq(chatProposalCards.proposalKind, proposalKind)]),
          ),
        );

      return result.changes;
    },

    markProposalStatusSync,

    async markSupersededInLane({
      deviceId,
      proposalLane,
      replacementProposalId,
      supersededByKind,
      lapseCopy,
    }: {
      deviceId: string;
      proposalLane: ProposalLane;
      replacementProposalId: string;
      supersededByKind: ProposalKind;
      lapseCopy: string;
    }): Promise<number> {
      assertOneOf(proposalLane, PROPOSAL_LANES, "lane");
      assertOneOf(supersededByKind, PROPOSAL_KINDS, "superseded kind");
      assertNonEmptyString(lapseCopy, "lapse copy");

      const result = await db
        .update(chatProposalCards)
        .set({
          status: "superseded",
          supersededByKind,
          lapseCopy,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(chatProposalCards.deviceId, deviceId),
            eq(chatProposalCards.proposalLane, proposalLane),
            eq(chatProposalCards.status, "active"),
            ne(chatProposalCards.proposalId, replacementProposalId),
          ),
        );

      return result.changes;
    },

    async markActiveLaneStale({
      deviceId,
      proposalLane,
      lapseCopy,
    }: {
      deviceId: string;
      proposalLane: ProposalLane;
      lapseCopy: string;
    }): Promise<number> {
      assertOneOf(proposalLane, PROPOSAL_LANES, "lane");
      assertNonEmptyString(lapseCopy, "lapse copy");

      const result = await db
        .update(chatProposalCards)
        .set({
          status: "stale",
          lapseCopy,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(chatProposalCards.deviceId, deviceId),
            eq(chatProposalCards.proposalLane, proposalLane),
            eq(chatProposalCards.status, "active"),
          ),
        );

      return result.changes;
    },

    projectStatusForCards({
      deviceId,
      cards,
      activeProposals,
      now = new Date(),
    }: {
      deviceId: string;
      cards: ProposalCardMetadata[];
      activeProposals: ActiveProposalSnapshot[];
      now?: Date;
    }): ProposalStatusProjection[] {
      return cards.filter((card) => card.deviceId === deviceId).map((card) => {
        if (card.status !== "active") {
          return {
            proposalId: card.proposalId,
            proposalKind: card.proposalKind,
            proposalLane: card.proposalLane,
            status: card.status,
            isActionable: false,
            expiresAt: card.expiresAt,
            lapseCopy: projectLapseCopyForClient(card.status, card.lapseCopy),
          };
        }

        const active = activeProposals.find((snapshot) => activeProposalMatches(card, snapshot));
        const projectedExpiresAt = card.expiresAt ?? active?.expiresAt ?? null;
        if (isExpired(projectedExpiresAt, now)) {
          return {
            proposalId: card.proposalId,
            proposalKind: card.proposalKind,
            proposalLane: card.proposalLane,
            status: "expired",
            isActionable: false,
            expiresAt: projectedExpiresAt,
            lapseCopy: card.lapseCopy,
          };
        }

        if (!active) {
          return {
            proposalId: card.proposalId,
            proposalKind: card.proposalKind,
            proposalLane: card.proposalLane,
            status: "stale",
            isActionable: false,
            expiresAt: projectedExpiresAt,
            lapseCopy: STALE_PROPOSAL_COPY,
          };
        }

        return {
          proposalId: card.proposalId,
          proposalKind: card.proposalKind,
          proposalLane: card.proposalLane,
          status: "active",
          isActionable: true,
          expiresAt: projectedExpiresAt,
          lapseCopy: card.lapseCopy,
        };
      });
    },
  };
}
