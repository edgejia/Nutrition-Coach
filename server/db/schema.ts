import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  goal: text("goal").notNull(),
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
