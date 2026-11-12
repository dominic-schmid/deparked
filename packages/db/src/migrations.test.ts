/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { expect, test } from "vitest";
import { applyMigrations, d1Runner, migrations, splitStatements } from "./migrate";
import * as schema from "./schema";
import { createTestD1, type TestD1 } from "./testing";

const TABLES = [
  "config",
  "config_history",
  "deployments",
  "domains",
  "install_state",
  "ledger",
  "notify_addresses",
  "offers",
  "publish_lock",
  "rate_limits",
  "release_state",
  "site_files",
  "turnstile_widgets",
  "workspace",
];

type SchemaObject = { type: string; name: string; table: string; sql: string | null };

/** Tables and indexes as SQLite stores them, without the bookkeeping table and SQLite's own objects. */
function dumpSchema({ sqlite }: TestD1): SchemaObject[] {
  return sqlite
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
    .all()
    .filter((row) => row.tbl_name !== "d1_migrations" && row.tbl_name !== "sqlite_sequence")
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      table: String(row.tbl_name),
      sql:
        row.sql === null
          ? null
          : String(row.sql)
              .replaceAll("`", '"')
              .replace(/ IF NOT EXISTS/g, "")
              .replace(/\s+/g, " "),
    }));
}

test("the embedded migrations are the files in migrations/", () => {
  const directory = join(import.meta.dirname, "../migrations");
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(directory, name), "utf8") }));
  // Stale? Run `pnpm --filter @deparked/db embed-migrations`.
  expect(migrations.map(({ name, sql }) => ({ name, sql }))).toEqual(files);
});

test("every statement is IF NOT EXISTS", () => {
  const statements = migrations.flatMap((migration) => migration.statements);
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) expect(statement).toMatch(/^CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS /);
});

test("splitStatements drops comments, breakpoints and trailing semicolons", () => {
  const sql = "-- header\nCREATE TABLE a (x);\n--> statement-breakpoint\nCREATE INDEX b ON a (x);\n";
  expect(splitStatements(sql)).toEqual(["CREATE TABLE a (x)", "CREATE INDEX b ON a (x)"]);
});

test("the migrations create exactly the 14 tables", async () => {
  const test = createTestD1();
  await applyMigrations(d1Runner(test.d1));
  const tables = dumpSchema(test)
    .filter((object) => object.type === "table")
    .map((object) => object.name);
  expect(tables).toEqual(TABLES);
});

test("applyMigrations applies once, then skips", async () => {
  const test = createTestD1();
  const names = migrations.map((migration) => migration.name);
  expect(await applyMigrations(d1Runner(test.d1))).toEqual({ applied: names, skipped: [] });
  const first = dumpSchema(test);
  expect(await applyMigrations(d1Runner(test.d1))).toEqual({ applied: [], skipped: names });
  expect(dumpSchema(test)).toEqual(first);
  expect(test.sqlite.prepare("SELECT name FROM d1_migrations").all()).toEqual(names.map((name) => ({ name })));
});

test("the SQL itself runs twice without error or change, with no bookkeeping", async () => {
  const test = createTestD1();
  const run = d1Runner(test.d1);
  const statements = migrations.flatMap((migration) => migration.statements);
  await run(statements);
  const first = dumpSchema(test);
  await run(statements);
  expect(dumpSchema(test)).toEqual(first);
});

test("a failing batch leaves nothing behind", async () => {
  const test = createTestD1();
  await expect(d1Runner(test.d1)(["CREATE TABLE a (x)", "CREATE TABLE a (x)"])).rejects.toThrow();
  expect(dumpSchema(test)).toEqual([]);
});

// Compares what SQLite stores after the migrations with what it stores after the DDL drizzle-kit generates from
// schema.ts: tables, columns, defaults, keys, foreign keys, CHECKs and indexes. On a mismatch, change both
// schema.ts and the migration. (A later ALTER TABLE migration will need a structural comparison instead.)
test("the Drizzle schema and the SQL migrations describe the same database", async () => {
  const migrated = createTestD1();
  await applyMigrations(d1Runner(migrated.d1));

  const generated = createTestD1();
  const empty = await generateSQLiteDrizzleJson({});
  const current = await generateSQLiteDrizzleJson(schema);
  await d1Runner(generated.d1)(await generateSQLiteMigration(empty, current));

  expect(dumpSchema(migrated)).toEqual(dumpSchema(generated));
});

test("the constraints hold", async () => {
  const { sqlite, d1 } = createTestD1();
  await applyMigrations(d1Runner(d1));
  const run = (sql: string) => () => sqlite.exec(sql);

  expect(run("INSERT INTO workspace (id, created_at, updated_at) VALUES (2, 0, 0)")).toThrow(/CHECK/);
  expect(run("INSERT INTO install_state (id) VALUES (2)")).toThrow(/CHECK/);
  expect(run("INSERT INTO install_state (id, step) VALUES (1, 'nope')")).toThrow(/CHECK/);
  expect(
    run("INSERT INTO domains (host, zone_id, status, created_at, updated_at) VALUES ('a', 'z', 'nope', 0, 0)"),
  ).toThrow(/CHECK/);
  expect(
    run("INSERT INTO config (host, draft_json, draft_schema_version, updated_at) VALUES ('missing', '{}', 1, 0)"),
  ).toThrow(/FOREIGN KEY/);
  expect(run("INSERT INTO publish_lock (id, deployment_id, expires_at) VALUES (1, 99, 0)")).toThrow(/FOREIGN KEY/);
  expect(
    run(
      "INSERT INTO turnstile_widgets (sitekey, name, hostname_count, secret_name, created_at) VALUES ('k', 'n', 11, 's', 0)",
    ),
  ).toThrow(/CHECK/);
});
