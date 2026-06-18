import { desc, sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  goal: text("goal").notNull(),
  sex: text("sex"),
  age: integer("age"),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  activityLevel: text("activity_level"),
  trainingFrequency: text("training_frequency"),
  allergies: text("allergies"),
  goalClarification: text("goal_clarification"),
  bodyFatPercent: real("body_fat_percent"),
  tdee: real("tdee"),
  advancedNotes: text("advanced_notes"),
  coachExplanation: text("coach_explanation"),
  dailyCalories: integer("daily_calories").notNull(),
  dailyProtein: integer("daily_protein").notNull(),
  dailyCarbs: integer("daily_carbs").notNull(),
  dailyFat: integer("daily_fat").notNull(),
  createdAt: text("created_at").notNull(),
});

export const meals = sqliteTable("meals", {
  id: text("id").primaryKey(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  foodName: text("food_name").notNull(),
  calories: real("calories").notNull(),
  protein: real("protein").notNull(),
  carbs: real("carbs").notNull(),
  fat: real("fat").notNull(),
  imagePath: text("image_path"),
  loggedAt: text("logged_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolName: text("tool_name"),
  imagePath: text("image_path"),
  createdAt: text("created_at").notNull(),
  status: text("status").notNull().default("complete"),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: text("created_at").notNull(),
});

export const mealTransactions = sqliteTable(
  "meal_transactions",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    loggedAt: text("logged_at").notNull(),
    mealPeriod: text("meal_period", { enum: ["breakfast", "lunch", "dinner", "late_night"] }),
    currentRevisionId: text("current_revision_id").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("meal_tx_active_device_logged_at_idx")
      .on(table.deviceId, table.loggedAt)
      .where(sql`${table.deletedAt} is null`),
    index("meal_tx_active_device_logged_created_id_idx")
      .on(table.deviceId, desc(table.loggedAt), desc(table.createdAt), table.id)
      .where(sql`${table.deletedAt} is null`),
    index("meal_tx_device_id_id_idx").on(table.deviceId, table.id),
    check(
      "meal_tx_meal_period_check",
      sql`${table.mealPeriod} in ('breakfast','lunch','dinner','late_night')`,
    ),
  ],
);

export const mealRevisions = sqliteTable(
  "meal_revisions",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => mealTransactions.id),
    revisionNumber: integer("revision_number").notNull(),
    supersedesRevisionId: text("supersedes_revision_id"),
    imageAssetId: text("image_asset_id").references(() => assets.id),
    changeType: text("change_type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("meal_rev_transaction_number_uq").on(table.transactionId, table.revisionNumber),
  ],
);

export const chatMealReceipts = sqliteTable(
  "chat_meal_receipts",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => chatMessages.id),
    toolMessageId: text("tool_message_id").references(() => chatMessages.id),
    mealTransactionId: text("meal_transaction_id")
      .notNull()
      .references(() => mealTransactions.id),
    mealRevisionId: text("meal_revision_id")
      .notNull()
      .references(() => mealRevisions.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("chat_meal_receipts_assistant_message_uq").on(table.assistantMessageId),
    index("chat_meal_receipts_device_assistant_idx").on(table.deviceId, table.assistantMessageId),
    index("chat_meal_receipts_device_meal_idx").on(
      table.deviceId,
      table.mealTransactionId,
      table.mealRevisionId,
    ),
  ],
);

export const chatMutationOutcomes = sqliteTable(
  "chat_mutation_outcomes",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => chatMessages.id),
    toolMessageId: text("tool_message_id").references(() => chatMessages.id),
    action: text("action").notNull(),
    affectedDate: text("affected_date").notNull(),
    foodName: text("food_name"),
    calories: real("calories"),
    protein: real("protein"),
    carbs: real("carbs"),
    fat: real("fat"),
    goalCalories: integer("goal_calories"),
    goalProtein: integer("goal_protein"),
    goalCarbs: integer("goal_carbs"),
    goalFat: integer("goal_fat"),
    updatedGoalFields: text("updated_goal_fields"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "chat_mutation_outcomes_action_check",
      sql`${table.action} in ('log_food','update_meal','delete_meal','update_goals')`,
    ),
    uniqueIndex("chat_mutation_outcomes_assistant_message_uq").on(table.assistantMessageId),
    index("chat_mutation_outcomes_device_assistant_idx").on(
      table.deviceId,
      table.assistantMessageId,
    ),
    index("chat_mutation_outcomes_device_action_date_idx").on(
      table.deviceId,
      table.action,
      table.affectedDate,
    ),
  ],
);

export const chatProposalCards = sqliteTable(
  "chat_proposal_cards",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => chatMessages.id),
    proposalId: text("proposal_id").notNull(),
    proposalKind: text("proposal_kind").notNull(),
    proposalLane: text("proposal_lane").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    detailsJson: text("details_json").notNull(),
    actionsJson: text("actions_json").notNull(),
    expiresAt: text("expires_at"),
    lapseCopy: text("lapse_copy"),
    supersededByKind: text("superseded_by_kind"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "chat_proposal_cards_kind_check",
      sql`${table.proposalKind} in ('goal','meal_numeric','meal_estimate','meal_delete')`,
    ),
    check(
      "chat_proposal_cards_lane_check",
      sql`${table.proposalLane} in ('goal','meal_mutation')`,
    ),
    check(
      "chat_proposal_cards_status_check",
      sql`${table.status} in ('active','approved','rejected','expired','superseded','stale')`,
    ),
    check(
      "chat_proposal_cards_superseded_kind_check",
      sql`${table.supersededByKind} is null or ${table.supersededByKind} in ('goal','meal_numeric','meal_estimate','meal_delete')`,
    ),
    uniqueIndex("chat_proposal_cards_assistant_message_uq").on(table.assistantMessageId),
    index("chat_proposal_cards_device_assistant_idx").on(table.deviceId, table.assistantMessageId),
    index("chat_proposal_cards_device_proposal_idx").on(table.deviceId, table.proposalId),
    index("chat_proposal_cards_device_lane_status_idx").on(
      table.deviceId,
      table.proposalLane,
      table.status,
    ),
  ],
);

export const chatProposalActionEvents = sqliteTable(
  "chat_proposal_action_events",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    actionMessageId: text("action_message_id")
      .notNull()
      .references(() => chatMessages.id),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => chatMessages.id),
    proposalId: text("proposal_id").notNull(),
    proposalKind: text("proposal_kind").notNull(),
    proposalLane: text("proposal_lane").notNull(),
    action: text("action").notNull(),
    transcriptCopy: text("transcript_copy").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "chat_proposal_action_events_kind_check",
      sql`${table.proposalKind} in ('goal','meal_numeric','meal_estimate','meal_delete')`,
    ),
    check(
      "chat_proposal_action_events_lane_check",
      sql`${table.proposalLane} in ('goal','meal_mutation')`,
    ),
    check(
      "chat_proposal_action_events_action_check",
      sql`${table.action} in ('approve','edit','reject')`,
    ),
    uniqueIndex("chat_proposal_action_events_action_message_uq").on(table.actionMessageId),
    index("chat_proposal_action_events_device_action_message_idx").on(
      table.deviceId,
      table.actionMessageId,
    ),
    index("chat_proposal_action_events_device_assistant_idx").on(
      table.deviceId,
      table.assistantMessageId,
    ),
    index("chat_proposal_action_events_device_proposal_idx").on(table.deviceId, table.proposalId),
  ],
);

export const mealRevisionItems = sqliteTable(
  "meal_revision_items",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => mealRevisions.id),
    position: integer("position").notNull(),
    foodName: text("food_name").notNull(),
    calories: real("calories").notNull(),
    protein: real("protein").notNull(),
    carbs: real("carbs").notNull(),
    fat: real("fat").notNull(),
  },
  (table) => [
    uniqueIndex("meal_rev_items_revision_position_uq").on(table.revisionId, table.position),
  ],
);

export const assetReferences = sqliteTable(
  "asset_references",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("asset_refs_owner_uq").on(table.ownerType, table.ownerId, table.assetId),
    index("asset_refs_asset_id_idx").on(table.assetId),
  ],
);

export const turnStates = sqliteTable(
  "turn_states",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    sessionId: text("session_id").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("turn_states_device_session_kind_uq").on(table.deviceId, table.sessionId, table.kind),
    index("turn_states_device_expires_idx").on(table.deviceId, table.expiresAt),
  ],
);
