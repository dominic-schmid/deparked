import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "../require-session";
import { publishContext } from "./context";
import { isHostName } from "./files";
import * as pipeline from "./pipeline";

const host = z.string().refine(isHostName, "Not a domain name.");
const id = z.number().int().positive();

function dbContext() {
  return { db: createDb(env.DB), now: Date.now };
}

/** Validates and stores a domain's draft; nothing is published. Field errors come back, not thrown. */
export const saveDraft = createServerFn({ method: "POST" })
  .validator(z.object({ host, config: z.unknown() }))
  .handler(async ({ data }) => {
    await requireSession();
    return pipeline.saveDraftConfig(dbContext(), data.host, data.config);
  });

export const getPublishState = createServerFn({ method: "GET" })
  .validator(z.object({ host }))
  .handler(async ({ data }) => {
    await requireSession();
    return pipeline.getPublishState(dbContext(), data.host);
  });

/** Takes the publish lock. Then call `stepPublish` with the id until it answers `done` or `failed`. */
export const startPublish = createServerFn({ method: "POST" })
  .validator(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.enum(["draft", "placeholder", "remove"]), host }),
      z.object({ kind: z.literal("republish-all") }),
    ]),
  )
  .handler(async ({ data }) => {
    await requireSession();
    return pipeline.startPublish(await publishContext(), data);
  });

/** One bounded piece of a publish, one request. */
export const stepPublish = createServerFn({ method: "POST" })
  .validator(z.object({ deploymentId: id }))
  .handler(async ({ data }) => {
    await requireSession();
    return pipeline.stepPublish(await publishContext(), data.deploymentId);
  });

/** Makes a `config_history` entry the draft and starts publishing it; step it like `startPublish`. */
export const revertTo = createServerFn({ method: "POST" })
  .validator(z.object({ historyId: id }))
  .handler(async ({ data }) => {
    await requireSession();
    return pipeline.revertTo(await publishContext(), data.historyId);
  });

/** Emergency only: an earlier version of the pages Worker goes live, D1 stays as it is. Prefer `revertTo`. */
export const rollbackPublish = createServerFn({ method: "POST" })
  .validator(z.object({ deploymentId: id }))
  .handler(async ({ data }) => {
    await requireSession();
    return pipeline.rollbackPublish(await publishContext(), { deploymentId: data.deploymentId });
  });

export const listHistory = createServerFn({ method: "GET" })
  .validator(z.object({ host }))
  .handler(async ({ data }) => {
    await requireSession();
    return pipeline.listHistory(createDb(env.DB), data.host);
  });
