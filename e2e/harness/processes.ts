import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { LOGS, PIDS, ROOT } from "./paths";

const WRANGLER = resolve(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin/wrangler.js");
const START_TIMEOUT_MS = 90_000;
const ATTEMPTS = 3;

export interface LocalWorker {
  url: string;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise((done) => server.close(done));
  return port;
}

function alive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ends a process group (wrangler, its workerd and its esbuild): SIGTERM, then SIGKILL if it lingers. */
export async function killGroup(pid: number): Promise<void> {
  if (!alive(pid)) return;
  process.kill(-pid, "SIGTERM");
  const deadline = Date.now() + 5000;
  while (alive(pid) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
  if (alive(pid)) process.kill(-pid, "SIGKILL");
}

/** A process's start time in clock ticks since boot (Linux), or null where /proc does not exist or the pid is gone. */
function startTime(pid: number): string | null {
  try {
    // Field 22 of /proc/<pid>/stat; the command in field 2 may hold spaces, so count from the last ")".
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

/**
 * Kills every process group a crashed run left behind. A pid file holds the start time of the process we
 * started: a pid that now belongs to another process (or cannot be checked) is left alone.
 */
export async function killLeftovers(): Promise<void> {
  mkdirSync(PIDS, { recursive: true });
  for (const name of readdirSync(PIDS)) {
    const file = resolve(PIDS, name);
    const pid = /^\d+$/.test(name) ? Number(name) : 0;
    const started = pid > 1 ? startTime(pid) : null;
    if (started !== null && started === readFileSync(file, "utf8")) await killGroup(pid);
    rmSync(file, { force: true });
  }
}

async function responds(url: string): Promise<boolean> {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `wrangler dev` for one Worker on a free port and resolves once `readyPath` answers (any status).
 * A start that dies early, for example because another process took the port in between, is retried on a new port.
 */
export async function startWorker(options: {
  name: string;
  config: string;
  persistTo: string;
  readyPath: string;
  args?: string[];
  vars?: Record<string, string>;
}): Promise<LocalWorker> {
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(PIDS, { recursive: true });
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const port = await freePort();
    const log = createWriteStream(resolve(LOGS, `${options.name}.log`));
    const child: ChildProcess = spawn(
      process.execPath,
      [
        WRANGLER,
        "dev",
        "--config",
        resolve(ROOT, options.config),
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--inspector-port",
        "0",
        "--persist-to",
        options.persistTo,
        "--show-interactive-dev-session=false",
        ...(options.args ?? []),
        ...Object.entries(options.vars ?? {}).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
      ],
      {
        cwd: ROOT,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1" },
      },
    );
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    const pid = child.pid;
    if (pid === undefined) throw new Error(`could not spawn wrangler for ${options.name}`);
    const pidFile = resolve(PIDS, String(pid));
    writeFileSync(pidFile, startTime(pid) ?? "");
    const stop = async () => {
      await killGroup(pid);
      rmSync(pidFile, { force: true });
    };

    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!exited && Date.now() < deadline) {
      if (await responds(`${url}${options.readyPath}`)) return { url, stop };
      await new Promise((done) => setTimeout(done, 100));
    }
    await stop();
    lastError = exited ? "exited before it was ready" : `not ready after ${START_TIMEOUT_MS} ms`;
    if (!exited) break;
  }
  throw new Error(`${options.name}: ${lastError}. See e2e/.tmp/logs/${options.name}.log`);
}
