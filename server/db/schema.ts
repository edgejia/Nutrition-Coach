import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    currentRevisionId: text("current_revision_id").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("meal_tx_active_device_logged_at_idx")
      .on(table.deviceId, table.loggedAt)
      .where(sql`${table.deletedAt} is null`),
    index("meal_tx_device_id_id_idx").on(table.deviceId, table.id),
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
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("turn_states_device_kind_uq").on(table.deviceId, table.kind),
    index("turn_states_device_expires_idx").on(table.deviceId, table.expiresAt),
  ],
);
