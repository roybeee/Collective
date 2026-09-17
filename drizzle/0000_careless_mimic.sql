CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`campaign_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`model` text NOT NULL,
	`campaign_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`error` text,
	`tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_owner_campaign` ON `jobs` (`owner`,`campaign_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_records_owner_kind` ON `records` (`owner`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_records_owner_parent` ON `records` (`owner`,`parent_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`secret` text,
	`model` text DEFAULT 'gpt-6-astra' NOT NULL,
	`updated_at` text NOT NULL
);
