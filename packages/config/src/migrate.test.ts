import { describe, expect, it } from "vitest";
import { CONFIG_VERSION, defaultConfig, migrateConfig } from "./index";
import { type Migrations, upgrade } from "./migrate";

describe("migrateConfig", () => {
  it("returns a current config unchanged, however often it runs", () => {
    const once = migrateConfig(defaultConfig());
    expect(once).toEqual({ ok: true, config: defaultConfig() });
    expect(once.ok && migrateConfig(once.config)).toEqual(once);
  });

  it("validates what it returns", () => {
    expect(migrateConfig({ ...defaultConfig(), currency: "BTC" })).toEqual({
      ok: false,
      errors: { currency: "Pick a currency from the list." },
    });
  });

  it("explains a config from a newer release", () => {
    expect(migrateConfig({ ...defaultConfig(), version: CONFIG_VERSION + 1 })).toEqual({
      ok: false,
      errors: { version: "This config was saved by a newer version of Deparked. Update Deparked to edit it." },
    });
  });

  it.each([{}, { version: "1" }, { version: 1.5 }])("explains a missing version in %j", (input) => {
    expect(migrateConfig(input)).toEqual({
      ok: false,
      errors: { version: "This config has no version number, so it can't be read." },
    });
  });

  it("explains a version it has no upgrade for", () => {
    expect(migrateConfig({ ...defaultConfig(), version: 0 })).toEqual({
      ok: false,
      errors: { version: "This config has version 0, which Deparked can't upgrade." },
    });
  });

  it.each([null, "x", []])("rejects %j as unreadable", (input) => {
    expect(migrateConfig(input)).toEqual({ ok: false, errors: { form: "This config can't be read." } });
  });
});

describe("upgrade", () => {
  const migrations: Migrations = {
    1: ({ title, ...rest }) => ({ ...rest, headline: title }),
    2: (config) => ({ ...config, currency: "EUR" }),
  };

  it("runs every step from the stored version to the target", () => {
    expect(upgrade({ version: 1, title: "For sale" }, migrations, 3)).toEqual({
      ok: true,
      config: { version: 3, headline: "For sale", currency: "EUR" },
    });
    expect(upgrade({ version: 2, headline: "For sale" }, migrations, 3)).toEqual({
      ok: true,
      config: { version: 3, headline: "For sale", currency: "EUR" },
    });
  });

  it("is idempotent and leaves its input alone", () => {
    const stored = { version: 1, title: "For sale" };
    const first = upgrade(stored, migrations, 3);
    expect(first.ok && upgrade(first.config, migrations, 3)).toEqual(first);
    expect(stored).toEqual({ version: 1, title: "For sale" });
  });
});
