CREATE TABLE `mutation_locks` (
	`owner` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_active_campaign` ON `jobs` (`owner`,`campaign_id`) WHERE "jobs"."status" IN ('starting','queued','in_progress','uncertain');