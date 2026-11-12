-- Update and Rollback from the admin: the installed release's pin, the last check and the change in progress.
-- Forward-only, like every migration: a rollback keeps this table, and older code never reads it.
CREATE TABLE IF NOT EXISTS "release_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"installed_sha256" text,
	"latest_sha256" text,
	"change_kind" text,
	"change_version" text,
	"change_sha256" text,
	"change_started_at" integer,
	"change_verified_at" integer,
	"change_finished_at" integer,
	"previous_version" text,
	"previous_sha256" text,
	CONSTRAINT "release_state_single_row" CHECK("release_state"."id" = 1),
	CONSTRAINT "release_state_change_kind" CHECK("release_state"."change_kind" in ('update', 'rollback'))
);
