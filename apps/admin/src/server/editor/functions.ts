import { env } from "cloudflare:workers";
import { createDb, getDomain } from "@deparked/db";
import { catalog } from "@deparked/templates/catalog";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { isHostName } from "../publish/files";
import { requireSession } from "../require-session";
import { loadEditor, loadPublishState, renderPreview } from "./editor";

const host = z.string().refine(isHostName, "Not a domain name.");

export const getEditor = createServerFn()
  .validator(z.object({ host }))
  .handler(async ({ data }) => {
    await requireSession();
    const editor = await loadEditor({ db: createDb(env.DB), catalog, now: Date.now }, data.host);
    if (editor === null) throw notFound();
    return editor;
  });

/** The publish bar's state, read again while another publish runs. */
export const getEditorPublishState = createServerFn()
  .validator(z.object({ host }))
  .handler(async ({ data }) => {
    await requireSession();
    return loadPublishState({ db: createDb(env.DB), now: Date.now }, data.host);
  });

/**
 * Renders the lander for a posted, unsaved draft. Writes nothing. On a managed domain the page's `/catalog/*`
 * paths load from that domain; elsewhere (the admin's `workers.dev` address) from the domain being edited.
 */
export const previewDraft = createServerFn({ method: "POST" })
  .validator(z.object({ host, config: z.unknown() }))
  .handler(async ({ data }) => {
    await requireSession();
    const db = createDb(env.DB);
    if ((await getDomain(db, data.host)) === undefined) {
      return { ok: false as const, errors: { form: "This domain is not managed here." } };
    }
    const here = new URL(getRequest().url).hostname;
    const servesCatalog = isHostName(here) && (await getDomain(db, here)) !== undefined;
    return renderPreview({ catalog }, data.host, data.config, servesCatalog ? null : `https://${data.host}/`);
  });
