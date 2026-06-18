CREATE TABLE `chat_proposal_action_events` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`action_message_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`proposal_kind` text NOT NULL,
	`proposal_lane` text NOT NULL,
	`action` text NOT NULL,
	`transcript_copy` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`action_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_proposal_action_events_kind_check" CHECK("chat_proposal_action_events"."proposal_kind" in ('goal','meal_numeric','meal_estimate','meal_delete')),
	CONSTRAINT "chat_proposal_action_events_lane_check" CHECK("chat_proposal_action_events"."proposal_lane" in ('goal','meal_mutation')),
	CONSTRAINT "chat_proposal_action_events_action_check" CHECK("chat_proposal_action_events"."action" in ('approve','edit','reject'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_proposal_action_events_action_message_uq` ON `chat_proposal_action_events` (`action_message_id`);--> statement-breakpoint
CREATE INDEX `chat_proposal_action_events_device_action_message_idx` ON `chat_proposal_action_events` (`device_id`,`action_message_id`);--> statement-breakpoint
CREATE INDEX `chat_proposal_action_events_device_assistant_idx` ON `chat_proposal_action_events` (`device_id`,`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `chat_proposal_action_events_device_proposal_idx` ON `chat_proposal_action_events` (`device_id`,`proposal_id`);--> statement-breakpoint
CREATE TABLE `chat_proposal_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`proposal_kind` text NOT NULL,
	`proposal_lane` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`details_json` text NOT NULL,
	`actions_json` text NOT NULL,
	`expires_at` text,
	`lapse_copy` text,
	`superseded_by_kind` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_proposal_cards_kind_check" CHECK("chat_proposal_cards"."proposal_kind" in ('goal','meal_numeric','meal_estimate','meal_delete')),
	CONSTRAINT "chat_proposal_cards_lane_check" CHECK("chat_proposal_cards"."proposal_lane" in ('goal','meal_mutation')),
	CONSTRAINT "chat_proposal_cards_status_check" CHECK("chat_proposal_cards"."status" in ('active','approved','rejected','expired','superseded','stale')),
	CONSTRAINT "chat_proposal_cards_superseded_kind_check" CHECK("chat_proposal_cards"."superseded_by_kind" is null or "chat_proposal_cards"."superseded_by_kind" in ('goal','meal_numeric','meal_estimate','meal_delete'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_proposal_cards_assistant_message_uq` ON `chat_proposal_cards` (`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `chat_proposal_cards_device_assistant_idx` ON `chat_proposal_cards` (`device_id`,`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `chat_proposal_cards_device_proposal_idx` ON `chat_proposal_cards` (`device_id`,`proposal_id`);--> statement-breakpoint
CREATE INDEX `chat_proposal_cards_device_lane_status_idx` ON `chat_proposal_cards` (`device_id`,`proposal_lane`,`status`);