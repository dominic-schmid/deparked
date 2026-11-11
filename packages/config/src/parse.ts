import { type Config, configSchema } from "./schema";

/** Keys are field paths (`headline`, `seo.title`, `accent.primary`); `form` when the input isn't an object. */
export type ConfigErrors = Record<string, string>;
export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: ConfigErrors };

/** Validates a current-version config, e.g. the admin form's state. Unknown keys are dropped. */
export function parseConfig(input: unknown): ConfigResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: { form: "This config can't be read." } };
  }
  const result = configSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  const errors: ConfigErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join(".") || "form";
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}
