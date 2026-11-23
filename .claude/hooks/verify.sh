#!/usr/bin/env bash
# Stop hook: before Claude finishes, run the checks for each subproject with uncommitted changes.
# Exit 2 blocks the stop and shows Claude the failing command's output (stderr).
set -uo pipefail

# Already continuing because of this hook: let it stop, or a failing check would loop forever.
[ "$(jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "$(git rev-parse --show-toplevel)" || exit 0
# Changed paths, untracked included; for renames ("old -> new") keep the new path.
changed=$(git status --porcelain --untracked-files=all | cut -c4- | sed 's/.* -> //')
[ -z "$changed" ] && exit 0

run() { # run <dir> <command>
  local out
  if ! out=$(cd "$1" && bash -c "$2" 2>&1); then
    echo "Check failed in $1/: $2" >&2
    echo "$out" | tail -n 60 >&2
    exit 2
  fi
}

if grep -q '^site/' <<<"$changed"; then
  run site "npx next typegen >/dev/null && npx tsc --noEmit"
  run site "npm test"
fi
if grep -q '^pricing/' <<<"$changed"; then
  run pricing "uv run ruff check ."
  run pricing "uv run pytest -q"
fi
if grep -q '^recorder/' <<<"$changed"; then
  run recorder "go vet ./..."
  run recorder "go test ./..."
fi
exit 0
