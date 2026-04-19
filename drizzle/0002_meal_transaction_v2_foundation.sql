CREATE TABLE `meal_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`logged_at` text NOT NULL,
	`current_revision_id` text NOT NULL,
	`current_revision_number` integer NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meal_tx_active_device_logged_at_idx` ON `meal_transactions` (`device_id`,`logged_at`) WHERE "meal_transactions"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX `meal_tx_device_id_id_idx` ON `meal_transactions` (`device_id`,`id`);
--> statement-breakpoint
CREATE TABLE `meal_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`supersedes_revision_id` text,
	`image_asset_id` text,
	`change_type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `meal_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`image_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_rev_transaction_number_uq` ON `meal_revisions` (`transaction_id`,`revision_number`);
--> statement-breakpoint
CREATE TABLE `meal_revision_items` (
	`revision_id` text NOT NULL,
	`position` integer NOT NULL,
	`food_name` text NOT NULL,
	`calories` real NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `meal_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_rev_items_revision_position_uq` ON `meal_revision_items` (`revision_id`,`position`);
--> statement-breakpoint
CREATE TABLE `asset_references` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`device_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_refs_owner_uq` ON `asset_references` (`owner_type`,`owner_id`,`asset_id`);
--> statement-breakpoint
CREATE INDEX `asset_refs_asset_id_idx` ON `asset_references` (`asset_id`);
--> statement-breakpoint
INSERT INTO `meal_transactions` (
	`id`,
	`device_id`,
	`logged_at`,
	`current_revision_id`,
	`current_revision_number`,
	`deleted_at`,
	`created_at`
)
SELECT
	`id`,
	`device_id`,
	`logged_at`,
	`id` || ':r1',
	1,
	NULL,
	`logged_at`
FROM `meals`;
--> statement-breakpoint
INSERT INTO `meal_revisions` (
	`id`,
	`transaction_id`,
	`revision_number`,
	`supersedes_revision_id`,
	`image_asset_id`,
	`change_type`,
	`created_at`
)
SELECT
	`id` || ':r1',
	`id`,
	1,
	NULL,
	CASE
		WHEN `image_path` LIKE 'asset:%' THEN substr(`image_path`, 7)
		ELSE NULL
	END,
	'backfill',
	`logged_at`
FROM `meals`;
--> statement-breakpoint
INSERT INTO `meal_revision_items` (
	`revision_id`,
	`position`,
	`food_name`,
	`calories`,
	`protein`,
	`carbs`,
	`fat`
)
SELECT
	`id` || ':r1',
	0,
	`food_name`,
	`calories`,
	`protein`,
	`carbs`,
	`fat`
FROM `meals`;
--> statement-breakpoint
INSERT INTO `asset_references` (
	`id`,
	`asset_id`,
	`device_id`,
	`owner_type`,
	`owner_id`,
	`created_at`
)
SELECT
	'chat_message:' || `id` || ':' || substr(`image_path`, 7),
	substr(`image_path`, 7),
	`device_id`,
	'chat_message',
	`id`,
	`created_at`
FROM `chat_messages`
WHERE `image_path` LIKE 'asset:%';
--> statement-breakpoint
INSERT INTO `asset_references` (
	`id`,
	`asset_id`,
	`device_id`,
	`owner_type`,
	`owner_id`,
	`created_at`
)
SELECT
	'meal_revision:' || `id` || ':r1:' || substr(`image_path`, 7),
	substr(`image_path`, 7),
	`device_id`,
	'meal_revision',
	`id` || ':r1',
	`logged_at`
FROM `meals`
WHERE `image_path` LIKE 'asset:%';
