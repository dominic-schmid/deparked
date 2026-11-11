import { type ConfigResult, parseConfig } from "./parse";
import { CONFIG_VERSION } from "./schema";

type Stored = Record<string, unknown>;
/** Keyed by the version a step upgrades from; the runner sets the new `version` itself. */
export type Migrations = Readonly<Record<number, (config: Stored) => Stored>>;

const MIGRATIONS: Migrations = {};

/** Upgrades a stored config of any known version to the current one, then validates it. Safe to run twice. */
export function migrateConfig(input: unknown): ConfigResult {
  const upgraded = upgrade(input, MIGRATIONS, CONFIG_VERSION);
  return upgraded.ok ? parseConfig(upgraded.config) : upgraded;
}

export function upgrade(
  input: unknown,
  migrations: Migrations,
  target: number,
): { ok: true; config: Stored } | { ok: false; errors: Record<string, string> } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: { form: "This config can't be read." } };
  }
  let config = input as Stored;
  const version = config.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, errors: { version: "This config has no version number, so it can't be read." } };
  }
  if (version > target) {
    return {
      ok: false,
      errors: { version: "This config was saved by a newer version of Deparked. Update Deparked to edit it." },
    };
  }
  for (let from = version; from < target; from++) {
    const step = migrations[from];
    if (!step) {
      return { ok: false, errors: { version: `This config has version ${version}, which Deparked can't upgrade.` } };
    }
    config = { ...step(config), version: from + 1 };
  }
  return { ok: true, config };
}
