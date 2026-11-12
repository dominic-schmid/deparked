// Prepares the LOCAL D1 (the SQLite file under .wrangler/state that `vite dev` uses): applies the migrations,
// creates the workspace row and arms a known setup secret. Safe to run again: it re-arms the secret, which is
// also how to reset a forgotten local password. `getPlatformProxy` only ever opens local storage; in production
// the installer runs the migrations and creates the real secret.
import { applyMigrations, createDb, d1Runner, initWorkspace, setSetupSecret } from "@deparked/db";
import { getPlatformProxy } from "wrangler";
import { hashSetupSecret } from "../src/server/auth/account";

const DEV_SETUP_SECRET = "dev-setup-secret";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "wrangler.jsonc" });
try {
  const applied = await applyMigrations(d1Runner(proxy.env.DB));
  const db = createDb(proxy.env.DB);
  const now = Date.now();
  await initWorkspace(db, { now });
  await setSetupSecret(db, { secretHash: await hashSetupSecret(DEV_SETUP_SECRET), expiresAt: now + ONE_WEEK_MS, now });
  console.log(`Migrations: ${JSON.stringify(applied)}`);
  console.log(`Local setup link: http://localhost:5173/admin/setup?secret=${DEV_SETUP_SECRET}`);
} finally {
  await proxy.dispose();
}
