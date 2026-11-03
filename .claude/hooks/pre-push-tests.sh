#!/bin/sh
# Claude Code PreToolUse hook (Bash): before any `git push`, run the backend
# test suite, which also checks the Unity scene/prefab/ProjectSettings wiring
# as text. A failing suite blocks the push (exit 2) and its tail is shown to
# Claude. Other commands pass through untouched.
input=$(cat)
cmd=$(printf '%s' "$input" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { process.stdout.write(JSON.parse(s).tool_input.command || ""); } catch { process.stdout.write(""); }
});')
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+push([[:space:]]|$)' || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}/backend" || { echo "pre-push hook: backend/ not found" >&2; exit 2; }
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
