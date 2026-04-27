process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations } from "../../server/db/migrate.js";

interface QueryPlanRow {
  detail: string;
}

const MEAL_TRANSACTIONS_SCAN = "SCAN meal_transactions";
const ASSET_REFERENCES_SCAN = "SCAN asset_references";
const ACTIVE_HISTORY_ORDERING_INDEX = "meal_tx_active_device_logged_created_id_idx";
const REVISION_ITEM_POSITION_INDEX = "meal_rev_items_revision_position_uq";

describe("Meal transaction query plan contracts", () => {
  let tempRoot: string;
  let sqlite: Database.Database;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-meal-query-plan-"));
    sqlite = new Database(path.join(tempRoot, "query-plan.db"));
    applyMigrations(sqlite);
    seedRepresentativeData(sqlite);
  });

  afterEach(async () => {
    sqlite.close();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("uses meal_tx_active_device_logged_at_idx for the active history header scan", () => {
    const details = explainQueryPlan(
      sqlite,
      `
        SELECT id, logged_at, current_revision_id
        FROM meal_transactions
        WHERE device_id = ? AND deleted_at IS NULL AND logged_at >= ? AND logged_at < ?
        ORDER BY logged_at ASC
      `,
      ["device-query-plan", "2026-04-19T00:00:00.000Z", "2026-04-20T00:00:00.000Z"],
    );

    assertHasIndex(details, "meal_tx_active_device_logged_at_idx");
    assertNoFullTableScan(details, MEAL_TRANSACTIONS_SCAN);
  });

  it("uses meal_tx_active_device_logged_at_idx for the daily summary range query", () => {
    const details = explainQueryPlan(
      sqlite,
      `
        SELECT
          coalesce(sum(meal_revision_items.calories), 0) AS total_calories,
          coalesce(sum(meal_revision_items.protein), 0) AS total_protein,
          coalesce(sum(meal_revision_items.carbs), 0) AS total_carbs,
          coalesce(sum(meal_revision_items.fat), 0) AS total_fat,
          count(distinct meal_transactions.id) AS meal_count
        FROM meal_transactions
        INNER JOIN meal_revisions
          ON meal_transactions.current_revision_id = meal_revisions.id
        INNER JOIN meal_revision_items
          ON meal_revision_items.revision_id = meal_revisions.id
        WHERE meal_transactions.device_id = ?
          AND meal_transactions.deleted_at IS NULL
          AND meal_transactions.logged_at >= ?
          AND meal_transactions.logged_at < ?
      `,
      ["device-query-plan", "2026-04-19T00:00:00.000Z", "2026-04-20T00:00:00.000Z"],
    );

    assertHasIndex(details, "meal_tx_active_device_logged_at_idx");
    assertNoFullTableScan(details, MEAL_TRANSACTIONS_SCAN);
  });

  it("uses meal_tx_device_id_id_idx for the shared device-plus-id mutation lookup", () => {
    const details = explainQueryPlan(
      sqlite,
      `
        SELECT id, device_id, logged_at, current_revision_id, current_revision_number, deleted_at
        FROM meal_transactions INDEXED BY meal_tx_device_id_id_idx
        WHERE device_id = ? AND id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
      ["device-query-plan", "tx-active"],
    );

    assertHasIndex(details, "meal_tx_device_id_id_idx");
    assertNoFullTableScan(details, MEAL_TRANSACTIONS_SCAN);
  });

  it("uses asset_refs_asset_id_idx for asset reachability checks", () => {
    const details = explainQueryPlan(
      sqlite,
      `
        SELECT id
        FROM asset_references
        WHERE asset_id = ?
        LIMIT 1
      `,
      ["asset-query-plan"],
    );

    assertHasIndex(details, "asset_refs_asset_id_idx");
    assertNoFullTableScan(details, ASSET_REFERENCES_SCAN);
  });

  it("uses the active history ordering index for history meals pagination", () => {
    const details = explainQueryPlan(
      sqlite,
      `
        SELECT id, logged_at, created_at, current_revision_id, current_revision_number
        FROM meal_transactions
        WHERE device_id = ? AND deleted_at IS NULL AND logged_at >= ? AND logged_at < ?
        ORDER BY logged_at DESC, created_at DESC, id ASC
        LIMIT ?
      `,
      ["device-query-plan", "2026-04-19T00:00:00.000Z", "2026-04-20T00:00:00.000Z", 11],
    );

    assertHasIndex(details, ACTIVE_HISTORY_ORDERING_INDEX);
    assertNoFullTableScan(details, MEAL_TRANSACTIONS_SCAN);
  });

  it("uses active transaction and revision-item indexes for history search", () => {
    const details = explainQueryPlan(
      sqlite,
      `
        SELECT
          meal_transactions.id,
          meal_transactions.logged_at,
          meal_transactions.created_at,
          meal_transactions.current_revision_id,
          meal_transactions.current_revision_number,
          meal_revision_items.position,
          meal_revision_items.food_name
        FROM meal_transactions
        INNER JOIN meal_revisions
          ON meal_transactions.current_revision_id = meal_revisions.id
        INNER JOIN meal_revision_items
          ON meal_transactions.current_revision_id = meal_revision_items.revision_id
        WHERE meal_transactions.device_id = ?
          AND meal_transactions.deleted_at IS NULL
          AND meal_transactions.logged_at >= ?
          AND meal_transactions.logged_at < ?
          AND lower(meal_revision_items.food_name) LIKE lower(?)
        ORDER BY
          meal_transactions.logged_at DESC,
          meal_transactions.created_at DESC,
          meal_transactions.id ASC,
          meal_revision_items.position ASC
        LIMIT ?
      `,
      [
        "device-query-plan",
        "2026-04-19T00:00:00.000Z",
        "2026-04-20T00:00:00.000Z",
        "%chicken%",
        11,
      ],
    );

    assertHasIndex(details, ACTIVE_HISTORY_ORDERING_INDEX);
    assertHasIndex(details, REVISION_ITEM_POSITION_INDEX);
    assertNoFullTableScan(details, MEAL_TRANSACTIONS_SCAN);
  });

  it("uses active transaction and revision-item indexes for history trends", () => {
    const details = explainQueryPlan(
      sqlite,
      `
        SELECT
          meal_transactions.id,
          meal_transactions.logged_at,
          meal_revision_items.calories,
          meal_revision_items.protein,
          meal_revision_items.carbs,
          meal_revision_items.fat
        FROM meal_transactions
        INNER JOIN meal_revisions
          ON meal_transactions.current_revision_id = meal_revisions.id
        INNER JOIN meal_revision_items
          ON meal_revision_items.revision_id = meal_revisions.id
        WHERE meal_transactions.device_id = ?
          AND meal_transactions.deleted_at IS NULL
          AND meal_transactions.logged_at >= ?
          AND meal_transactions.logged_at < ?
      `,
      ["device-query-plan", "2026-04-19T00:00:00.000Z", "2026-04-20T00:00:00.000Z"],
    );

    assertHasIndex(details, ACTIVE_HISTORY_ORDERING_INDEX);
    assertHasIndex(details, REVISION_ITEM_POSITION_INDEX);
    assertNoFullTableScan(details, MEAL_TRANSACTIONS_SCAN);
  });
});

function explainQueryPlan(
  sqlite: Database.Database,
  statement: string,
  params: readonly unknown[],
): string[] {
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${statement}`)
    .all(...params)
    .map((row) => (row as QueryPlanRow).detail);
}

function assertHasIndex(details: string[], indexName: string) {
  assert.ok(
    details.some((detail) => detail.includes(indexName)),
    `expected query plan to use ${indexName}, got ${JSON.stringify(details)}`,
  );
}

function assertNoFullTableScan(details: string[], scanPattern: string) {
  assert.ok(
    details.every((detail) => !detail.includes(scanPattern)),
    `expected no ${scanPattern}, got ${JSON.stringify(details)}`,
  );
}

function seedRepresentativeData(sqlite: Database.Database) {
  sqlite.exec(`
    INSERT INTO devices (
      id,
      goal,
      daily_calories,
      daily_protein,
      daily_carbs,
      daily_fat,
      created_at
    ) VALUES (
      'device-query-plan',
      'fat_loss',
      1800,
      120,
      180,
      60,
      '2026-04-19T00:00:00.000Z'
    );

    INSERT INTO assets (
      id,
      device_id,
      storage_key,
      mime_type,
      byte_size,
      created_at
    ) VALUES (
      'asset-query-plan',
      'device-query-plan',
      'meal-images/asset-query-plan.jpg',
      'image/jpeg',
      321,
      '2026-04-19T04:00:00.000Z'
    );

    INSERT INTO meal_transactions (
      id,
      device_id,
      logged_at,
      current_revision_id,
      current_revision_number,
      deleted_at,
      created_at
    ) VALUES
    (
      'tx-active',
      'device-query-plan',
      '2026-04-19T04:00:00.000Z',
      'tx-active:r1',
      1,
      NULL,
      '2026-04-19T04:00:00.000Z'
    ),
    (
      'tx-active-late-create',
      'device-query-plan',
      '2026-04-19T04:00:00.000Z',
      'tx-active-late-create:r1',
      1,
      NULL,
      '2026-04-19T04:30:00.000Z'
    ),
    (
      'tx-deleted',
      'device-query-plan',
      '2026-04-19T05:00:00.000Z',
      'tx-deleted:r2',
      2,
      '2026-04-19T06:00:00.000Z',
      '2026-04-19T05:00:00.000Z'
    );

    INSERT INTO meal_revisions (
      id,
      transaction_id,
      revision_number,
      supersedes_revision_id,
      image_asset_id,
      change_type,
      created_at
    ) VALUES
    (
      'tx-active:r1',
      'tx-active',
      1,
      NULL,
      'asset-query-plan',
      'create',
      '2026-04-19T04:00:00.000Z'
    ),
    (
      'tx-active-late-create:r1',
      'tx-active-late-create',
      1,
      NULL,
      'asset-query-plan',
      'create',
      '2026-04-19T04:30:00.000Z'
    ),
    (
      'tx-deleted:r1',
      'tx-deleted',
      1,
      NULL,
      'asset-query-plan',
      'create',
      '2026-04-19T05:00:00.000Z'
    ),
    (
      'tx-deleted:r2',
      'tx-deleted',
      2,
      'tx-deleted:r1',
      NULL,
      'delete',
      '2026-04-19T06:00:00.000Z'
    );

    INSERT INTO meal_revision_items (
      revision_id,
      position,
      food_name,
      calories,
      protein,
      carbs,
      fat
    ) VALUES
    (
      'tx-active:r1',
      0,
      '雞腿便當',
      620,
      32,
      74,
      20
    ),
    (
      'tx-active-late-create:r1',
      0,
      'Chicken salad',
      460,
      42,
      18,
      21
    ),
    (
      'tx-deleted:r1',
      0,
      '珍珠奶茶',
      430,
      6,
      63,
      14
    );

    INSERT INTO asset_references (
      id,
      asset_id,
      device_id,
      owner_type,
      owner_id,
      created_at
    ) VALUES
    (
      'meal_revision:tx-active:r1:asset-query-plan',
      'asset-query-plan',
      'device-query-plan',
      'meal_revision',
      'tx-active:r1',
      '2026-04-19T04:00:00.000Z'
    ),
    (
      'chat_message:chat-query-plan:asset-query-plan',
      'asset-query-plan',
      'device-query-plan',
      'chat_message',
      'chat-query-plan',
      '2026-04-19T04:00:01.000Z'
    );
  `);
}
