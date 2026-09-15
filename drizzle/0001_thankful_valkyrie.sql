CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `salon_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`epoch` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `salon_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`epoch` text NOT NULL,
	`expires_at` integer NOT NULL
);
