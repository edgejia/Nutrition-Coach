DELETE FROM `turn_states`;--> statement-breakpoint
DROP INDEX `turn_states_device_kind_uq`;--> statement-breakpoint
ALTER TABLE `turn_states` ADD `session_id` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `turn_states_device_session_kind_uq` ON `turn_states` (`device_id`,`session_id`,`kind`);
