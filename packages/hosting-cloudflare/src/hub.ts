import { CloudflareApiError, type CloudflareClient, createCloudflareClient, type FetchLike } from "@deparked/cf";
import { type Db, listDomains } from "@deparked/db";
import type { HubSetup, SetupEffect, TokenHealth } from "@deparked/hosting";
import {
  checkTokenPermissions,
  DEFAULT_WORKERS,
  describeRemoval,
  type ProvisionContext,
  planUninstall,
  runNextStep,
  UNINSTALL_LEAVES,
  type WorkerNames,
} from "@deparked/provision";
import { cloudflare } from "./errors";

export interface CloudflareHubOptions {
  /** The stored API token. Never logged; errors are redacted by the client. */
  token: string;
  accountId: string;
  /** Defaults to Cloudflare's API. The E2E harness points this at the mock server. */
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  db: Db;
  now: () => number;
  workers?: WorkerNames;
}

/** The name of the admin Worker's secret that holds the API token. */
const TOKEN_SECRET = "CF_API_TOKEN";

const NOT_ACCEPTED =
  "Cloudflare does not accept this token. Copy it again from Cloudflare's page (it is shown only once: create a new one if you closed it).";
const FOREIGN =
  "This token belongs to another Cloudflare account. Create it while logged in to the account Deparked is installed in.";

const refused = (error: unknown) =>
  error instanceof CloudflareApiError && (error.status === 400 || error.status === 401 || error.status === 403);

async function health(cf: CloudflareClient): Promise<TokenHealth> {
  try {
    const status = await cf.tokens.verify();
    if (status.status !== "active") return { state: "rejected", missing: [], unchecked: [] };
    const { missing, unchecked } = await checkTokenPermissions(cf);
    const strip = ({ label, why }: { label: string; why: string }) => ({ label, why });
    return {
      state: missing.length === 0 ? "ok" : "incomplete",
      missing: missing.map(strip),
      unchecked: unchecked.map(strip),
    };
  } catch (error) {
    if (refused(error)) return { state: "rejected", missing: [], unchecked: [] };
    throw error;
  }
}

/** The stored token and Uninstall, on `@deparked/provision`. Build one per request. */
export function createCloudflareHubSetup(options: CloudflareHubOptions): HubSetup {
  const client = (token: string, accountId = options.accountId) =>
    createCloudflareClient({
      token,
      accountId,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const cf = client(options.token);
  const ctx: ProvisionContext = {
    cf,
    db: options.db,
    now: options.now,
    ...(options.workers === undefined ? {} : { workers: options.workers }),
  };
  const admin = (options.workers ?? DEFAULT_WORKERS).admin;

  return {
    tokenAccepted: () =>
      cloudflare(async () => {
        try {
          return (await cf.tokens.verify()).status === "active";
        } catch (error) {
          if (refused(error)) return false;
          throw error;
        }
      }),

    tokenHealth: () => cloudflare(() => health(cf)),

    replaceToken: (token) =>
      cloudflare(async () => {
        const next = client(token);
        let accounts: { id: string }[];
        try {
          accounts = await client(token, "none").accounts.list();
        } catch (error) {
          if (refused(error)) return { ok: false, message: NOT_ACCEPTED };
          throw error;
        }
        if (!accounts.some((account) => account.id === options.accountId)) return { ok: false, message: FOREIGN };
        const checked = await health(next);
        if (checked.state === "rejected") return { ok: false, message: NOT_ACCEPTED };
        if (checked.missing.length > 0) {
          const names = checked.missing.map((gap) => gap.label).join(", ");
          return {
            ok: false,
            message: `This token lacks ${names}. Add it on Cloudflare's token page, then try again.`,
          };
        }
        // The token must reach this install's own admin, not only an account of the same id.
        if ((await next.workers.getSettings(admin)) === null) return { ok: false, message: FOREIGN };
        await next.workers.putSecret(admin, TOKEN_SECRET, token);
        return { ok: true, health: checked };
      }),

    describeUninstall: () =>
      cloudflare(async () => {
        const plan = await planUninstall(ctx);
        const effects: SetupEffect[] = [];
        for (const domain of await listDomains(options.db, { includeRemoved: true })) {
          effects.push(...(await describeRemoval(ctx, domain.host)).effects);
        }
        const { sites, installer } = { installer: "deparked-install", ...(options.workers ?? DEFAULT_WORKERS) };
        effects.push(
          { kind: "remove", what: "the bot checks Deparked created" },
          { kind: "remove", what: `the Worker ${sites} and every page on it` },
          { kind: "remove", what: `the Worker ${installer}, the installer` },
          { kind: "remove", what: `the Worker ${admin}, with your token and its other secrets` },
        );
        return {
          steps: plan.steps.map((step) => ({ id: step.id, title: step.title })),
          effects,
          keeps: [
            "your domains in Cloudflare, with every setting Deparked did not create: each serves what it served before",
            ...UNINSTALL_LEAVES.map((effect) => effect.what),
            "the API token itself: delete it on Cloudflare's token page",
            "your GitHub copy of the installer",
          ],
        };
      }),

    async uninstallStep(state) {
      const plan = await planUninstall(ctx);
      // The browser sends the index; the order is the server's. A step runs only once every step before it is
      // done, so a stale or forged index can never delete the admin while routes still point at it.
      const index = Math.min(Math.max(0, Math.trunc(state.next)), plan.steps.length);
      for (const earlier of plan.steps.slice(0, index)) {
        if ((await cloudflare(() => earlier.check(ctx))).status !== "done") {
          const step = plan.steps[index];
          return {
            step: step === undefined ? null : { id: step.id, title: step.title, index, total: plan.steps.length },
            outcome: "blocked",
            message: `“${earlier.title}” is not done yet. Start the uninstall again from the first step.`,
            effects: [],
            state: { next: index },
            finished: false,
            credentialsRejected: false,
          };
        }
      }
      const report = await runNextStep(plan, { next: index });
      return {
        step: report.step,
        outcome: report.outcome,
        message: report.message,
        effects: report.effects,
        state: report.state,
        finished: report.finished,
        credentialsRejected: report.errorStatus === 401 || report.errorStatus === 403,
      };
    },
  };
}
