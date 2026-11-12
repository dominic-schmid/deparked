// Applying migrations, from a Worker (D1 binding) or from the installer (D1 HTTP API): both are a `SqlRunner`.
//
// Bookkeeping is the `d1_migrations` table, in the exact shape `wrangler d1 migrations apply` uses, so a database
// migrated by Wrangler (local dev, E2E) and one migrated here agree on what has run. It is the one table besides the
// 13 of the schema; its `applied_at` is Wrangler's SQL timestamp, not epoch milliseconds.
//
// Every migration must itself be safe to re-run (IF NOT EXISTS): two installs racing, or a batch that failed half
// way on a runner without transactions, then simply apply it again.
import { migrationFiles } from "./migrations.gen";

/**
 * Runs the statements in order as one batch and returns each statement's rows. None of them has parameters, so
 * the D1 HTTP API can take them as one `sql` string joined with ";".
 */
export type SqlRunner = (statements: readonly string[]) => Promise<Record<string, unknown>[][]>;

export type Migration = { name: string; sql: string; statements: readonly string[] };

export type MigrationResult = { applied: string[]; skipped: string[] };

const BREAKPOINT = "--> statement-breakpoint";
const CREATE_BOOKKEEPING = `CREATE TABLE IF NOT EXISTS "d1_migrations"(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

/** One statement per block between breakpoint lines; comment lines and the trailing semicolon are dropped. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let lines: string[] = [];
  for (const line of [...sql.split("\n"), BREAKPOINT]) {
    if (line.trim() !== BREAKPOINT) {
      if (!line.startsWith("--")) lines.push(line);
      continue;
    }
    const statement = lines.join("\n").trim().replace(/;$/, "");
    if (statement !== "") statements.push(statement);
    lines = [];
  }
  return statements;
}

/** Throws for a name that could break out of the bookkeeping statement. */
export function toMigration(name: string, sql: string): Migration {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`Migration name ${JSON.stringify(name)} must be a plain file name`);
  return { name, sql, statements: splitStatements(sql) };
}

export const migrations: readonly Migration[] = migrationFiles.map(({ name, sql }) => toMigration(name, sql));

export function d1Runner(d1: D1Database): SqlRunner {
  return async (statements) => {
    const results = await d1.batch<Record<string, unknown>>(statements.map((statement) => d1.prepare(statement)));
    return results.map((result) => result.results);
  };
}

/** `list` defaults to the migrations bundled with this code; an install passes the ones its release ships. */
export async function applyMigrations(
  run: SqlRunner,
  list: readonly Migration[] = migrations,
): Promise<MigrationResult> {
  const [, rows = []] = await run([CREATE_BOOKKEEPING, `SELECT name FROM "d1_migrations"`]);
  const done = new Set(rows.map((row) => row.name));
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const migration of list) {
    if (done.has(migration.name)) {
      result.skipped.push(migration.name);
      continue;
    }
    await run([...migration.statements, `INSERT OR IGNORE INTO "d1_migrations" (name) VALUES ('${migration.name}')`]);
    result.applied.push(migration.name);
  }
  return result;
}
