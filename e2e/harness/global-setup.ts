import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { LOGS, ROOT } from "./paths";
import { killLeftovers } from "./processes";

/** Builds the admin once per run: the suite serves the production build, as the installer would upload it. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await killLeftovers();
  rmSync(LOGS, { recursive: true, force: true });
  execFileSync("pnpm", ["--filter", "@deparked/admin", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  return killLeftovers;
}
