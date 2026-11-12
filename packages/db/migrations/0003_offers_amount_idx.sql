-- The inbox's "Highest offer first": the same three index ranges as newest first, on amount_minor.
CREATE INDEX IF NOT EXISTS "offers_host_amount_minor_idx" ON "offers" ("host","amount_minor");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_status_amount_minor_idx" ON "offers" ("status","amount_minor");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_amount_minor_idx" ON "offers" ("amount_minor");
