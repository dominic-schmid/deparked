// Fails when git sees any change, tracked or new, under the given paths. Used by the check:*-fresh scripts after a
// rebuild; a Node script so they run the same in every shell.
import { execFileSync } from "node:child_process";

const changed = execFileSync("git", ["status", "--porcelain", "--", ...process.argv.slice(2)], { encoding: "utf8" });
if (changed !== "") {
  process.stderr.write(`Stale committed build output; rebuild and commit it:\n${changed}`);
  process.exit(1);
}
