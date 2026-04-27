CREATE INDEX `meal_tx_active_device_logged_created_id_idx` ON `meal_transactions` (`device_id`,`logged_at` DESC,`created_at` DESC,`id`) WHERE "meal_transactions"."deleted_at" is null;
