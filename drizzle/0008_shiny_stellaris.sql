CREATE TABLE `chat_mutation_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`tool_message_id` text,
	`action` text NOT NULL,
	`affected_date` text NOT NULL,
	`food_name` text,
	`calories` real,
	`protein` real,
	`carbs` real,
	`fat` real,
	`goal_calories` integer,
	`goal_protein` integer,
	`goal_carbs` integer,
	`goal_fat` integer,
	`updated_goal_fields` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_mutation_outcomes_action_check" CHECK("chat_mutation_outcomes"."action" in ('log_food','update_meal','delete_meal','update_goals'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_mutation_outcomes_assistant_message_uq` ON `chat_mutation_outcomes` (`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `chat_mutation_outcomes_device_assistant_idx` ON `chat_mutation_outcomes` (`device_id`,`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `chat_mutation_outcomes_device_action_date_idx` ON `chat_mutation_outcomes` (`device_id`,`action`,`affected_date`);