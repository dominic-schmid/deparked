import { env } from "cloudflare:workers";
import { createDb, type Db, getWorkspace } from "@deparked/db";
import { HostingError } from "@deparked/hosting";
import { createCloudflareDomainSetup } from "@deparked/hosting-cloudflare";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hostingConnection } from "../hosting-env";
import { publishContext } from "../publish/functions";
import { requireSession } from "../require-session";
import * as steps from "./steps";

/** A refusal the screen shows as it is. `credentialsRejected`: point the owner at Settings, Replace token. */
export type SetupFailure = { ok: false; credentialsRejected: boolean; message: string };
type Result<T> = { ok: true; value: T } | SetupFailure;

async function guarded<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (!(error instanceof HostingError)) throw error;
    return { ok: false, credentialsRejected: error.credentialsRejected, message: error.message };
  }
}

function setupFor(db: Db, accountId: string | null, publish: steps.SetupDeps["publish"]) {
  const vars = env as unknown as Record<string, unknown>;
  const connection = hostingConnection(vars, accountId);
  if (connection.token === "" || connection.accountId === "unconfigured") {
    throw new HostingError(
      "credentials-rejected",
      "No Cloudflare token is stored for this install, so domains cannot be set up.",
    );
  }
  return createCloudflareDomainSetup({
    token: connection.token,
    accountId: connection.accountId,
    ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
    db,
    now: Date.now,
    publishPlaceholder: steps.placeholderPublisher(publish),
  });
}

async function deps(): Promise<steps.SetupDeps> {
  const db = createDb(env.DB);
  const workspace = await getWorkspace(db);
  const publish = await publishContext();
  return { db, publish, setup: setupFor(db, workspace?.cfAccountId ?? null, publish) };
}

const host = steps.domainName;
const confirmations = steps.confirmationsSchema;
const state = steps.stateSchema;

/** Domains of the Cloudflare account that Deparked does not manage yet, a page at a time. */
export const listAccountDomains = createServerFn({ method: "GET" })
  .validator(z.object({ search: z.string().max(253), page: z.number().int().min(1).max(10_000) }))
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => steps.listAccountDomains(await deps(), data));
  });

/** What attaching the domain would do, in plain words. Only reads. */
export const previewDomain = createServerFn({ method: "GET" })
  .validator(z.object({ host, confirmations }))
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => steps.previewAttach(await deps(), data));
  });

/** The step titles of a change, and for Turn off and Remove what they delete or restore. No Cloudflare request. */
export const describeChange = createServerFn({ method: "GET" })
  .validator(z.object({ host, change: z.enum(["attach", "turn-off", "remove"]) }))
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => {
      const setup = await deps();
      const list = steps.listSteps(setup, data.change, data.host);
      const removal = data.change === "attach" ? null : await setup.setup.describeRemoval(data.host);
      return { steps: list, removal };
    });
  });

/** One step of attaching or turning on a domain. */
export const attachStep = createServerFn({ method: "POST" })
  .validator(z.object({ host, confirmations, state }))
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => steps.attachStep(await deps(), data));
  });

/** One step of Turn off or Remove. */
export const takeOffStep = createServerFn({ method: "POST" })
  .validator(z.object({ host, change: z.enum(["turn-off", "remove"]), state }))
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => steps.takeOffStep(await deps(), data));
  });
