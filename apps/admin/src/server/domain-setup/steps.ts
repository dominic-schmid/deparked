import { type Db, getDeployment, listDomains, listSiteFilesByHost } from "@deparked/db";
import type {
  AccountDomainPage,
  DomainPreview,
  DomainSetup,
  SetupChange,
  SetupConfirmations,
  SetupEffect,
  SetupState,
  SetupStepReport,
} from "@deparked/hosting";
import { z } from "zod";
import { type PublishContext, type StartKind, startPublish, stepPublish } from "../publish/pipeline";

const LABEL = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** A domain name as the owner types or picks it: lowercased, no trailing dot, letters, digits and hyphens. */
export const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\.$/, ""))
  .pipe(z.string().regex(LABEL, "Not a domain name."));

export const confirmationsSchema = z.object({
  takeOverLiveSite: z.boolean().default(false),
  repointExistingRoutes: z.boolean().default(false),
  replaceExistingMx: z.boolean().default(false),
});

/** Untrusted: the steps check their own gates, so only the shape is checked here. */
export const stateSchema = z.object({ next: z.number().int().min(0).max(100) });

export type SetupDeps = { db: Db; setup: DomainSetup; publish: PublishContext };

/**
 * What the browser gets for one step. `working` (the admin's own outcome): the step started publishing and
 * continues in the next request; call again with the same state.
 */
export type StepView = Omit<SetupStepReport, "outcome"> & { outcome: SetupStepReport["outcome"] | "working" };

/** The step's publish needs another request. */
class PublishContinues extends Error {}
/** Another publish holds the lock. */
class PublishBusy extends Error {}
class PublishStopped extends Error {
  readonly credentialsRejected: boolean;
  constructor(message: string, credentialsRejected: boolean) {
    super(message);
    this.credentialsRejected = credentialsRejected;
  }
}

const DEPLOYMENT_KIND = { placeholder: "install", remove: "update" } as const;

/**
 * Starts the host's publish of this kind, or continues the one that already runs for it. Another publish that
 * holds the lock is `PublishBusy`.
 */
async function startOrContinue(ctx: PublishContext, host: string, kind: "placeholder" | "remove"): Promise<number> {
  const started = await startPublish(ctx, { host, kind: kind satisfies StartKind });
  if (started.ok) return started.deploymentId;
  if (started.reason === "busy") {
    const holder = started.deploymentId === undefined ? undefined : await getDeployment(ctx.db, started.deploymentId);
    if (holder?.host === host && holder.kind === DEPLOYMENT_KIND[kind] && holder.status === "running") {
      return holder.id;
    }
    throw new PublishBusy(started.message);
  }
  throw new PublishStopped(started.message, started.reason === "credentials-rejected");
}

/** One bounded piece of the host's publish. Resolves once it is live and recorded in `site_files`. */
async function publishOnce(ctx: PublishContext, host: string, kind: "placeholder" | "remove"): Promise<void> {
  const result = await stepPublish(ctx, await startOrContinue(ctx, host, kind));
  if (result.status === "done") return;
  if (result.status === "running") throw new PublishContinues(result.message);
  throw new PublishStopped(result.message, result.reason === "credentials-rejected");
}

/** `ProvisionContext.publishPlaceholder` for the admin: the attach's publish, one request at a time. */
export function placeholderPublisher(ctx: PublishContext): (host: string) => Promise<void> {
  return (host) => publishOnce(ctx, host, "placeholder");
}

const TAKE_DOWN = { id: "take-down", title: "Take the pages offline" };

/** The steps of a change, for the progress list before the first one runs. No request. */
export function listSteps(deps: Pick<SetupDeps, "setup">, change: SetupChange, host: string) {
  const steps = deps.setup.stepTitles(change, host);
  return change === "attach" ? steps : [...steps, TAKE_DOWN];
}

function view(
  deps: SetupDeps,
  change: SetupChange,
  host: string,
  state: SetupState,
  outcome: StepView["outcome"],
  fields: { message?: string; effects?: SetupEffect[]; credentialsRejected?: boolean } = {},
): StepView {
  const steps = listSteps(deps, change, host);
  const step = steps[state.next];
  const moved = outcome === "ran" || outcome === "already-done";
  const next = moved ? state.next + 1 : state.next;
  return {
    step: step === undefined ? null : { ...step, index: state.next, total: steps.length },
    outcome,
    message: fields.message ?? "",
    effects: fields.effects ?? [],
    state: { next },
    finished: next >= steps.length,
    credentialsRejected: fields.credentialsRejected ?? false,
  };
}

/** Turns the publish's own signals into a step outcome; anything else is thrown on. */
function publishOutcome(
  deps: SetupDeps,
  change: SetupChange,
  host: string,
  state: SetupState,
  error: unknown,
): StepView {
  if (error instanceof PublishContinues) return view(deps, change, host, state, "working", { message: error.message });
  if (error instanceof PublishBusy) return view(deps, change, host, state, "busy", { message: error.message });
  if (error instanceof PublishStopped) {
    return view(deps, change, host, state, "failed", {
      message: error.message,
      credentialsRejected: error.credentialsRejected,
    });
  }
  throw error;
}

async function hostingStep(
  deps: SetupDeps,
  change: SetupChange,
  host: string,
  state: SetupState,
  confirmations: SetupConfirmations,
): Promise<StepView> {
  try {
    const report = await deps.setup.step(change, host, state, confirmations);
    if (change === "attach") return report;
    // The take-down publish is one more step after the hosting's own.
    const total = listSteps(deps, change, host).length;
    return {
      ...report,
      step: report.step === null ? null : { ...report.step, total },
      finished: report.state.next >= total,
    };
  } catch (error) {
    return publishOutcome(deps, change, host, state, error);
  }
}

/** One step of attaching (or turning on again) a domain. The browser calls it until `finished`. */
export function attachStep(
  deps: SetupDeps,
  input: { host: string; confirmations: SetupConfirmations; state: SetupState },
): Promise<StepView> {
  return hostingStep(deps, "attach", input.host, input.state, input.confirmations);
}

/**
 * One step of Turn off or Remove: the hosting's steps undo what Deparked changed, then, once nothing routes
 * visitors to the pages any more, a publish takes the domain's files out.
 */
export async function takeOffStep(
  deps: SetupDeps,
  input: { change: "turn-off" | "remove"; host: string; state: SetupState },
): Promise<StepView> {
  const { change, host, state } = input;
  const hostingSteps = deps.setup.stepTitles(change, host).length;
  if (state.next < hostingSteps) return hostingStep(deps, change, host, state, {});
  if (state.next > hostingSteps) return view(deps, change, host, state, "finished");
  if ((await listSiteFilesByHost(deps.db, host)).length === 0) return view(deps, change, host, state, "already-done");
  try {
    await publishOnce(deps.publish, host, "remove");
    return view(deps, change, host, state, "ran", {
      effects: [{ kind: "remove", what: `the pages of ${host}` }],
    });
  } catch (error) {
    return publishOutcome(deps, change, host, state, error);
  }
}

/** Domains Deparked manages now; a removed one can be added again. */
async function managedHosts(db: Db): Promise<Set<string>> {
  return new Set((await listDomains(db)).map((domain) => domain.host));
}

export async function listAccountDomains(
  deps: Pick<SetupDeps, "db" | "setup">,
  input: { search: string; page: number },
): Promise<AccountDomainPage> {
  const search = input.search.trim().toLowerCase();
  return deps.setup.listAccountDomains({
    ...(search === "" ? {} : { search }),
    page: input.page,
    exclude: await managedHosts(deps.db),
  });
}

export function previewAttach(
  deps: Pick<SetupDeps, "setup">,
  input: { host: string; confirmations: SetupConfirmations },
): Promise<DomainPreview> {
  return deps.setup.preview(input.host, input.confirmations);
}
