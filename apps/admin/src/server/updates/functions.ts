import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { HostingError } from "@deparked/hosting";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { stateSchema } from "../domain-setup/steps";
import { hub } from "../hub/connect";
import { requireSession } from "../require-session";
import { fetchLatestRelease, releaseLocation } from "./latest";
import * as updates from "./updates";

type Failure = { ok: false; credentialsRejected: boolean; message: string };
type Result<T> = { ok: true; value: T } | Failure;

async function guarded<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (!(error instanceof HostingError)) throw error;
    return { ok: false, credentialsRejected: error.credentialsRejected, message: error.message };
  }
}

const vars = () => env as unknown as Record<string, unknown>;

/** The release this isolate runs: the binding the install and every update set. */
function running(): string | null {
  const value = vars().DEPARKED_RELEASE;
  return typeof value === "string" && value !== "" ? value : null;
}

async function view(force: boolean): Promise<updates.UpdatesView> {
  const db = createDb(env.DB);
  const setup = await hub();
  const status = await setup.releaseStatus();
  const now = Date.now();
  const { latest, checkError } = await updates.refreshLatest({
    db,
    now,
    force,
    fetchLatest: () => fetchLatestRelease(releaseLocation(vars()).latest),
  });
  return {
    status,
    running: running(),
    latest,
    checkError,
    available: updates.isAvailable(status, latest),
    steps: setup.releaseStepTitles(),
    now,
  };
}

/** What is installed, what is newer and what is running. Asks GitHub at most once an hour. */
export const getUpdates = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession();
  return guarded(() => view(false));
});

/** "Check again": asks GitHub now. Only reads Cloudflare-side; stores what it found. */
export const checkForUpdates = createServerFn({ method: "POST" }).handler(async () => {
  await requireSession();
  return guarded(() => view(true));
});

/** What updating to the pin changes, step by step. Downloads and checks release.json only. */
export const previewUpdate = createServerFn({ method: "POST" })
  .validator(updates.pinSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => (await hub()).previewUpdate(data));
  });

/** Starts the update to the pin the owner confirmed: it must be the newest release this admin found. */
export const startUpdate = createServerFn({ method: "POST" })
  .validator(updates.pinSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => updates.startUpdate({ db: createDb(env.DB), hub: await hub(), pin: data }));
  });

export const startRollback = createServerFn({ method: "POST" })
  .validator(z.object({ confirm: z.literal(true) }))
  .handler(async () => {
    await requireSession();
    return guarded(async () => (await hub()).startRollback());
  });

/** One step of the running update or rollback per request. The order is the server's. */
export const releaseStep = createServerFn({ method: "POST" })
  .validator(z.object({ state: stateSchema }))
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => (await hub()).releaseStep(data.state));
  });

/** The end: only once the new admin answers this request and every page was published again by it. */
export const finishRelease = createServerFn({ method: "POST" }).handler(async () => {
  await requireSession();
  return guarded(async () => {
    const setup = await hub();
    const { change } = await setup.releaseStatus();
    const blocker = await updates.finishBlocker({ db: createDb(env.DB), change, running: running() });
    if (blocker !== null) return { ok: false as const, message: blocker };
    return setup.finishRelease();
  });
});
