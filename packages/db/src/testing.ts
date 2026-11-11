/// <reference types="node" />
// A D1 binding backed by an in-memory SQLite (`node:sqlite`), for tests in Node. It implements what Drizzle and
// `applyMigrations` use: prepare/bind, all/run/raw/first and an atomic batch. Not part of the Worker bundle:
// import it as `@deparked/db/testing`, from test files only.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createDb, type Db } from "./client";
import { applyMigrations, d1Runner } from "./migrate";

export type ExecutedStatement = { sql: string; params: readonly unknown[] };

export type TestD1 = {
  d1: D1Database;
  sqlite: DatabaseSync;
  /** Every statement run through `d1`, in order. */
  executed: ExecutedStatement[];
};

class TestStatement {
  readonly #sqlite: DatabaseSync;
  readonly #executed: ExecutedStatement[];
  readonly #sql: string;
  readonly #params: readonly unknown[];

  constructor(sqlite: DatabaseSync, executed: ExecutedStatement[], sql: string, params: readonly unknown[] = []) {
    this.#sqlite = sqlite;
    this.#executed = executed;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.#sqlite, this.#executed, this.#sql, params);
  }

  execute(arrays: boolean): unknown[] {
    this.#executed.push({ sql: this.#sql, params: this.#params });
    const statement = this.#sqlite.prepare(this.#sql);
    statement.setReturnArrays(arrays);
    return statement.all(...(this.#params as SQLInputValue[]));
  }

  result() {
    const results = this.execute(false);
    const counters = this.#sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get();
    return { results, success: true as const, meta: { ...counters } };
  }

  async all() {
    return this.result();
  }

  async run() {
    return this.result();
  }

  async raw() {
    return this.execute(true);
  }

  async first() {
    return this.execute(false)[0] ?? null;
  }
}

export function createTestD1(): TestD1 {
  const sqlite = new DatabaseSync(":memory:");
  const executed: ExecutedStatement[] = [];
  const d1 = {
    prepare: (sql: string) => new TestStatement(sqlite, executed, sql),
    async batch(statements: TestStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.result());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, sqlite, executed };
}

/** A migrated, empty database with its Drizzle handle. */
export async function createTestDb(): Promise<TestD1 & { db: Db }> {
  const test = createTestD1();
  await applyMigrations(d1Runner(test.d1));
  test.executed.length = 0;
  return { ...test, db: createDb(test.d1) };
}
