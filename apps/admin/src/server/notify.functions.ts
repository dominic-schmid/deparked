import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { type HostingAdapter, HostingError } from "@deparked/hosting";
import { createServerFn } from "@tanstack/react-start";
import { hostSchema } from "./domains";
import { getHosting } from "./hosting";
import {
  addNotifyAddress,
  loadNotifyAddresses,
  type NotifyResult,
  notifyEmailSchema,
  pickNotifyAddress,
  refreshNotifyAddresses,
  removeNotifyAddress,
  resendNotifyAddress,
} from "./notify";
import { requireSession } from "./require-session";

// An install without a token cannot build the adapter at all: the owner gets that as a message, not as a crash.
async function withHosting(run: (hosting: HostingAdapter) => Promise<NotifyResult>): Promise<NotifyResult> {
  try {
    return await run(getHosting());
  } catch (error) {
    if (error instanceof HostingError) return { ok: false, message: error.message };
    throw error;
  }
}

export const getNotifyAddresses = createServerFn().handler(async () => {
  await requireSession();
  return { addresses: await loadNotifyAddresses(createDb(env.DB)), now: Date.now() };
});

export const addNotify = createServerFn({ method: "POST" })
  .validator(notifyEmailSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return withHosting((hosting) =>
      addNotifyAddress(createDb(env.DB), hosting, { email: data.email, now: Date.now() }),
    );
  });

export const resendNotify = createServerFn({ method: "POST" })
  .validator(notifyEmailSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return withHosting((hosting) =>
      resendNotifyAddress(createDb(env.DB), hosting, { email: data.email, now: Date.now() }),
    );
  });

export const removeNotify = createServerFn({ method: "POST" })
  .validator(notifyEmailSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return withHosting((hosting) => removeNotifyAddress(createDb(env.DB), hosting, { email: data.email }));
  });

export const checkNotify = createServerFn({ method: "POST" }).handler(async () => {
  await requireSession();
  return withHosting((hosting) => refreshNotifyAddresses(createDb(env.DB), hosting, { now: Date.now() }));
});

export const pickNotify = createServerFn({ method: "POST" })
  .validator(notifyEmailSchema.extend({ host: hostSchema }))
  .handler(async ({ data }) => {
    await requireSession();
    return pickNotifyAddress(createDb(env.DB), { host: data.host, email: data.email, now: Date.now() });
  });
