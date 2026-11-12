import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
/** Everything a run writes: Worker logs, local D1 state, the copy of the sites assets. Git-ignored. */
export const TMP = resolve(ROOT, "e2e/.tmp");
export const LOGS = resolve(TMP, "logs");
/** One file per running process group, named by its pid, so the global teardown can kill what a crash left. */
export const PIDS = resolve(TMP, "pids");
