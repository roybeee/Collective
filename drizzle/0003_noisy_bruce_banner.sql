CREATE INDEX `idx_auth_rate_limits_window` ON `auth_rate_limits` (`window_start`);--> statement-breakpoint
CREATE INDEX `idx_auth_tokens_expiry` ON `auth_tokens` (`expires_at`);