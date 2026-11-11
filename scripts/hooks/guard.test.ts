import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkBash,
  checkEdit,
  checkGitHubBranch,
  checkGitHubPaths,
  checkGitHubText,
  checkMerge,
  checkRead,
  SENSITIVE_PATHS,
} from "./guard.ts";

const HOOK = join(import.meta.dirname, "pre-tool-use.ts");
const SHA = "0123456789abcdef0123456789abcdef01234567";

// The areas of SENSITIVE_PATHS that `files` touch, as the ship and self-review skills read the list.
function sensitiveAreas(files: readonly string[]): string[] {
  const areas = SENSITIVE_PATHS.filter(({ pattern }) => files.some((file) => pattern.test(file))).map((p) => p.area);
  return [...new Set(areas)];
}

function runHook(input: string): string {
  const result = spawnSync("node", [HOOK], { input, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function decision(command: string, branch = "feat/x"): string {
  return checkBash(command, branch).decision;
}

function assertAll(commands: readonly string[], expected: string, branch?: string): void {
  for (const command of commands) assert.equal(decision(command, branch), expected, command);
}

test("pushes to main are denied in every spelling", () => {
  assertAll(
    [
      "git push origin main",
      "git push -u origin main",
      "git push origin HEAD:main",
      "git push origin feat/x:refs/heads/main",
      "pnpm check && git push origin master",
      "(git push origin main)",
      "true | git push origin main",
      "GIT_TRACE=0 git push origin main",
      "command git push origin main",
      "/usr/bin/git push origin main",
      "git -C /repo push origin main",
      "git push origin main 2>&1 | tail -5",
    ],
    "deny",
  );
  assertAll(
    ["git push", "git push -u origin", "git push -u origin HEAD", "git push origin @", "git push 2>&1"],
    "deny",
    "main",
  );
});

test("pushes that would rewrite or force refs are denied", () => {
  assertAll(
    [
      "git push --all",
      "git push --mirror origin",
      "git push --force origin feat/x",
      "git push -f",
      "git push -fu origin feat/x",
      "git push origin +feat/x",
    ],
    "deny",
  );
});

test("pushes of a feature branch are allowed, lease included", () => {
  assertAll(
    [
      "git push -u origin claude/sharp-mccarthy-95wcdj",
      "git push",
      "git push -u origin HEAD",
      "git push --force-with-lease origin feat/main-screen",
      "git push -u origin feat/x 2>&1 | tail -5",
    ],
    "allow",
  );
});

test("commit messages and PR text that mention push or add flags are not mistaken for them", () => {
  assertAll(
    [
      `git commit -m "feat(hooks): deny push -f to main"`,
      `git commit -m "add -f check"`,
      `git commit -m "docs(hooks): never git push to main"`,
      `git commit -m "chore: block git add -f"`,
      "gh pr create --title 'x' --body '- denies `git push` to main'",
      `git commit -am "docs: never git push origin main"`,
      `git commit -m "$(cat <<'EOF'\nfix(hooks): deny "git push" to main\nEOF\n)"`,
      `rg -n "git push origin main" docs/`,
      `grep -rn "git add -f" .`,
    ],
    "allow",
  );
  assert.equal(decision(`grep -rn "git push" docs/`, "main"), "allow");
});

test("a push whose branch comes from a substitution is denied", () => {
  assert.equal(decision(`git push -u origin "$(git branch --show-current)"`, "main"), "deny");
});

test("commands that could expose Cloudflare tokens are denied", () => {
  assertAll(
    [
      "echo $CLOUDFLARE_API_TOKEN",
      "echo ${CF_API_TOKEN}",
      "echo ${!CLOUDFLARE_*}",
      "node -e 'console.log(process.env.CLOUDFLARE_API_TOKEN)'",
      `node -e 'console.log(process.env["CF_API_TOKEN"])'`,
      "node -p process.env",
      "python3 -c 'import os; print(os.environ)'",
      "cat /proc/self/environ",
      "printenv",
      "env",
      "env | sort",
      "env -u FOO",
      "/usr/bin/env",
      "export",
      "export -p",
      "set",
      "declare -px",
      `git commit -m "fix(cf): read $CLOUDFLARE_API_TOKEN only in client.ts"`,
      `gh pr create --body "uses \${CF_API_TOKEN}"`,
    ],
    "deny",
  );
  assertAll(
    [
      "grep -rn CLOUDFLARE_API_TOKEN packages/",
      `grep -rn "process.env" apps/ scripts/`,
      "git diff | grep env",
      "grep -rn getenv packages/",
      "grep -rn environ docs/",
      "NODE_ENV=test node x.ts",
      "env FOO=1 node x.ts",
      "export FOO=1",
    ],
    "allow",
  );
  assert.equal(checkRead("/proc/self/environ").decision, "deny");
  assert.equal(checkRead("/home/user/deparked/AGENTS.md").decision, "allow");
});

test("force-adding ignored files and git aliases are denied, plain adds are allowed", () => {
  assertAll(
    ["git add -f apps/admin/.dev.vars", "git add --force .", "git add -fA .env", "git config alias.p push"],
    "deny",
  );
  assert.equal(decision("git add scripts/hooks/guard.ts"), "allow");
  assert.equal(decision("git config --get-regexp alias."), "allow");
});

test("merges through gh are denied and gh api writes go to the owner", () => {
  assertAll(["gh pr merge 12 --squash", "gh pr merge 12 --auto --merge"], "deny");
  assertAll(
    [
      "gh api -X PUT repos/o/r/pulls/12/merge",
      "gh api --method=PUT repos/o/r/pulls/12/merge",
      "gh api repos/o/r/contents/x -f branch=main",
      "gh api repos/o/r/contents/x --field=branch=main",
      "gh api repos/o/r/contents/x -fbranch=main",
      `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "x"}) { clientMutationId } }'`,
      "gh api graphql -F query=@merge.graphql",
      "gh repo edit --visibility public",
      "gh secret set TOKEN",
      "gh workflow run deploy.yml",
    ],
    "ask",
  );
  assertAll(
    [
      "gh api repos/o/r/pulls/12",
      "gh api -X GET repos/o/r/pulls -F per_page=100",
      `gh api graphql -f query='{ repository(owner: "o", name: "r") { pullRequest(number: 1) { id } } }'`,
      "gh pr view 12",
      "gh api repos/o/r/pulls/12/comments | grep -F coderabbit",
    ],
    "allow",
  );
});

test("AI attribution is denied in commits and pull requests", () => {
  const commit = `git commit -m "$(cat <<'EOF'\nfeat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)"`;
  assert.equal(decision(commit), "deny");
  assert.equal(
    decision(`gh pr create --body "x\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"`),
    "deny",
  );
  const pr23Footer = "_Generated by [Claude Code](https://claude.ai/code/session_01QakgXistgpaXvAKea2qtWb)_";
  assert.equal(decision(`gh pr create --body "summary\n\n---\n${pr23Footer}"`), "deny");
  assert.equal(checkGitHubText(`summary\n\n---\n${pr23Footer}`).decision, "deny");
  assert.equal(decision(`git commit -m "feat: x"`), "allow");
  assert.equal(decision("git commit -F msg.txt"), "deny");
  assert.equal(decision("gh pr create --body-file body.md"), "deny");
  assert.equal(decision(`git log --format=%B origin/main..HEAD | grep -i "Claude-Session:"`), "allow");
  assert.equal(checkGitHubText("body\nClaude-Session: https://claude.ai/code/x").decision, "deny");
  assert.equal(checkGitHubText("Closes JAG-12").decision, "allow");
});

test("API writes to main are denied", () => {
  assert.equal(checkGitHubBranch("main").decision, "deny");
  assert.equal(checkGitHubBranch("feat/x").decision, "allow");
});

test("edits to the running guard go to the owner", () => {
  assert.equal(checkEdit("scripts/hooks/guard.ts").decision, "ask");
  assert.equal(checkEdit(".claude/settings.json").decision, "ask");
  assert.equal(checkEdit(".gitignore").decision, "allow");
  assert.equal(checkEdit("apps/admin/src/app.ts").decision, "allow");
  assert.equal(checkEdit(undefined).decision, "allow");
  assertAll(
    [
      "sed -i 's/deny/allow/' scripts/hooks/guard.ts",
      "git checkout other -- scripts/hooks .claude/settings.json",
      "echo '{}' > .claude/settings.json",
      "python3 - <<'EOF'\nopen('scripts/hooks/guard.ts','w')\nEOF",
    ],
    "ask",
  );
  assertAll(
    [
      "node --test scripts/hooks/guard.test.ts",
      "cat .claude/settings.json",
      "git diff -- scripts/hooks",
      "git diff origin/main...HEAD -- scripts/hooks > /tmp/review.diff",
      "node --test scripts/hooks/guard.test.ts > out.txt; rm -rf /tmp/x",
    ],
    "allow",
  );
});

test("sensitive areas are found by path, folders included", () => {
  for (const file of [
    "apps/admin/src/server/auth/session.ts",
    "apps/admin/src/routes/login.tsx",
    "apps/admin/src/server/setup-token.ts",
    "apps/admin/src/server/password.ts",
  ]) {
    assert.deepEqual(sensitiveAreas([file]), ["auth or session"], file);
  }
  assert.deepEqual(sensitiveAreas(["apps/admin/src/api/offer.ts"]), ["offer endpoint (public input)"]);
  assert.deepEqual(sensitiveAreas(["apps/admin/src/server/publish/upload.ts"]), ["publish pipeline"]);
  assert.deepEqual(sensitiveAreas(["packages/db/migrations/0001_init.sql"]), ["database schema and migrations"]);
  assert.deepEqual(sensitiveAreas(["packages/cf/src/assets.ts"]), ["Cloudflare API client"]);
  assert.deepEqual(sensitiveAreas(["packages/provision/src/hub.ts"]), [
    "provisioning (changes real Cloudflare resources)",
  ]);
  assert.deepEqual(sensitiveAreas(["apps/sites/wrangler.jsonc"]), ["Worker config"]);
  assert.deepEqual(sensitiveAreas([".github/workflows/check.yml"]), ["CI"]);
  assert.deepEqual(sensitiveAreas(["apps/admin/AGENTS.md", "pnpm-lock.yaml"]), [
    "dependencies",
    "agent rules and guards",
  ]);
  for (const file of ["package.json", "apps/admin/package.json", "turbo.json", "pnpm-workspace.yaml", ".node-version"]) {
    assert.deepEqual(sensitiveAreas([file]), ["build and check scripts"], file);
  }
  for (const file of ["docs/skills.md", ".mcp.json", ".coderabbit.yaml", "skills-lock.json", ".agents/skills/x/SKILL.md"]) {
    assert.deepEqual(sensitiveAreas([file]), ["agent rules and guards"], file);
  }
  assert.deepEqual(sensitiveAreas(["packages/templates/src/variants/sky.tsx", "apps/admin/src/ui/switcher.tsx"]), []);
});

test("merges must squash, pin a sha and set a clean message; then any change may be merged", () => {
  const facts = { mergeMethod: "squash", sha: SHA, title: "feat(api): x (#12)", message: "" };
  assert.equal(checkMerge({ ...facts, mergeMethod: "merge" }).decision, "deny");
  for (const sha of [undefined, "", "abc", SHA.toUpperCase(), `${SHA}0`]) {
    assert.equal(checkMerge({ ...facts, sha }).decision, "deny", String(sha));
  }
  assert.equal(checkMerge({ ...facts, message: undefined }).decision, "deny");
  assert.equal(checkMerge({ ...facts, title: undefined }).decision, "deny");
  assert.equal(checkMerge({ ...facts, title: "" }).decision, "deny");
  assert.equal(checkMerge({ ...facts, message: "Co-Authored-By: Claude <x>" }).decision, "deny");
  assert.equal(checkMerge({ ...facts, message: "x\n\n## Self-review\n\nHead: abc" }).decision, "deny");
  assert.equal(checkMerge(facts).decision, "allow");
});

test("the hook prints a decision for deny, nothing for allow, and fails closed", () => {
  const cwd = import.meta.dirname;
  const denied: unknown = JSON.parse(
    runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" }, cwd })),
  );
  assert.deepEqual(denied, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Never push to main: push a branch and open a pull request.",
    },
  });
  assert.equal(runHook(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "x" }, cwd })), "");
  const auto: unknown = JSON.parse(
    runHook(JSON.stringify({ tool_name: "mcp__github__enable_pr_auto_merge", tool_input: {}, cwd })),
  );
  assert.ok(JSON.stringify(auto).includes('"deny"'));
  const broken: unknown = JSON.parse(runHook("not json"));
  assert.ok(JSON.stringify(broken).includes("Guard failed"));
});

test("API writes never carry a secrets file, and a write to the guard goes to the owner", () => {
  assert.equal(checkGitHubPaths(["apps/admin/src/app.ts"]).decision, "allow");
  assert.equal(checkGitHubPaths(["apps/admin/.dev.vars.example"]).decision, "allow");
  assert.equal(checkGitHubPaths(["apps/admin/.dev.vars"]).decision, "deny");
  assert.equal(checkGitHubPaths(["apps/admin/src/app.ts", ".env.local"]).decision, "deny");
  for (const path of [
    "scripts/hooks/guard.ts",
    ".claude/settings.json",
    "./scripts/hooks/guard.ts",
    "/scripts/hooks/guard.ts",
    "apps/../scripts/hooks/guard.ts",
  ]) {
    assert.equal(checkGitHubPaths([path]).decision, "ask", path);
  }
  const cwd = import.meta.dirname;
  function write(tool: string, input: Record<string, unknown>): string {
    const toolInput = { owner: "O", repo: "r", branch: "feat/x", message: "chore: x", ...input };
    return runHook(JSON.stringify({ tool_name: tool, tool_input: toolInput, cwd }));
  }
  const files = [{ path: "apps/admin/.dev.vars", content: "X=1" }];
  assert.match(write("mcp__github__push_files", { files }), /"deny".*dev\.vars/);
  assert.match(write("mcp__github__create_or_update_file", { path: ".env" }), /"deny".*dev\.vars/);
  assert.match(write("mcp__github__delete_file", { path: "scripts/hooks/guard.ts" }), /"ask"/);
  // A guard push the owner would approve still may not carry AI attribution: the deny wins.
  const attributed = { path: "scripts/hooks/guard.ts", message: "chore: x\n\nCo-Authored-By: Claude <x>" };
  assert.match(write("mcp__github__create_or_update_file", attributed), /"deny".*attribution/);
  assert.equal(write("mcp__github__push_files", { files: [{ path: "apps/admin/src/app.ts", content: "" }] }), "");
});

test("the hook passes a well-formed squash merge through, whatever it touches", () => {
  const cwd = import.meta.dirname;
  function merge(input: Record<string, unknown>): string {
    const toolInput = { owner: "O", repo: "r", pullNumber: 1, expectedHeadSha: SHA, commit_message: "", ...input };
    return runHook(JSON.stringify({ tool_name: "mcp__github__merge_pull_request", tool_input: toolInput, cwd }));
  }
  assert.equal(merge({ merge_method: "squash", commit_title: "ci: change the deploy (#1)" }), "");
  assert.match(merge({ merge_method: "merge", commit_title: "ci: change the deploy (#1)" }), /"deny".*squash/);
});

test("the hook imports only node built-ins and its own files, so a missing install can't break it", () => {
  for (const file of ["guard.ts", "pre-tool-use.ts"]) {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    for (const [, specifier] of source.matchAll(/^import [^;]* from "([^"]+)";$/gm)) {
      assert.match(specifier ?? "", /^(node:|\.\/)/, `${file} imports ${specifier}`);
    }
  }
});
