import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type InstallState, installState, type Workspace, workspace } from "../schema";

const ROW = 1;

export function getWorkspace(db: Db): Promise<Workspace | undefined> {
  return db.select().from(workspace).where(eq(workspace.id, ROW)).get();
}

/** Creates the workspace row if it is missing; never overwrites an existing one. */
export async function initWorkspace(db: Db, input: { cfAccountId?: string; now: number }): Promise<Workspace> {
  const [, rows] = await db.batch([
    db
      .insert(workspace)
      .values({ id: ROW, cfAccountId: input.cfAccountId ?? null, createdAt: input.now, updatedAt: input.now })
      .onConflictDoNothing(),
    db.select().from(workspace).where(eq(workspace.id, ROW)),
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error("workspace row missing after init");
  return row;
}

export type WorkspacePatch = Partial<
  Pick<Workspace, "cfAccountId" | "installedRelease" | "latestRelease" | "releaseCheckedAt">
>;

export async function updateWorkspace(db: Db, input: { patch: WorkspacePatch; now: number }): Promise<void> {
  await db
    .update(workspace)
    .set({ ...input.patch, updatedAt: input.now })
    .where(eq(workspace.id, ROW));
}

/**
 * Stores the hash of a new one-time setup secret (install and recovery). False when there is no workspace row.
 * Hash a high-entropy secret (SHA-256 is enough); the plain secret never reaches the database.
 */
export async function setSetupSecret(
  db: Db,
  input: { secretHash: string; expiresAt: number; now: number },
): Promise<boolean> {
  const rows = await db
    .update(workspace)
    .set({ setupSecretHash: input.secretHash, setupSecretExpiresAt: input.expiresAt, updatedAt: input.now })
    .where(eq(workspace.id, ROW))
    .returning({ id: workspace.id });
  return rows.length === 1;
}

/**
 * Setup: checks the one-time secret, stores the password and kills the secret in ONE statement, so the secret
 * cannot be used twice even by concurrent requests. Returns the new session version, or null when the secret is
 * wrong, expired or already used. Every earlier session ends.
 */
export async function consumeSetupSecret(
  db: Db,
  input: {
    secretHash: string;
    passwordHash: string;
    passwordSalt: string;
    passwordIterations: number;
    now: number;
  },
): Promise<number | null> {
  const rows = await db
    .update(workspace)
    .set({
      passwordHash: input.passwordHash,
      passwordSalt: input.passwordSalt,
      passwordIterations: input.passwordIterations,
      setupSecretHash: null,
      setupSecretExpiresAt: null,
      setupDoneAt: input.now,
      sessionVersion: sql`${workspace.sessionVersion} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(workspace.id, ROW),
        eq(workspace.setupSecretHash, input.secretHash),
        gt(workspace.setupSecretExpiresAt, input.now),
      ),
    )
    .returning({ sessionVersion: workspace.sessionVersion });
  return rows[0]?.sessionVersion ?? null;
}

/** Change password: bumps the session version, which logs out every existing session. Returns the new version. */
export async function setPassword(
  db: Db,
  input: { passwordHash: string; passwordSalt: string; passwordIterations: number; now: number },
): Promise<number | null> {
  const rows = await db
    .update(workspace)
    .set({
      passwordHash: input.passwordHash,
      passwordSalt: input.passwordSalt,
      passwordIterations: input.passwordIterations,
      sessionVersion: sql`${workspace.sessionVersion} + 1`,
      updatedAt: input.now,
    })
    .where(eq(workspace.id, ROW))
    .returning({ sessionVersion: workspace.sessionVersion });
  return rows[0]?.sessionVersion ?? null;
}

/** Log out everywhere. Returns the new session version. */
export async function bumpSessionVersion(db: Db, now: number): Promise<number | null> {
  const rows = await db
    .update(workspace)
    .set({ sessionVersion: sql`${workspace.sessionVersion} + 1`, updatedAt: now })
    .where(eq(workspace.id, ROW))
    .returning({ sessionVersion: workspace.sessionVersion });
  return rows[0]?.sessionVersion ?? null;
}

export function getInstallState(db: Db): Promise<InstallState | undefined> {
  return db.select().from(installState).where(eq(installState.id, ROW)).get();
}

/** Creates the install row (step `migrate`, status `pending`) if it is missing. */
export async function initInstallState(db: Db): Promise<InstallState> {
  const [, rows] = await db.batch([
    db.insert(installState).values({ id: ROW }).onConflictDoNothing(),
    db.select().from(installState).where(eq(installState.id, ROW)),
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error("install_state row missing after init");
  return row;
}

export type InstallStatePatch = Partial<Omit<InstallState, "id">>;

export async function updateInstallState(db: Db, patch: InstallStatePatch): Promise<InstallState | undefined> {
  const rows = await db.update(installState).set(patch).where(eq(installState.id, ROW)).returning();
  return rows[0];
}
