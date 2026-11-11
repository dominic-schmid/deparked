// Policy for Claude Code's PreToolUse hook: hard rules and the merge form, checked before a tool runs.
// Pure functions; `pre-tool-use.ts` feeds them the hook input and the git facts they need.
// A speed bump against mistakes and steered agents, not a sandbox: a determined shell can get around any
// command-text check. On GitHub Free there is no ruleset behind it: only squash-only (a repository setting) holds
// server-side.
import { posix } from "node:path";

export type Verdict = { decision: "allow" } | { decision: "deny" | "ask"; reason: string };

const ALLOW: Verdict = { decision: "allow" };
const DEFAULT_BRANCHES = new Set(["main", "master"]);

// Paths where a change needs more care: they pick the security reviewer and the Plan tier in the ship /
// self-review skills. Not a merge gate: Claude merges these like any other change.
export const SENSITIVE_PATHS: readonly { pattern: RegExp; area: string }[] = [
  { pattern: /(login|session|password|setup-?token|auth|credential)/i, area: "auth or session" },
  { pattern: /(^|\/)offers?(\/|\.|$)/i, area: "offer endpoint (public input)" },
  { pattern: /(^|\/)publish(\/|\.|$)/i, area: "publish pipeline" },
  { pattern: /^packages\/db\//, area: "database schema and migrations" },
  { pattern: /^packages\/cf\//, area: "Cloudflare API client" },
  { pattern: /^packages\/provision\//, area: "provisioning (changes real Cloudflare resources)" },
  { pattern: /(^|\/)wrangler\.(jsonc?|toml)$/, area: "Worker config" },
  { pattern: /^\.github\//, area: "CI" },
  { pattern: /^pnpm-lock\.yaml$/, area: "dependencies" },
  {
    pattern: /(^|\/)package\.json$|^(turbo\.json|pnpm-workspace\.yaml|\.node-version)$/,
    area: "build and check scripts",
  },
  {
    pattern:
      /^(\.claude\/|\.agents\/|scripts\/hooks\/|skills-lock\.json$|\.mcp\.json$|\.coderabbit\.ya?ml$|docs\/(conventions|skills)\.md$)|(^|\/)(AGENTS|CLAUDE)\.md$/,
    area: "agent rules and guards",
  },
];

// The guard's own files: a local edit changes the running guard at once, a pushed one once it is merged, so the
// owner decides either way.
const GUARD_FILES = /^(scripts\/hooks\/|\.claude\/settings(\.local)?\.json$)/;
const GUARD = String.raw`(?:scripts/hooks|\.claude/settings)`;
// Local secrets (wrangler's .dev.vars, .env files) never go to git.
const SECRET_FILE = /(^|\/)(\.dev\.vars|\.env(\.[\w.-]+)?)$/;
const GUARD_WRITES = [
  new RegExp(String.raw`(?:(?:^|[^2&])>>?|\btee\b(?:\s+-a)?)\s*["']?[^\s;|&]*${GUARD}`),
  new RegExp(String.raw`\b(?:sed\s+-i|perl\s+-\S*i|cp|mv|ln|rm|install)\b[^;|&\n]*${GUARD}`),
  new RegExp(String.raw`\bgit\s+(?:checkout|restore|apply|stash|reset)\b[^;|&\n]*${GUARD}`),
];

const ATTRIBUTION = [/Co-Authored-By:\s*Claude/i, /Claude-Session:/i, /Generated (with|by) \[?Claude Code/i];

function deny(reason: string): Verdict {
  return { decision: "deny", reason };
}

function ask(reason: string): Verdict {
  return { decision: "ask", reason };
}

// Heredoc bodies and quoted strings are data (messages, search patterns), not commands: dropped before the
// command checks, so `grep "git push"` or a commit saying "never git push to main" isn't read as one.
// Credentials and attribution are checked on the full command: the shell expands `$CLOUDFLARE_API_TOKEN` inside quotes.
function withoutData(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$|\))/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, " ");
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "" && !/^\d?[<>]/.test(word));
}

// Git's own options before the subcommand (`git -C dir push`).
const GIT = String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+`;
const ARGS = String.raw`([^;&|()\n]*)`;

function subcommandArgs(command: string, subcommand: string): string[][] {
  const pattern = new RegExp(`${GIT}${subcommand}\\b${ARGS}`, "g");
  return [...command.matchAll(pattern)].map((match) => words(match[1] ?? ""));
}

function hasShortFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => /^-[a-zA-Z]+$/.test(arg) && arg.includes(flag));
}

function checkPush(args: readonly string[], branch: string | undefined): Verdict {
  if (args.some((arg) => arg === "--all" || arg === "--mirror")) {
    return deny("Push one branch at a time: --all and --mirror would rewrite main.");
  }
  if (hasShortFlag(args, "f") || args.includes("--force") || args.some((arg) => /^\+./.test(arg))) {
    return deny("Force push is blocked; use --force-with-lease on your own branch.");
  }
  const refs = args.filter((arg) => !arg.startsWith("-")).slice(1);
  if (refs.some((ref) => ref.includes("$"))) {
    return deny("Name the branch literally when pushing, so the guard can check it is not main.");
  }
  const onDefault = branch !== undefined && DEFAULT_BRANCHES.has(branch);
  const targets = refs.map((ref) => {
    const target = (ref.split(":").at(-1) ?? "").replace(/^refs\/heads\//, "");
    return target === "HEAD" || target === "@" ? (branch ?? "HEAD") : target;
  });
  if ((refs.length === 0 && onDefault) || targets.some((target) => DEFAULT_BRANCHES.has(target))) {
    return deny("Never push to main: push a branch and open a pull request.");
  }
  return ALLOW;
}

function exposesCredentials(command: string): boolean {
  return (
    /\$\{?!?(?:CLOUDFLARE_|CF_)|env(\.|\[\s*["'`]?)(?:CLOUDFLARE_|CF_)|getenv\s*\(|os\.environ|\/proc\/[\w/]*environ/.test(command) ||
    /\bprintenv\b|\bdeclare\s+-[a-zA-Z]*[px]/.test(command) ||
    /(?:^|[;&|(/]\s*)(?:env(?:\s+-u\s+\S+|\s+-\S+)*|export(?:\s+-p)?|set)\s*(?:$|[;&|)>])/.test(command) ||
    /(?:console\.\w+\(|JSON\.stringify\(|\s-p\s+["']?)\s*process\.env\s*(?:$|[^.\w[])/.test(command)
  );
}

// `gh api` segments only. GraphQL is a write when it says `mutation` or reads its query from a file; REST
// is a write with a non-GET method or with fields.
function isGhApiWrite(command: string): boolean {
  return [...command.matchAll(/\bgh\s+api\b[^|;&\n]*/g)].some(([segment]) => {
    if (/\bgraphql\b/.test(segment)) return /\bmutation\b|=@|--input\b/.test(segment);
    const method = /\s(?:-X|--method)[=\s]*([A-Za-z]+)/.exec(segment)?.[1]?.toUpperCase();
    if (method !== undefined) return method !== "GET" && method !== "HEAD";
    return /\s(?:-[fF]|--field|--raw-field|--input)(?:[=\s]|\S)/.test(segment);
  });
}

const GH_REPO_WRITE =
  /\bgh\s+(?:repo\s+(?:edit|delete|rename|archive)|secret|variable|ruleset|workflow\s+(?:run|enable|disable)|release\s+(?:create|delete|edit))\b/;
const GIT_ALIAS_READS = new Set(["--get", "--get-all", "--get-regexp", "-l", "--list"]);

// `branch` is the checked-out branch, used when a push names no refspec or names HEAD.
export function checkBash(fullCommand: string, branch: string | undefined): Verdict {
  if (exposesCredentials(fullCommand)) {
    return deny("Hard rule: never read or print Cloudflare tokens or dump the environment.");
  }
  if (
    GUARD_WRITES.some((pattern) => pattern.test(fullCommand)) ||
    /\bpython3?\b[\s\S]*scripts\/hooks/.test(fullCommand)
  ) {
    return ask("Changing the guard from the shell takes effect at once: the owner decides.");
  }
  const command = withoutData(fullCommand);
  for (const args of subcommandArgs(command, "push")) {
    const verdict = checkPush(args, branch);
    if (verdict.decision !== "allow") return verdict;
  }
  for (const args of subcommandArgs(command, "add")) {
    if (hasShortFlag(args, "f") || args.includes("--force")) {
      return deny("Force-adding ignored files is blocked: they hold local secrets (.dev.vars, .env).");
    }
  }
  for (const args of subcommandArgs(command, "config")) {
    if (args.some((arg) => arg.startsWith("alias.")) && !args.some((arg) => GIT_ALIAS_READS.has(arg))) {
      return deny("Git aliases would hide commands from this guard.");
    }
  }
  if (/\bgit\s+commit\b.*\s(-F|--file)[\s=]|\bgh\b.*\s--body-file[\s=]/.test(command)) {
    return deny("Pass messages inline (-m with a heredoc), so the guard can check them for attribution.");
  }
  if (/\bgh\s+pr\s+merge\b/.test(command)) {
    return deny("Merge through the merge_pull_request tool so its checks run.");
  }
  if (GH_REPO_WRITE.test(command) || (/\bgh\s+api\b/.test(command) && isGhApiWrite(fullCommand))) {
    return ask("Repository settings, secrets, workflows and gh api writes skip the guard's checks: the owner decides.");
  }
  const publishes =
    /\bgit\s+(commit|tag|notes)\b|\bgh\s+(pr|issue|release)\s+(create|edit|comment|review)\b|\bgh\s+api\b/;
  if (publishes.test(command) && ATTRIBUTION.some((pattern) => pattern.test(fullCommand))) {
    return deny("No AI attribution in commits or pull requests (AGENTS.md).");
  }
  return ALLOW;
}

// Text the GitHub MCP tools would publish: titles, bodies, commit messages.
export function checkGitHubText(text: string): Verdict {
  return ATTRIBUTION.some((pattern) => pattern.test(text))
    ? deny("No AI attribution in commits or pull requests (AGENTS.md).")
    : ALLOW;
}

export function checkGitHubBranch(branch: string | undefined): Verdict {
  return branch !== undefined && DEFAULT_BRANCHES.has(branch)
    ? deny("Never write to main through the API: use a branch and a pull request.")
    : ALLOW;
}

// `path` is relative to the repository root, or undefined when outside it.
export function checkEdit(path: string | undefined): Verdict {
  return path !== undefined && GUARD_FILES.test(path)
    ? ask("Editing the guard changes it for this session at once: the owner decides.")
    : ALLOW;
}

export function checkRead(path: string): Verdict {
  return /\/proc\/[\w/]*environ/.test(path)
    ? deny("Reading the process environment would expose Cloudflare tokens.")
    : ALLOW;
}

// Files the GitHub MCP tools would write to a branch. A local secrets file never goes to git; a guard file
// changes the guard as soon as it is merged, so the owner decides, as for a local edit.
// Paths are made repository-relative first (`./x`, `/x`, `a/../x` → `x`), as a local edit's are.
export function checkGitHubPaths(paths: readonly string[]): Verdict {
  const files = paths.map((path) => posix.normalize(`/${path}`).slice(1));
  if (files.some((path) => SECRET_FILE.test(path))) {
    return deny(".dev.vars and .env files hold secrets and never go to git: commit a .example instead.");
  }
  return files.some((path) => GUARD_FILES.test(path))
    ? ask("Pushing a change to the guard changes it once merged: the owner decides.")
    : ALLOW;
}

export type MergeFacts = {
  mergeMethod: string | undefined;
  sha: string | undefined;
  title: string | undefined;
  message: string | undefined;
};

export function checkMerge(facts: MergeFacts): Verdict {
  if (facts.mergeMethod !== "squash") {
    return deny("Pull requests are squash-merged: pass merge_method squash.");
  }
  if (facts.sha === undefined || !/^[0-9a-f]{40}$/.test(facts.sha)) {
    return deny("Pin the merge to the reviewed head: pass its full sha as expectedHeadSha.");
  }
  if (!facts.title || facts.message === undefined) {
    return deny("Pass commit_title (the PR title) and commit_message: GitHub's default carries branch trailers.");
  }
  const text = checkGitHubText(`${facts.title}\n${facts.message}`);
  if (text.decision !== "allow") return text;
  if (/^## Self-review/m.test(facts.message)) {
    return deny("Leave the ## Self-review record out of commit_message: it belongs to the PR, not main.");
  }
  return ALLOW;
}
