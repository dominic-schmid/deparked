import { env } from "cloudflare:workers";
import { createDb, getDomain } from "@deparked/db";
import { catalog } from "@deparked/templates/catalog";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isHostName } from "../publish/files";
import { requireSession } from "../require-session";
import { loadEditor, loadPublishState, loadThumbnail, parseOrigin, renderPreview } from "./editor";

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

/** Far more than any valid config; a larger body is refused before it is parsed. */
export const PREVIEW_MAX_BYTES = 64 * 1024;

/**
 * Renders the lander for a posted, unsaved draft. Writes nothing. `origin` is the admin page's own origin: the
 * preview's images and fonts load from its `/catalog/*`.
 */
export const previewDraft = createServerFn({ method: "POST" })
  .validator(
    z.object({
      host,
      origin: z.string().max(300),
      config: z
        .unknown()
        .refine((value) => (JSON.stringify(value) ?? "").length <= PREVIEW_MAX_BYTES, "This design is too large."),
    }),
  )
  .handler(async ({ data }) => {
    await requireSession();
    const domain = await getDomain(createDb(env.DB), data.host);
    if (domain === undefined || domain.status === "removed") {
      return { ok: false as const, errors: { form: "This domain is not managed here." } };
    }
    const origin = parseOrigin(data.origin);
    if (origin === null) return { ok: false as const, errors: { form: "The preview could not be rendered here." } };
    return renderPreview({ catalog }, data.host, data.config, origin);
  });

/**
 * The page in a domain's window on the home screen, rendered like the preview. Asked for per card once it scrolls into
 * view, so the home screen itself renders no page. Null for an unknown host or an origin the policy cannot name.
 */
export const getThumbnail = createServerFn()
  .validator(z.object({ host, origin: z.string().max(300) }))
  .handler(async ({ data }) => {
    await requireSession();
    const origin = parseOrigin(data.origin);
    if (origin === null) return null;
    return loadThumbnail({ db: createDb(env.DB), catalog }, data.host, origin);
  });
