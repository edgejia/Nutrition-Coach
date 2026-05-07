CREATE TABLE `chat_meal_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`tool_message_id` text,
	`meal_transaction_id` text NOT NULL,
	`meal_revision_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meal_transaction_id`) REFERENCES `meal_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meal_revision_id`) REFERENCES `meal_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_meal_receipts_assistant_message_uq` ON `chat_meal_receipts` (`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `chat_meal_receipts_device_assistant_idx` ON `chat_meal_receipts` (`device_id`,`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `chat_meal_receipts_device_meal_idx` ON `chat_meal_receipts` (`device_id`,`meal_transaction_id`,`meal_revision_id`);