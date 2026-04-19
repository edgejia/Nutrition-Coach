CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_name` text,
	`image_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`goal` text NOT NULL,
	`sex` text,
	`age` integer,
	`height_cm` real,
	`weight_kg` real,
	`activity_level` text,
	`training_frequency` text,
	`allergies` text,
	`goal_clarification` text,
	`body_fat_percent` real,
	`tdee` real,
	`advanced_notes` text,
	`coach_explanation` text,
	`daily_calories` integer NOT NULL,
	`daily_protein` integer NOT NULL,
	`daily_carbs` integer NOT NULL,
	`daily_fat` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`food_name` text NOT NULL,
	`calories` real NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	`image_path` text,
	`logged_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
