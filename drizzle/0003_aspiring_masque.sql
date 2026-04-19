CREATE TABLE `turn_states` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_states_device_kind_uq` ON `turn_states` (`device_id`,`kind`);--> statement-breakpoint
CREATE INDEX `turn_states_device_expires_idx` ON `turn_states` (`device_id`,`expires_at`);