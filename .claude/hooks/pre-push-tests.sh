#!/bin/sh
# Claude Code PreToolUse hook (Bash): before any `git push`, run the backend
# test suite, which also checks the Unity scene/prefab/ProjectSettings wiring
# as text. A failing suite blocks the push (exit 2) and its tail is shown to
# Claude. Other commands pass through untouched.
#
# The tests run on the working tree, so the push is also blocked while
# tracked files have uncommitted changes: what passes must be what is pushed.
# Pushes outside Bash (GitHub MCP tools) are not seen here; CI covers them.
# Matches `git push`, `git -C dir push`, `git -c k=v push`, `/usr/bin/git
# push`, `(git push)`; not `git pushx`, and not text that only mentions a
# push: heredoc bodies and quoted strings (a commit message) are removed first.
# Without node the hook lets the command through.
is_push=$(node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let cmd = "";
  try { cmd = JSON.parse(s).tool_input.command || ""; } catch { /* not a Bash call */ }
  const lines = cmd.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);
    const tag = lines[i].match(/<<-?\s*["\x27]?(\w+)["\x27]?/);
    if (tag) { while (i + 1 < lines.length && lines[i + 1].trim() !== tag[1]) i++; i++; }
  }
  const code = kept.join("\n").replace(/\x27[^\x27]*\x27/g, "\x27\x27").replace(/"(?:\\.|[^"\\])*"/g, "\"\"");
  const push = /(^|[;&|(\s]|\/)git(\s+-\S+(\s+[^-;&|()\s][^;&|()\s]*)?)*\s+push([\s;&|)]|$)/;
  process.stdout.write(push.test(code) ? "yes" : "no");
});' 2>/dev/null) || exit 0
[ "$is_push" = yes ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  echo "pre-push hook: tracked files have uncommitted changes, push blocked. Commit or stash them first, so the tests run on exactly what is pushed." >&2
  exit 2
fi

cd backend || { echo "pre-push hook: backend/ not found" >&2; exit 2; }
if [ ! -d node_modules ]; then
  npm ci --silent >/dev/null 2>&1 || { echo "pre-push hook: npm ci failed; install backend dependencies, then push again." >&2; exit 2; }
fi
out=$(npm test --silent 2>&1)
status=$?
if [ "$status" -ne 0 ]; then
  echo "pre-push hook: backend tests failed, push blocked. Fix the failure (never skip or disable the test), then push again." >&2
  printf '%s\n' "$out" | tail -40 >&2
  exit 2
fi
exit 0
