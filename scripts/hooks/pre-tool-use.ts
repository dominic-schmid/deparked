// Claude Code PreToolUse hook (wired in .claude/settings.json; argv[2] is the project dir). Reads the hook
// input on stdin and prints a permission decision for deny / ask; prints nothing to allow. Fails closed:
// errors here deny the tool, and settings.json turns a crash of the process into exit 2 (block).
// No runtime dependencies (input narrowed by hand, not Zod), so a missing `pnpm install` can't disable it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Verdict } from "./guard.ts";
import {
  checkBash,
  checkEdit,
  checkGitHubBranch,
  checkGitHubPaths,
  checkGitHubText,
  checkMerge,
  checkRead,
} from "./guard.ts";

type HookInput = { toolName: string; toolInput: Record<string, unknown>; cwd: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInput(raw: string): HookInput {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.tool_name !== "string" || !isRecord(value.tool_input)) {
    throw new Error("Unexpected hook input: need tool_name and tool_input");
  }
  return {
    toolName: value.tool_name,
    toolInput: value.tool_input,
    cwd: typeof value.cwd === "string" ? value.cwd : process.cwd(),
  };
}

function text(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function texts(input: Record<string, unknown>, keys: readonly string[]): string {
  return keys.map((key) => text(input, key) ?? "").join("\n");
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

// Relative to the project the running guard lives in, so a worktree subagent can't edit it by absolute path.
function repoPath(cwd: string, path: string | undefined): string | undefined {
  const root = process.argv[2] ?? git(cwd, ["rev-parse", "--show-toplevel"]);
  if (path === undefined || root === undefined) return undefined;
  const inside = relative(root, isAbsolute(path) ? path : `${cwd}/${path}`);
  return inside.startsWith("..") || isAbsolute(inside) ? undefined : inside;
}

// The file paths a GitHub MCP write names: `path` (create, update, delete) or `files[].path` (push_files).
function pushedPaths(input: Record<string, unknown>): string[] {
  const files = Array.isArray(input.files) ? input.files : [];
  const fromFiles = files.flatMap((file: unknown) =>
    isRecord(file) && typeof file.path === "string" ? [file.path] : [],
  );
  const path = text(input, "path");
  return path === undefined ? fromFiles : [path, ...fromFiles];
}

function decide({ toolName, toolInput, cwd }: HookInput): Verdict {
  switch (toolName) {
    case "Bash":
      return checkBash(text(toolInput, "command") ?? "", git(cwd, ["branch", "--show-current"]));
    case "Read":
      return checkRead(text(toolInput, "file_path") ?? "");
    case "Edit":
    case "Write":
    case "MultiEdit":
      return checkEdit(repoPath(cwd, text(toolInput, "file_path")));
    case "NotebookEdit":
      return checkEdit(repoPath(cwd, text(toolInput, "notebook_path")));
    case "mcp__github__merge_pull_request":
      return checkMerge({
        mergeMethod: text(toolInput, "merge_method"),
        sha: text(toolInput, "expectedHeadSha"),
        title: text(toolInput, "commit_title"),
        message: text(toolInput, "commit_message"),
      });
    case "mcp__github__enable_pr_auto_merge":
      return { decision: "deny", reason: "No auto-merge: merge through merge_pull_request so these checks run." };
    case "mcp__github__push_files":
    case "mcp__github__create_or_update_file":
    case "mcp__github__delete_file": {
      // Every check runs and a deny wins over an ask: the owner approving a guard push must not skip the others.
      const verdicts = [
        checkGitHubBranch(text(toolInput, "branch")),
        checkGitHubPaths(pushedPaths(toolInput)),
        checkGitHubText(texts(toolInput, ["message"])),
      ];
      return (
        verdicts.find((v) => v.decision === "deny") ??
        verdicts.find((v) => v.decision === "ask") ?? { decision: "allow" }
      );
    }
    case "mcp__github__create_pull_request":
    case "mcp__github__update_pull_request":
      return checkGitHubText(texts(toolInput, ["title", "body"]));
    default:
      return { decision: "allow" };
  }
}

function verdictFor(): Verdict {
  try {
    return decide(parseInput(readFileSync(0, "utf8")));
  } catch (error) {
    return { decision: "deny", reason: `Guard failed, so the tool is blocked: ${String(error)}` };
  }
}

const verdict = verdictFor();
if (verdict.decision !== "allow") {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: verdict.decision,
      permissionDecisionReason: verdict.reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
}
